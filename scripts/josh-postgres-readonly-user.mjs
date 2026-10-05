#!/usr/bin/env node
/**
 * Creates (or rotates) commerce's READ-ONLY role on josh's Postgres, for JOSH_DATABASE_URL.
 * The role can SELECT josh's tables (today's and future ones) and nothing else: no writes,
 * no DDL, sessions read-only by default, and a statement timeout so a slow report cannot
 * hold the replica.
 *
 * Run once on josh's PRIMARY (roles replicate to the read replica) by someone holding the
 * josh DB admin / table-owner credentials, from a machine that can reach it:
 *
 *   JOSH_PG_ADMIN_URL='postgres://<admin>:<pw>@<primary>:5432/<josh db>?sslmode=require' \
 *   COMMERCE_PG_HOST='<read replica host commerce will use>' \
 *   node scripts/josh-postgres-readonly-user.mjs
 *
 * The password is sent as a SCRAM hash (never plain text, so it cannot land in josh's
 * statement log). The connection string is written to ./josh-postgres-url.secret (mode 600),
 * never printed — put it in commerce's env as JOSH_DATABASE_URL and delete the file.
 * Running it again rotates the password.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const ROLE = process.env.COMMERCE_PG_USER || 'commerce_ro';
const SCHEMA = process.env.JOSH_PG_SCHEMA || 'public';
const STATEMENT_TIMEOUT = process.env.COMMERCE_PG_STATEMENT_TIMEOUT || '60s';
const adminUrl = process.env.JOSH_PG_ADMIN_URL;
if (!adminUrl) {
  console.error('JOSH_PG_ADMIN_URL is required (josh Postgres admin connection string, primary).');
  process.exit(1);
}
const admin = new URL(adminUrl);
const database = decodeURIComponent(admin.pathname.slice(1));
if (!database) {
  console.error('JOSH_PG_ADMIN_URL must name josh\'s database (…/<db>).');
  process.exit(1);
}
const password = randomBytes(24).toString('base64url');

/** Postgres SCRAM-SHA-256 verifier (RFC 5802 / 7677), what CREATE ROLE … PASSWORD accepts pre-hashed. */
function scram(pw) {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(pw, salt, 4096, 32, 'sha256');
  const hmac = (key, s) => createHmac('sha256', key).update(s).digest();
  const storedKey = createHash('sha256').update(hmac(salted, 'Client Key')).digest();
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${storedKey.toString('base64')}:${hmac(salted, 'Server Key').toString('base64')}`;
}

const userUrl = (host) => {
  const u = new URL(adminUrl);
  u.username = ROLE;
  u.password = password;
  if (host) u.hostname = host;
  return u.toString();
};

const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
await client.connect();
try {
  const id = client.escapeIdentifier(ROLE);
  const schema = client.escapeIdentifier(SCHEMA);
  const secret = client.escapeLiteral(scram(password));
  const { rowCount: exists } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
  const attrs = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20 PASSWORD ${secret}`;
  await client.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${id} WITH ${attrs}`);
  console.log(`${exists ? 'rotated password of' : 'created'} ${ROLE}`);

  await client.query(`ALTER ROLE ${id} SET default_transaction_read_only = on`);
  await client.query(`ALTER ROLE ${id} SET statement_timeout = ${client.escapeLiteral(STATEMENT_TIMEOUT)}`);
  await client.query(`ALTER ROLE ${id} SET idle_in_transaction_session_timeout = '60s'`);
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(database)} TO ${id}`);
  await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${id}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${id}`);
  await client.query(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${id}`);

  // Tables josh's migrations create later: default privileges are per creating role, so set them for every table owner.
  const { rows: owners } = await client.query('SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = $1', [SCHEMA]);
  for (const { tableowner } of owners) {
    await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${client.escapeIdentifier(tableowner)} IN SCHEMA ${schema} GRANT SELECT ON TABLES TO ${id}`)
      .then(() => console.log(`future tables of ${tableowner}: SELECT granted`),
        (e) => console.warn(`WARN could not set default privileges for ${tableowner} (${e.message}) — new josh tables will need GRANT SELECT by hand`));
  }

  // Prove it before handing it over (via the host this machine reached): it reads, it cannot write even when it asks to.
  const ro = new pg.Client({ connectionString: userUrl(), connectionTimeoutMillis: 5000 });
  await ro.connect();
  try {
    const { rows: [t] } = await ro.query(`SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = $1 ORDER BY tablename LIMIT 1`, [SCHEMA]);
    if (!t) throw new Error(`no tables in schema ${SCHEMA} — wrong database?`);
    await ro.query(`SELECT * FROM ${schema}.${t.name} LIMIT 1`);
    const attempt = async (sql) => {
      await ro.query('BEGIN READ WRITE');
      try { await ro.query(sql); return true; } catch { return false; } finally { await ro.query('ROLLBACK'); }
    };
    if (await attempt(`DELETE FROM ${schema}.${t.name} WHERE false`)) throw new Error(`${ROLE} can DELETE from ${t.name} — check its grants`);
    if (await attempt(`CREATE TABLE ${schema}.commerce_ro_probe (x int)`)) {
      console.warn(`WARN ${ROLE} can create tables in ${SCHEMA} (PUBLIC has CREATE there, Postgres < 15 default). It still cannot touch josh's tables.`
        + ` To close it: REVOKE CREATE ON SCHEMA ${SCHEMA} FROM PUBLIC (check josh's own roles first).`);
    }
  } finally {
    await ro.end();
  }

  writeFileSync('josh-postgres-url.secret', `JOSH_DATABASE_URL=${userUrl(process.env.COMMERCE_PG_HOST)}\n`, { mode: 0o600 });
  console.log('verified: reads ok, writes refused');
  console.log('wrote ./josh-postgres-url.secret — copy into commerce env (JOSH_DATABASE_URL), then delete the file');
} finally {
  await client.end();
}
