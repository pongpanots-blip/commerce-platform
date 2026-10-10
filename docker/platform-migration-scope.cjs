// Frozen release gate: metadata reads first, then only the explicitly approved migrations.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

class ScopeError extends Error {
  constructor(code, details) { super(code); this.code = code; this.details = details; }
}
const fail = (code, details) => { throw new ScopeError(code, details); };
const migrationName = migration => migration.name || migration.constructor.name;

function validatePolicy(policy) {
  if (!/^[a-f0-9]{40}$/.test(policy.sourceCommit) || policy.imageTag !== policy.sourceCommit.slice(0, 7)) fail('INVALID_RELEASE_POLICY');
  for (const names of [policy.migrations, policy.approved]) {
    if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length ||
      names.some(n => typeof n !== 'string' || !/^[A-Za-z][A-Za-z0-9]*\d{13}$/.test(n))) fail('INVALID_RELEASE_POLICY');
  }
  if (policy.approved.some(n => !policy.migrations.includes(n))) fail('INVALID_RELEASE_POLICY');
  if (Object.keys(policy.relations).some(n => !policy.approved.includes(n)) ||
    policy.approved.some(n => !policy.relations[n]?.length) ||
    Object.values(policy.relations).flat().some(n => !/^[a-z_]+$/.test(n))) fail('INVALID_RELEASE_POLICY');
  if (!policy.approvedCode || Object.keys(policy.approvedCode).length !== policy.approved.length || policy.approved.some(n => {
    const code = policy.approvedCode[n];
    return !code || !/^\d{13}-[A-Za-z][A-Za-z0-9]*\.js$/.test(code.file) || !/^[a-f0-9]{64}$/.test(code.sha256);
  })) fail('INVALID_RELEASE_POLICY');
}

function pendingNames(policy, ledger) {
  validatePolicy(policy);
  if (!Array.isArray(ledger)) fail('INVALID_MIGRATION_LEDGER');
  const applied = new Set();
  for (const row of ledger) {
    if (!row || typeof row.name !== 'string' || !policy.migrations.includes(row.name) ||
      applied.has(row.name) || Number(row.timestamp) !== Number(row.name.slice(-13))) fail('UNREVIEWED_OR_INVALID_LEDGER');
    applied.add(row.name);
  }
  const pending = policy.migrations.filter(n => !applied.has(n));
  if (pending.some(n => !policy.approved.includes(n))) fail('UNAPPROVED_PENDING_MIGRATIONS', { pending });
  return pending;
}

function validateTarget(policy, env) {
  validatePolicy(policy);
  if (env.MIGRATION_SCOPE_COMMIT !== policy.sourceCommit) fail('UNREVIEWED_APPLICATION_COMMIT');
  if (env.MIGRATION_SCOPE_IMAGE_TAG !== policy.imageTag) fail('UNREVIEWED_IMAGE_TAG');
  for (const service of ['admin', 'portal', 'platform']) {
    // The release's own platform image is reviewed by definition: the post-deploy check runs with it already live.
    const allowed = service === 'platform' ? [...policy.deployedTags.platform, policy.imageTag] : policy.deployedTags[service];
    if (!allowed.includes(env[`MIGRATION_SCOPE_${service.toUpperCase()}_TAG`])) fail('DEPLOYED_TAG_CHANGED');
  }
}

async function readScope(db, policy) {
  return db.transaction(async manager => {
    await manager.query('SET TRANSACTION READ ONLY');
    await manager.query("SET LOCAL statement_timeout = '15s'");
    const [identity] = await manager.query(`SELECT current_database() AS database, current_user AS role,
      inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
      current_schema() AS schema, c.relkind AS ledger_kind, n.nspname AS ledger_schema,
      has_schema_privilege(current_user, current_schema(), 'USAGE') AS can_use_schema,
      has_schema_privilege(current_user, current_schema(), 'CREATE') AS can_create_schema
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=to_regclass('migrations')`);
    if (!identity || identity.ledger_kind !== 'r' || identity.ledger_schema !== identity.schema || !identity.can_use_schema) fail('MIGRATION_LEDGER_UNAVAILABLE');
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    const ledger = await manager.query(`SELECT name, timestamp FROM ${quote(identity.schema)}."migrations" ORDER BY id`);
    const pending = pendingNames(policy, ledger);
    const relations = await manager.query(`SELECT names.name, c.relkind, n.nspname AS schema,
      CASE WHEN c.oid IS NOT NULL THEN has_table_privilege(current_user,c.oid,'SELECT') END AS can_select,
      CASE WHEN c.oid IS NOT NULL THEN has_table_privilege(current_user,c.oid,'INSERT') END AS can_insert,
      CASE WHEN c.oid IS NOT NULL THEN has_table_privilege(current_user,c.oid,'UPDATE') END AS can_update
      FROM unnest($1::text[]) AS names(name) LEFT JOIN pg_class c ON c.oid=to_regclass(names.name)
      LEFT JOIN pg_namespace n ON n.oid=c.relnamespace`, [Object.values(policy.relations).flat()]);
    for (const [name, tables] of Object.entries(policy.relations)) {
      for (const table of tables) {
        const rows = relations.filter(r => r.name === table);
        if (rows.length !== 1) fail('INVALID_RELATION_METADATA');
        const row = rows[0];
        if (pending.includes(name)) {
          if (row.relkind !== null) fail('UNLEDGERED_RELATION_EXISTS');
        } else if (row.relkind !== 'r' || row.schema !== identity.schema ||
          !row.can_select || !row.can_insert || !row.can_update) fail('APPLIED_RELATION_OR_GRANTS_INVALID');
      }
    }
    if (pending.length && !identity.can_create_schema) fail('SCHEMA_CREATE_DENIED');
    return { identity, appliedCount: ledger.length, pending };
  });
}

