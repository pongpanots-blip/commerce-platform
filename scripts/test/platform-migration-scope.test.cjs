const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const gate = require('../../docker/platform-migration-scope.cjs');
const policy = require('../../docker/platform-migration-policy.json');
const root = path.resolve(__dirname, '../..');
const row = name => ({ name, timestamp: name.slice(-13) });
const baseline = () => policy.migrations.filter(n => !policy.approved.includes(n)).map(row);
const target = () => ({ MIGRATION_SCOPE_COMMIT: policy.sourceCommit, MIGRATION_SCOPE_IMAGE_TAG: policy.imageTag,
  MIGRATION_SCOPE_PLATFORM_TAG: '6790132', MIGRATION_SCOPE_ADMIN_TAG: '396e8d6', MIGRATION_SCOPE_PORTAL_TAG: '020066e' });
function database(overrides = {}) {
  const db = {
    options: { type: 'postgres', synchronize: false, migrationsRun: false },
    migrations: policy.migrations.map(name => ({ name })), ledger: baseline(), events: [],
    identity: { database: 'synthetic', role: 'synthetic_role', schema: 'public', ledger_kind: 'r', ledger_schema: 'public', can_use_schema: true, can_create_schema: true },
    relations: Object.values(policy.relations).flat().map(name => ({ name, relkind: null, schema: null })),
    setOptions(options) { Object.assign(this.options, options); },
    async initialize() { this.events.push('initialize'); },
    async destroy() { this.events.push('destroy'); },
    async transaction(fn) { this.events.push('read-transaction'); return fn({ query: async (sql, params) => {
      this.events.push(sql);
      if (sql === 'SET TRANSACTION READ ONLY' || sql === "SET LOCAL statement_timeout = '15s'") return [];
      if (sql.includes('current_database()')) return this.identity ? [this.identity] : [];
      if (sql.startsWith('SELECT name, timestamp FROM')) return this.ledger;
      if (sql.includes('FROM unnest($1::text[])')) {
        assert.deepEqual(JSON.parse(JSON.stringify(params)), [Object.values(policy.relations).flat()]); return this.relations;
      }
      throw Error('Unexpected query: ' + sql);
    } }); },
    async runMigrations(options) {
      this.events.push('run-migrations'); assert.deepEqual(options, { transaction: 'all' });
      assert.deepEqual(this.migrations.map(m => m.name), policy.approved);
      const executed = this.migrations.filter(m => !this.ledger.some(r => r.name === m.name));
      this.ledger.push(...executed.map(m => row(m.name)));
      this.relations = this.relations.map(r => ({ ...r, relkind: 'r', schema: 'public', can_select: true, can_insert: true, can_update: true }));
      return executed;
    }, ...overrides,
  };
  return db;
}
async function denied(db, code, mode = 'run') {
  await assert.rejects(gate.executeScope(db, policy, mode), { code });
  assert.equal(db.events.includes('run-migrations'), false);
}

