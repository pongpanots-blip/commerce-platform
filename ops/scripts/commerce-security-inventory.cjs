// Read-only counts only: no emails, names, IDs, key prefixes, hashes or secrets.
require('reflect-metadata');
const { AppDataSource } = require('./src/data-source');
(async () => {
  const db = await AppDataSource.initialize();
  const runner = db.createQueryRunner();
  try {
    await runner.connect();
    await runner.query('BEGIN READ ONLY');
    await runner.query("SET LOCAL statement_timeout = '10s'");
    const [accounts] = await runner.query(`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'active')::int AS active,
      count(*) FILTER (WHERE role = 'developer')::int AS developers,
      count(*) FILTER (WHERE role = 'developer' AND status = 'active')::int AS active_developers
      FROM users WHERE deleted_at IS NULL`);
    const [keys] = await runner.query(`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE k.active AND k.revoked_at IS NULL)::int AS active,
      count(*) FILTER (WHERE k.active AND k.revoked_at IS NULL AND u.role = 'developer')::int AS active_developer_keys,
      count(*) FILTER (WHERE k.active AND k.revoked_at IS NULL AND (u.id IS NULL OR u.status <> 'active'))::int AS active_keys_missing_active_owner,
      count(*) FILTER (WHERE k.active AND k.revoked_at IS NULL AND k.last_used_at > now() - interval '30 days')::int AS active_keys_used_30d
      FROM api_keys k LEFT JOIN users u ON u.id = k.account_id AND u.deleted_at IS NULL
      WHERE k.deleted_at IS NULL`);
    const [subscriptions] = await runner.query(`SELECT
      count(*) FILTER (WHERE active AND account_id IS NULL)::int AS active_admin,
      count(*) FILTER (WHERE active AND account_id IS NOT NULL)::int AS active_portal
      FROM webhook_subscriptions WHERE deleted_at IS NULL`);
    await runner.query('COMMIT');
    console.log('security inventory counts:', JSON.stringify({ accounts, keys, subscriptions }));
    console.log('PASS: read-only inventory counts; no account/key changes');
  } finally {
    await runner.query('ROLLBACK').catch(() => {});
    await runner.release();
    await db.destroy();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
