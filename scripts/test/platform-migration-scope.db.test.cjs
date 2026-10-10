// Owned localhost synthetic fixture only; never consumes application/prod credentials.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { DataSource, EntitySchema } = require('typeorm');
const ts = require('typescript');
const { executeScope } = require('../../docker/platform-migration-scope.cjs');
const policy = require('../../docker/platform-migration-policy.json');
const fixtureUrl = process.env.CP_GATE_SYNTHETIC_URL;
const classes = () => {
  const dir = path.resolve(__dirname, '../../apps/commerce-platform/src/migrations');
  return fs.readdirSync(dir).filter(n => n.endsWith('.ts')).map(n => {
    const source = fs.readFileSync(path.join(dir,n),'utf8');
    const name = source.match(/export class (\w+) implements MigrationInterface/)[1];
    // Historical callbacks are sentinels: any accidental invocation fails the native test.
    // The two approved migrations use their real source and PostgreSQL DDL.
    if (!policy.approved.includes(name)) return class {
      name = name;
      async up() { throw Error('Unapproved historical callback invoked'); }
      async down() { throw Error('Rollback callback invoked'); }
    };
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} }; vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require });
    return Object.values(mod.exports)[0];
  });
};

test('native PostgreSQL admission, bounded TypeORM DDL, idempotence and refusal', { skip: !fixtureUrl }, async t => {
  const url = new URL(fixtureUrl);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/commerce_preview_test');
  const admin = new Client({ connectionString: fixtureUrl }); await admin.connect();
  const prefix = 'cp_guard_' + randomBytes(6).toString('hex');
  const schemas = [];
  const create = async (suffix, missingHistorical = false, collision = false) => {
    const schema = prefix + '_' + suffix; schemas.push(schema);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`CREATE TABLE "${schema}".migrations (id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)`);
    const historical = policy.migrations.filter(n => !policy.approved.includes(n)).slice(missingHistorical ? 1 : 0);
    for (const name of historical) await admin.query(`INSERT INTO "${schema}".migrations(timestamp,name) VALUES($1,$2)`, [name.slice(-13),name]);
    if (collision) await admin.query(`CREATE TABLE "${schema}".product_erp_extras (synthetic_marker integer)`);
    const log = [];
    const db = () => new DataSource({ type:'postgres', url:fixtureUrl, schema, synchronize:false, migrationsRun:false,
      entities:[new EntitySchema({name:'SyntheticUuidEntity',columns:{id:{type:'uuid',primary:true,generated:'uuid'}}})],
      extra:{ options:`-c search_path=${schema}` }, migrations:classes(), logging:['query'],
      logger:{ logQuery:q=>log.push(q),logQueryError(){},logQuerySlow(){},logSchemaBuild(){},logMigration(){},log(){} } });
    return { schema, log, db };
  };
  try {
    const happy = await create('happy');
    await t.test('preflight reads metadata only and creates no tables', async () => {
      const datasource=happy.db();
      const r = await executeScope(datasource,policy,'preflight');
      assert.equal(datasource.options.installExtensions,false);assert.deepEqual(datasource.entityMetadatas,[]);
      assert.equal(r.appliedCount,50); assert.deepEqual(r.pending,policy.approved);
      assert.equal(happy.log.some(q=>/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(q)),false);
      assert.equal(happy.log.some(q=>/^SET TRANSACTION READ ONLY$/.test(q)),true);
    });
    await t.test('exactly the two approved migrations run, with real constraints/indexes', async () => {
      const r = await executeScope(happy.db(),policy,'run');
      assert.deepEqual([...r.executed].sort(),[...policy.approved].sort()); assert.equal(r.after.appliedCount,52);
      const {rows:tables}=await admin.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename',[happy.schema]);
      assert.deepEqual(tables.map(r=>r.tablename),['commerce_promotion_draft_requests','commerce_promotion_drafts','migrations','product_erp_extras']);
      const {rows:constraints}=await admin.query(`SELECT contype FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=$1`,[happy.schema]);
      assert.equal(constraints.filter(r=>r.contype==='f').length,1); assert.equal(constraints.filter(r=>r.contype==='c').length,1);
      const {rows:indexes}=await admin.query('SELECT indexname FROM pg_indexes WHERE schemaname=$1',[happy.schema]);
      assert.ok(indexes.some(r=>r.indexname==='commerce_promotion_drafts_actor'));
    });
    await t.test('a repeated run executes no migrations', async () => {
      const r = await executeScope(happy.db(),policy,'run'); assert.deepEqual(r.executed,[]); assert.deepEqual(r.after.pending,[]);
    });
    await t.test('a missing historical migration refuses all DDL', async () => {
      const bad = await create('missing',true); await assert.rejects(executeScope(bad.db(),policy,'run'),{code:'UNAPPROVED_PENDING_MIGRATIONS'});
      assert.equal(bad.log.some(q=>/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(q)),false);
      const {rows}=await admin.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[bad.schema]);assert.deepEqual(rows.map(r=>r.tablename),['migrations']);
    });
    await t.test('an existing unledgered table refuses all DDL', async () => {
      const bad = await create('collision',false,true); await assert.rejects(executeScope(bad.db(),policy,'run'),{code:'UNLEDGERED_RELATION_EXISTS'});
      assert.equal(bad.log.some(q=>/^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i.test(q)),false);
    });
    await t.test('interrupted DDL rolls back both tables and ledger, then a normal retry succeeds', async () => {
      const retry=await create('retry'),datasource=retry.db();
      const original=datasource.options.migrations.find(m=>new m().name===policy.approved[1] || m.name===policy.approved[1]);
      const interrupted=class extends original {
        name=policy.approved[1];
        async up(runner) { await super.up(runner);throw Error('synthetic interruption after approved DDL'); }
      };
      datasource.setOptions({migrations:datasource.options.migrations.map(m=>m===original?interrupted:m)});
      await assert.rejects(executeScope(datasource,policy,'run'),/synthetic interruption/);
      const {rows:tables}=await admin.query('SELECT tablename FROM pg_tables WHERE schemaname=$1',[retry.schema]);
      assert.deepEqual(tables.map(r=>r.tablename),['migrations']);
      const {rows:[ledger]}=await admin.query(`SELECT COUNT(*)::int AS count FROM "${retry.schema}".migrations`);
      assert.equal(ledger.count,50);
      const r=await executeScope(retry.db(),policy,'run');assert.equal(r.after.appliedCount,52);
      assert.deepEqual([...r.executed].sort(),[...policy.approved].sort());
    });
  } finally {
    for (const schema of schemas) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