function verifyApprovedCode(policy, directory) {
  validatePolicy(policy);
  for (const { file, sha256 } of Object.values(policy.approvedCode)) {
    let digest;
    try { digest = createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex'); }
    catch { fail('APPROVED_MIGRATION_CODE_UNAVAILABLE'); }
    if (digest !== sha256) fail('UNREVIEWED_MIGRATION_CODE');
  }
}

function configurationFingerprint(identity, env) {
  // Compare configuration without printing credentials, connection strings or their individual hashes.
  const configuration = Object.entries(env).filter(([key]) =>
    /^(COMMERCE_|JOSH_|JAGOTA_|REDIS_|CRON_|SCRAPING_|RESEARCH_|WINBACK_|CUSTOMER_|S3_|AWS_|MEDIA_|MCP_|PRODUCT_|PLANNING_|PORTAL_|STOREFRONT_|TRUST_PROXY_)|_SOURCE$/.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const database = Object.fromEntries(['database', 'role', 'schema', 'server_address', 'server_port'].map(k => [k, identity[k]]));
  return createHash('sha256').update(JSON.stringify({ database, configuration })).digest('hex');
}

async function executeScope(db, policy, mode, { expectedFingerprint, env = {} } = {}) {
  validatePolicy(policy);
  if (!['preflight', 'run'].includes(mode)) fail('INVALID_GATE_MODE');
  if (db.options.type !== 'postgres' || db.options.synchronize || db.options.migrationsRun || db.options.dropSchema) fail('UNSAFE_DATASOURCE_OPTIONS');
  // TypeORM otherwise installs UUID extensions during initialize(), before READ ONLY.
  // Migration callbacks use QueryRunner directly and need neither entities nor subscribers.
  db.setOptions({ installExtensions: false, entities: [], subscribers: [] });
  await db.initialize();
  try {
    if (mode === 'run') {
      const loaded = db.migrations.map(migrationName);
      if (new Set(loaded).size !== loaded.length || loaded.length !== policy.migrations.length ||
        loaded.some(n => !policy.migrations.includes(n))) fail('UNREVIEWED_IMAGE_MIGRATIONS');
    }
    const before = await readScope(db, policy);
    const fingerprint = configurationFingerprint(before.identity, env);
    if (mode === 'preflight') return { mode, ...before, fingerprint };
    if (expectedFingerprint && expectedFingerprint !== fingerprint) fail('RUNNING_CONFIGURATION_CHANGED');
    // Bound the executor itself: a ledger change after the read can never cause
    // historical/unapproved migration callbacks to run. Never fake or skip a ledger row.
    db.migrations = db.migrations.filter(m => policy.approved.includes(migrationName(m)));
    const executed = await db.runMigrations({ transaction: 'all' });
    if (executed.some(m => !policy.approved.includes(m.name))) fail('UNEXPECTED_EXECUTED_MIGRATION');
    const after = await readScope(db, policy);
    if (after.pending.length) fail('MIGRATION_COMPLETION_NOT_VERIFIED');
    return { mode, before, executed: executed.map(m => m.name), after };
  } finally { await db.destroy(); }
}

function safeFlags(env) {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) =>
    /^(COMMERCE_OWNS_|CRON_|WINBACK_OWNER$|CUSTOMER_METRICS_TO_JOSH$|RESEARCH_FREE_WORKER_ENABLED$|SCRAPING_CRON_DISABLED$)|_SOURCE$/.test(k) &&
    !/SECRET|PASSWORD|TOKEN|KEY/.test(k) && /^[A-Za-z0-9_,.-]{0,80}$/.test(v)).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, 'platform-migration-policy.json'), 'utf8'));
  validateTarget(policy, process.env);
  const mode = process.argv[2];
  if (mode === 'run') {
    if (!/^[a-f0-9]{64}$/.test(process.env.MIGRATION_SCOPE_EXPECTED_FINGERPRINT || '')) fail('UNVERIFIED_RUNNING_CONFIGURATION');
    verifyApprovedCode(policy, '/app/src/migrations');
  }
  require('/app/node_modules/reflect-metadata');
  const { AppDataSource } = require('/app/src/data-source');
  const result = await executeScope(AppDataSource, policy, mode, {
    expectedFingerprint: process.env.MIGRATION_SCOPE_EXPECTED_FINGERPRINT, env: process.env,
  });
  console.log('migration scope verified:', JSON.stringify({ sourceCommit: policy.sourceCommit, ...result, flags: safeFlags(process.env) }));
  if (mode === 'preflight') console.log('migration scope fingerprint:', result.fingerprint);
}

module.exports = { ScopeError, validatePolicy, pendingNames, validateTarget, readScope, executeScope, safeFlags, verifyApprovedCode, configurationFingerprint };
if (require.main === module || process.argv[1] === '-') main().catch(error => {
  // Connection/driver errors may contain configuration. Print only the controlled code.
  console.error('migration scope failed:', error instanceof ScopeError ? error.code : 'METADATA_OR_MIGRATION_EXECUTION_FAILED');
  if (error instanceof ScopeError && error.details) console.error('migration scope metadata:', JSON.stringify(error.details));
  process.exitCode = 1;
});
