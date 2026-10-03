/**
 * One-off copy of data that moved from josh to commerce-platform.
 *
 *   JOSH_DATABASE_URL=postgres://readonly@josh-db/webjosh_db npm run import-from-josh -- research
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- scraping
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- all
 *
 * - Reads josh with SELECTs only (use a read-only user / the replica).
 * - Same ids, upsert on id → safe to re-run; run it again right before
 *   switching traffic to pick up anything written in between.
 * - User ids (research createdBy/requestedBy/keptBy) are remapped by email to
 *   the commerce staff account with the same email; unmatched ids are kept
 *   and counted (those rows stay manageable by commerce admins only).
 * Commerce side: uses the normal COMMERCE_DB_* / COMMERCE_DATABASE_URL env.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';

type Plan = { table: string; userColumns?: string[] };
const PLANS: Record<'research' | 'scraping', Plan[]> = {
  research: [
    { table: 'marketing_research_topics', userColumns: ['createdBy'] },
    { table: 'marketing_research_runs', userColumns: ['requestedBy', 'keptBy'] },
  ],
  // Parents before children (scraped_items.source_id → scraping_sources.id).
  scraping: [{ table: 'scraping_sources' }, { table: 'scraped_items' }],
};

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function columnsOf(ds: DataSource, table: string): Promise<string[]> {
  const rows: { column_name: string }[] = await ds.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table]);
  return rows.map((r) => r.column_name);
}

async function userIdMap(josh: DataSource, commerce: DataSource): Promise<Map<string, string>> {
  const joshUsers: { id: string; email: string | null }[] = await josh.query(`SELECT id::text AS id, lower(email) AS email FROM users WHERE email IS NOT NULL`);
  const staff: { id: string; email: string }[] = await commerce.query(`SELECT id::text AS id, lower(email) AS email FROM users`);
  const byEmail = new Map(staff.map((s) => [s.email, s.id]));
  const map = new Map<string, string>();
  for (const u of joshUsers) { const id = u.email && byEmail.get(u.email); if (id) map.set(u.id, id); }
  return map;
}

async function copy(josh: DataSource, commerce: DataSource, plan: Plan, users: Map<string, string>) {
  const target = await columnsOf(commerce, plan.table);
  const source = new Set(await columnsOf(josh, plan.table));
  if (!target.length) throw new Error(`commerce has no table ${plan.table} — run migrations first`);
  if (!source.size) throw new Error(`josh has no table ${plan.table}`);
  const cols = target.filter((c) => source.has(c));
  const missing = target.filter((c) => !source.has(c));

  const rows: Record<string, unknown>[] = await josh.query(`SELECT ${cols.map(q).join(', ')} FROM ${q(plan.table)}`);
  let unmatchedUsers = 0;
  const sql = `INSERT INTO ${q(plan.table)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
    ON CONFLICT ("id") DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}`;

  await commerce.transaction(async (m) => {
    for (const row of rows) {
      for (const col of plan.userColumns ?? []) {
        const id = row[col] as string | null;
        if (!id) continue;
        const mapped = users.get(String(id));
        if (mapped) row[col] = mapped; else unmatchedUsers++;
      }
      // pg needs json/jsonb values as JSON text.
      await m.query(sql, cols.map((c) => (row[c] !== null && typeof row[c] === 'object' && !(row[c] instanceof Date) ? JSON.stringify(row[c]) : row[c])));
    }
  });
  console.log(`${plan.table}: ${rows.length} rows upserted` +
    (missing.length ? ` · columns only in commerce (left default): ${missing.join(', ')}` : '') +
    (plan.userColumns ? ` · user ids without a matching commerce staff email: ${unmatchedUsers}` : ''));
}

async function main() {
  const scope = process.argv[2] as 'research' | 'scraping' | 'all' | undefined;
  const url = process.env.JOSH_DATABASE_URL;
  if (!url || !scope || !['research', 'scraping', 'all'].includes(scope)) {
    console.error('usage: JOSH_DATABASE_URL=… import-from-josh <research|scraping|all>');
    process.exit(1);
  }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const users = await userIdMap(josh, commerce);
    const scopes = scope === 'all' ? (['research', 'scraping'] as const) : [scope];
    for (const s of scopes) for (const plan of PLANS[s]) await copy(josh, commerce, plan, users);
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