test('only the approved names are pending in the applied baseline', () => {
  assert.deepEqual(gate.pendingNames(policy, baseline()), policy.approved);
});
test('an already applied approved migration leaves only its peers pending', () => {
  assert.deepEqual(gate.pendingNames(policy, [...baseline(), row(policy.approved[0])]), policy.approved.slice(1));
});
test('a fully applied ledger is idempotent', () => {
  assert.deepEqual(gate.pendingNames(policy, policy.migrations.map(row)), []);
});
test('missing historical migration fails before any execution', async () => {
  await denied(database({ ledger: baseline().slice(1) }), 'UNAPPROVED_PENDING_MIGRATIONS');
});
test('unexpected applied name, duplicate row and inconsistent timestamp fail closed', () => {
  for (const extra of [row('Unexpected1796300000000'), row(policy.migrations[0]), { name: policy.approved[0], timestamp: 1 }])
    assert.throws(() => gate.pendingNames(policy, [...baseline(), extra]), { code: 'UNREVIEWED_OR_INVALID_LEDGER' });
});
test('malformed ledger and policy are rejected', () => {
  assert.throws(() => gate.pendingNames(policy, null), { code: 'INVALID_MIGRATION_LEDGER' });
  for (const patch of [{ approved: ['Unknown1796300000000'] }, { migrations: [...policy.migrations, policy.migrations[0]] }, { imageTag: 'other' }])
    assert.throws(() => gate.validatePolicy({ ...policy, ...patch }), { code: 'INVALID_RELEASE_POLICY' });
});
test('frozen source, image tag and all sibling tags must match', () => {
  gate.validateTarget(policy, target());
  for (const [key, code] of [['MIGRATION_SCOPE_COMMIT','UNREVIEWED_APPLICATION_COMMIT'], ['MIGRATION_SCOPE_IMAGE_TAG','UNREVIEWED_IMAGE_TAG'],
    ['MIGRATION_SCOPE_ADMIN_TAG','DEPLOYED_TAG_CHANGED'], ['MIGRATION_SCOPE_PORTAL_TAG','DEPLOYED_TAG_CHANGED'], ['MIGRATION_SCOPE_PLATFORM_TAG','DEPLOYED_TAG_CHANGED']])
    assert.throws(() => gate.validateTarget(policy, { ...target(), [key]: 'different' }), { code });
});
test('after deploy the release\'s own platform tag is accepted without listing it; siblings still are not', () => {
  const release = { ...policy, deployedTags: { ...policy.deployedTags, platform: policy.deployedTags.platform.filter(t => t !== policy.imageTag) } };
  gate.validateTarget(release, { ...target(), MIGRATION_SCOPE_PLATFORM_TAG: policy.imageTag });
  assert.throws(() => gate.validateTarget(release, { ...target(), MIGRATION_SCOPE_ADMIN_TAG: policy.imageTag + 'x' }), { code: 'DEPLOYED_TAG_CHANGED' });
});
test('unsafe initialization options cannot start a connection', async () => {
  for (const patch of [{ synchronize: true }, { migrationsRun: true }, { dropSchema: true }, { type: 'mysql' }]) {
    const db = database({ options: { type: 'postgres', ...patch } });
    await denied(db, 'UNSAFE_DATASOURCE_OPTIONS'); assert.deepEqual(db.events, []);
  }
});
test('missing ledger, ledger view or different schema fail without touching business records', async () => {
  for (const identity of [null, { ...database().identity, ledger_kind: 'v' }, { ...database().identity, ledger_schema: 'other' }])
    await denied(database({ identity }), 'MIGRATION_LEDGER_UNAVAILABLE');
});
test('an unledgered existing table fails before approved DDL', async () => {
  const db = database(); db.relations[0].relkind = 'r';
  await denied(db, 'UNLEDGERED_RELATION_EXISTS');
});
test('schema CREATE denial prevents approved migrations', async () => {
  const db = database(); db.identity.can_create_schema = false;
  await denied(db, 'SCHEMA_CREATE_DENIED');
});
test('applied table definitions must resolve to the expected schema and allow native operations', async () => {
  for (const patch of [{ relkind: null }, { schema: 'other' }, { can_select: false }, { can_insert: false }, { can_update: false }]) {
    const db = database({ ledger: policy.migrations.map(row) });
    db.relations = db.relations.map(r => ({ ...r, relkind: 'r', schema: 'public', can_select: true, can_insert: true, can_update: true }));
    Object.assign(db.relations[0], patch); await denied(db, 'APPLIED_RELATION_OR_GRANTS_INVALID');
  }
});
test('preflight performs metadata SELECTs inside READ ONLY and never runs migrations', async () => {
  const db = database(); const result = await gate.executeScope(db, policy, 'preflight');
  assert.deepEqual(result.pending, policy.approved); assert.equal(result.appliedCount, policy.migrations.length - policy.approved.length);
  assert.equal(db.events.includes('run-migrations'), false); assert.equal(db.events.at(-1), 'destroy');
  assert.equal(db.events[2], 'SET TRANSACTION READ ONLY');
  assert.equal(db.events.some(e => /^(INSERT|DELETE|UPDATE)\b|FROM (warehouses|customers)\b/i.test(e)), false);
});
test('run bounds the actual executor and verifies the resulting ledger/grants', async () => {
  const db = database(); const result = await gate.executeScope(db, policy, 'run');
  assert.deepEqual(result.executed, policy.approved); assert.equal(result.after.appliedCount, policy.migrations.length);
  assert.deepEqual(result.after.pending, []); assert.equal(db.events.at(-1), 'destroy');
});
test('unexpected/missing/duplicate migration classes in an image fail before execution', async () => {
  for (const migrations of [database().migrations.slice(1), [...database().migrations, { name: 'Unknown1796300000000' }],
    [...database().migrations.slice(1), database().migrations[1]]])
    await denied(database({ migrations }), 'UNREVIEWED_IMAGE_MIGRATIONS');
});
test('a later ledger change still cannot invoke a historical callback', async () => {
  const db = database(); const native = db.runMigrations;
  db.runMigrations = async function(options) {
    this.ledger = this.ledger.slice(1); return native.call(this, options);
  };
  await assert.rejects(gate.executeScope(db, policy, 'run'), { code: 'UNAPPROVED_PENDING_MIGRATIONS' });
  assert.deepEqual(db.migrations.map(m => m.name), policy.approved);
  assert.equal(db.events.filter(e => e === 'run-migrations').length, 1);
});
test('driver read failure prevents migrations and destroys the connection', async () => {
  const db = database({ transaction: async () => { throw Error('connection problem'); } });
  await assert.rejects(gate.executeScope(db, policy, 'run'));
  assert.equal(db.events.includes('run-migrations'), false); assert.equal(db.events.at(-1), 'destroy');
});
test('successful executor return without persisted ledger is not success', async () => {
  const db = database({ runMigrations: async () => [] });
  await assert.rejects(gate.executeScope(db, policy, 'run'), { code: 'MIGRATION_COMPLETION_NOT_VERIFIED' });
});
test('flags output excludes secrets and URI values', () => {
  assert.deepEqual(gate.safeFlags({ COMMERCE_OWNS_PRICES: 'true', WINBACK_OWNER: 'commerce', JOSH_JWT_SECRET: 'synthetic',
    CUSTOMER_SOURCE: 'https://user:synthetic@host', CRON_PRIVATE_TOKEN: 'synthetic' }), { COMMERCE_OWNS_PRICES: 'true', WINBACK_OWNER: 'commerce' });
});
test('streamed preflight entry actually runs, without writing helpers into the container', async () => {
  const source = fs.readFileSync(path.join(root, 'docker/platform-migration-scope.cjs'), 'utf8');
  const transformed = execFileSync('sed',["s@const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'platform-migration-policy.json'), 'utf8'));@@",path.join(root,'docker/platform-migration-scope.cjs')],{encoding:'utf8'});
  const streamed = 'const policy = JSON.parse(Buffer.from("' + Buffer.from(JSON.stringify(policy)).toString('base64') + '", "base64").toString());\n' + transformed;
  const db = database(), logs = [], proc = { argv: ['node','-','preflight'], env: target() };
  const context = { require: id => id === '/app/src/data-source' ? { AppDataSource: db } : id === '/app/node_modules/reflect-metadata' ? {} : require(id),
    module: { exports: {} }, process: proc, console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) }, __dirname: '/app', Buffer };
  await vm.runInNewContext(streamed, context);
  assert.equal(proc.exitCode, undefined); assert.equal(db.events.at(-1), 'destroy');
  assert.equal(logs.length, 2); assert.equal(logs[0][0], 'migration scope verified:');
  assert.equal(logs[1][0], 'migration scope fingerprint:');
  assert.equal(db.events.includes('run-migrations'), false);
});
test('shell preflight uses inspection/streaming only and refuses mismatched images', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-gate-shell-'));
  try {
    const bin=path.join(dir,'bin');fs.mkdirSync(bin);
    fs.writeFileSync(path.join(dir,'.env'),'PLATFORM_TAG=6790132\nADMIN_TAG=396e8d6\nPORTAL_TAG=020066e\n');
    const docker=path.join(bin,'docker');
    fs.writeFileSync(docker,[
      '#!/bin/bash', 'echo "$*" >> "$GATE_TEST_LOG"',
      'if [[ "$1" == compose && "$4" == ps ]]; then echo "id-${@: -1}"',
      'elif [[ "$1" == inspect ]]; then', ' svc="${@: -1}";svc="${svc#id-}"',
      ' case "$svc" in platform) tag=6790132;; admin) tag=396e8d6;; portal) tag=020066e;; esac',
      ' [[ "${GATE_TEST_MISMATCH:-}" != true ]] || tag=other',
      ' echo "synthetic/commerce-$svc:$tag"',
      'elif [[ "$1" == exec ]]; then cat > "$GATE_TEST_STREAM"',
      ' [[ -z "${GATE_TEST_FINGERPRINT:-}" ]] || echo "migration scope fingerprint: $GATE_TEST_FINGERPRINT"',
      'elif [[ "$1" == compose && "$4" == run ]]; then exit 0',
      'else exit 72;fi', '',
    ].join('\n'),{mode:0o755});
    const env={...process.env,PATH:bin+':'+process.env.PATH,ECR_REGISTRY:'synthetic',...target(),GATE_TEST_LOG:path.join(dir,'log'),GATE_TEST_STREAM:path.join(dir,'stream')};
    const args=[path.join(root,'docker/platform-migration-scope.sh'),'preflight',dir];
    let r=spawnSync('bash',args,{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
    const lines=fs.readFileSync(env.GATE_TEST_LOG,'utf8').trim().split('\n');
    assert.equal(lines.length,7);assert.ok(lines.every(s=>s.startsWith('compose -f docker-compose.prod.yml ps ')||s.startsWith('inspect ')||s.startsWith('exec ')));
    assert.ok(fs.readFileSync(env.GATE_TEST_STREAM,'utf8').includes('const policy = JSON.parse(Buffer.from('));
    fs.writeFileSync(env.GATE_TEST_LOG,'');r=spawnSync('bash',args,{env:{...env,GATE_TEST_MISMATCH:'true'},encoding:'utf8'});
    assert.equal(r.status,1);assert.equal(fs.readFileSync(env.GATE_TEST_LOG,'utf8').includes('exec '),false);
    fs.writeFileSync(env.GATE_TEST_LOG,'');
    r=spawnSync('bash',[args[0],'run',dir],{env,encoding:'utf8'});
    assert.equal(r.status,1);assert.equal(fs.readFileSync(env.GATE_TEST_LOG,'utf8').includes(' run '),false);
    const fingerprint='a'.repeat(64);
    fs.writeFileSync(env.GATE_TEST_LOG,'');
    r=spawnSync('bash',[args[0],'run',dir],{env:{...env,GATE_TEST_FINGERPRINT:fingerprint},encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    const run=fs.readFileSync(env.GATE_TEST_LOG,'utf8').trim().split('\n').at(-1);
    assert.ok(run.startsWith('compose -f docker-compose.prod.yml run --rm --no-deps'));
    assert.ok(run.includes('MIGRATION_SCOPE_EXPECTED_FINGERPRINT='+fingerprint));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('run CLI refuses an absent fingerprint before loading the application datasource', async () => {
  const source=fs.readFileSync(path.join(root,'docker/platform-migration-scope.cjs'),'utf8');
  const logs=[],proc={argv:['node','-','run'],env:target()};
  await vm.runInNewContext(source,{require:id=>{
    assert.notEqual(id,'/app/src/data-source');return require(id);
  },module:{exports:{}},process:proc,console:{error:(...args)=>logs.push(args)},__dirname:path.join(root,'docker')});
  assert.equal(proc.exitCode,1);assert.deepEqual(logs[0],['migration scope failed:','UNVERIFIED_RUNNING_CONFIGURATION']);
});
test('direct deploy stops before files, pull, cleanup or restart when admission fails', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-gate-deploy-'));
  try {
    fs.copyFileSync(path.join(root,'docker/ec2-deploy.sh'),path.join(dir,'ec2-deploy.sh'));
    fs.copyFileSync(path.join(root,'docker/docker-compose.prod.yml'),path.join(dir,'docker-compose.prod.yml'));
    fs.writeFileSync(path.join(dir,'platform-migration-scope.sh'),'#!/bin/bash\nexit 73\n');
    fs.writeFileSync(path.join(dir,'.env'),'PLATFORM_TAG=6790132\nADMIN_TAG=396e8d6\nPORTAL_TAG=020066e\n');
    const original=fs.readFileSync(path.join(dir,'.env'),'utf8');
    const r=spawnSync('bash',[path.join(dir,'ec2-deploy.sh'),policy.imageTag,'--skip-cleanup','platform'],{cwd:dir,env:{...process.env,...target()},encoding:'utf8'});
    assert.equal(r.status,73);assert.equal(fs.readFileSync(path.join(dir,'.env'),'utf8'),original);
    assert.equal(fs.existsSync(path.join(dir,'platform-flags.env')),false);
    assert.equal(fs.existsSync(path.join(dir,'.image-tags-prev.pending')),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('initialization disables automatic extension DDL and removes entity/subscriber hooks', async () => {
  const db = database({ options: { type:'postgres', entities:['uuid-entity'], subscribers:['hook'] } });
  db.initialize = async function() {
    assert.equal(this.options.installExtensions,false);
    assert.deepEqual(this.options.entities,[]); assert.deepEqual(this.options.subscribers,[]);
  };
  await gate.executeScope(db,policy,'preflight');
});
test('configuration drift in database identity, flags or credentials refuses execution', async () => {
  for (const patch of [{ identity:{ ...database().identity,database:'different' } },
    { env:{ COMMERCE_OWNS_PRICES:'true' } }, { env:{ COMMERCE_DB_PASSWORD:'synthetic-changed' } }]) {
    const db=database(patch.identity ? {identity:patch.identity}:{});
    await assert.rejects(gate.executeScope(db,policy,'run',{
      expectedFingerprint:gate.configurationFingerprint(database().identity,{}),env:patch.env||{},
    }),{code:'RUNNING_CONFIGURATION_CHANGED'});
    assert.equal(db.events.includes('run-migrations'),false);
  }
});
test('exact approved callback contents are required, including missing or substituted files', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-gate-hashes-'));
  try {
    const approvedCode={};
    for (const name of policy.approved) {
      const file=policy.approvedCode[name].file, text='reviewed synthetic callback '+name;
      fs.writeFileSync(path.join(dir,file),text);
      approvedCode[name]={file,sha256:require('node:crypto').createHash('sha256').update(text).digest('hex')};
    }
    const synthetic={...policy,approvedCode}; gate.verifyApprovedCode(synthetic,dir);
    fs.appendFileSync(path.join(dir,approvedCode[policy.approved[0]].file),'changed');
    assert.throws(()=>gate.verifyApprovedCode(synthetic,dir),{code:'UNREVIEWED_MIGRATION_CODE'});
    fs.unlinkSync(path.join(dir,approvedCode[policy.approved[0]].file));
    assert.throws(()=>gate.verifyApprovedCode(synthetic,dir),{code:'APPROVED_MIGRATION_CODE_UNAVAILABLE'});
    assert.throws(()=>gate.validatePolicy({...policy,approvedCode:{}}),{code:'INVALID_RELEASE_POLICY'});
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('direct platform tag mismatch stops before any helper or mutation', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-gate-tag-'));
  try {
    fs.copyFileSync(path.join(root,'docker/ec2-deploy.sh'),path.join(dir,'ec2-deploy.sh'));
    fs.writeFileSync(path.join(dir,'platform-migration-scope.sh'),'#!/bin/bash\nexit 73\n');
    const r=spawnSync('bash',[path.join(dir,'ec2-deploy.sh'),'other','platform'],{env:{...process.env,...target()},encoding:'utf8'});
    assert.equal(r.status,1);assert.match(r.stderr,/deployment tag differs/);
    assert.equal(fs.existsSync(path.join(dir,'platform-flags.env')),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('the reviewed migration release rejects a simultaneous sibling deployment', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-gate-siblings-'));
  try {
    fs.copyFileSync(path.join(root,'docker/ec2-deploy.sh'),path.join(dir,'ec2-deploy.sh'));
    const r=spawnSync('bash',[path.join(dir,'ec2-deploy.sh'),policy.imageTag,'platform','admin'],{env:{...process.env,...target()},encoding:'utf8'});
    assert.equal(r.status,1);assert.match(r.stderr,/platform-only deployment/);
    assert.equal(fs.existsSync(path.join(dir,'platform-flags.env')),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('direct platform deployment clears Compose overrides before admission', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cp-gate-env-'));
  try {
    fs.copyFileSync(path.join(root,'docker/ec2-deploy.sh'),path.join(dir,'ec2-deploy.sh'));
    fs.copyFileSync(path.join(root,'docker/docker-compose.prod.yml'),path.join(dir,'docker-compose.prod.yml'));
    fs.writeFileSync(path.join(dir,'platform-migration-scope.sh'),[
      '#!/bin/bash','[[ -z "${COMMERCE_DB_PASSWORD+x}" && -z "${CRON_MARKETING_RESEARCH_ENABLED+x}" && -z "${ADMIN_TAG+x}" ]] || exit 74',
      '[[ "$ECR_REGISTRY" == synthetic ]] || exit 75','exit 73','',
    ].join('\n'));
    const r=spawnSync('bash',[path.join(dir,'ec2-deploy.sh'),policy.imageTag,'platform'],{env:{...process.env,...target(),
      ECR_REGISTRY:'synthetic',COMMERCE_DB_PASSWORD:'synthetic-override',CRON_MARKETING_RESEARCH_ENABLED:'true',ADMIN_TAG:'other'},encoding:'utf8'});
    assert.equal(r.status,73,r.stderr);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('policy matches all migration names in the frozen application source', () => {
  const dir = path.join(root, 'apps/commerce-platform/src/migrations');
  const names = fs.readdirSync(dir).filter(n => n.endsWith('.ts')).map(n =>
    fs.readFileSync(path.join(dir,n),'utf8').match(/export class (\w+) implements MigrationInterface/)[1]);
  assert.deepEqual([...names].sort(), [...policy.migrations].sort());
  assert.deepEqual(policy.approved, ['MarketingEventLayer1796400000000']);
});
test('workflow gate precedes host/config mutations and build pins the application commit', () => {
  const workflow = fs.readFileSync(path.join(root,'.github/workflows/deploy-ecr.yml'),'utf8');
  assert.ok(workflow.indexOf('Verify approved pending migrations before host changes') < workflow.indexOf('Sync docker/ files'));
  assert.ok(workflow.includes('ref: ${{ needs.resolve.outputs.application_commit }}'));
  assert.ok(workflow.includes('if [[ "$SERVICES" != *\'"platform"\'* ]]; then'));
  const deploy = fs.readFileSync(path.join(root,'docker/ec2-deploy.sh'),'utf8');
  assert.ok(deploy.includes('/platform-migration-scope.sh" run "$PWD"'));
  assert.equal(deploy.includes('cli.js migration:run'), false);
});
test('anonymous availability probes are GET-only, require health/guard/missing-route statuses and stop on failure', async () => {
  const {routes,verifyAvailability}=require('../../docker/platform-api-availability.cjs');
  const requests=[];
  const health=execFileSync('bash',['-c','source "$1/docker/ec2-deploy.sh"; commerce_deploy_health_url platform','health-route',root],{encoding:'utf8'}).trim();
  const probe=async(url,options)=>{
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers,undefined);
    requests.push(url);return {status:url===health?200:url.includes('__unregistered_')?404:401};
  };
  assert.equal((await verifyAvailability(probe)).length,routes.length+2);
  assert.equal(requests.length,14);
  assert.equal(requests[0],health);
  let calls=0;
  await assert.rejects(verifyAvailability(async()=>({status:++calls===1?200:404})),/API availability status mismatch/);
  assert.equal(calls,2);
});
test('health probe uses the public root handler from the frozen application source', () => {
  const controller=fs.readFileSync(path.join(root,'apps/commerce-platform/src/app.controller.ts'),'utf8');
  const main=fs.readFileSync(path.join(root,'apps/commerce-platform/src/main.ts'),'utf8');
  assert.match(controller,/@Public\(\)/);assert.match(controller,/@Controller\(\)/);assert.match(controller,/@Get\(\)/);
  assert.match(main,/const globalPrefix = 'api'/);
});
