/**
 * One-off copy of data that moved from josh to commerce-platform.
 *
 *   JOSH_DATABASE_URL=postgres://readonly@josh-db/webjosh_db npm run import-from-josh -- research
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- scraping
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- competitor   (needs scraping first)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- sales-reps   (stage 2b; re-run on switch day)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- all
 *
 * - Reads josh with SELECTs only (use a read-only user / the replica).
 * - Same ids, upsert on id → safe to re-run; run it again right before
 *   switching traffic to pick up anything written in between.
 * - User ids (research createdBy/requestedBy/keptBy) are remapped by email to
 *   the commerce staff account with the same email; unmatched ids are kept
 *   and counted (those rows stay manageable by commerce admins only).
 * - competitor: first pulls josh's catalog into josh_catalog_products (same as
 *   the scheduled JoshCatalogSyncService), then copies competitor_prices and the
 *   review grid's answers (competitor_match_rejections / _reviews);
 * - segments (stage 2a): user_segments → segments (same ids) and their frozen members
 *   segment_membership_snapshots → segment_members, customers only (staff are matched in josh);
 *   verified_by (a josh user id) becomes that josh user's email.
 * - sales-reps (stage 2b): every josh company's rep → company_sales_reps (same ids; id, assigned_sales_user_id, updated_at).
 * Commerce side: uses the normal COMMERCE_DB_* / COMMERCE_DATABASE_URL env.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { JoshCatalogSyncService } from '../modules/integration/connector/josh/josh-catalog-sync.service';
import { JoshCatalogProduct } from '../modules/integration/connector/josh/josh-catalog-product.entity';
import { JoshReplica } from '../modules/integration/connector/josh/josh-replica';

type Scope = 'research' | 'scraping' | 'competitor' | 'segments' | 'sales-reps';
/**
 * userColumns → commerce staff id (by email) · emailColumns → the josh user's email · key: upsert key, comma-separated
 * for a composite one (default id) · target: commerce table when it differs · customerColumn: keep only rows whose
 * user is in commerce's customer copy (josh_customers).
 */
type Plan = { table: string; userColumns?: string[]; emailColumns?: string[]; key?: string; target?: string; customerColumn?: string };
const PLANS: Record<Scope, Plan[]> = {
  research: [
    { table: 'marketing_research_topics', userColumns: ['createdBy'] },
    { table: 'marketing_research_runs', userColumns: ['requestedBy', 'keptBy'] },
  ],
  // Parents before children (scraped_items.source_id → scraping_sources.id).
  scraping: [{ table: 'scraping_sources' }, { table: 'scraped_items' }],
  competitor: [
    { table: 'competitor_prices', emailColumns: ['verified_by'] },
    { table: 'competitor_match_rejections', emailColumns: ['created_by'] },
    { table: 'competitor_match_reviews', emailColumns: ['reviewed_by'], key: 'product_id' },
  ],
  segments: [
    { table: 'user_segments', target: 'segments' },
    { table: 'segment_membership_snapshots', target: 'segment_members', key: 'segment_id,user_id', customerColumn: 'user_id' },
  ],
  'sales-reps': [{ table: 'company', target: 'company_sales_reps' }],
};

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function columnsOf(ds: DataSource, table: string): Promise<string[]> {
  const rows: { column_name: string }[] = await ds.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table]);
  return rows.map((r) => r.column_name);
}

type UserMaps = { staffId: Map<string, string>; email: Map<string, string> };

async function userMaps(josh: DataSource, commerce: DataSource): Promise<UserMaps> {
  const joshUsers: { id: string; email: string | null }[] = await josh.query(`SELECT id::text AS id, lower(email) AS email FROM users WHERE email IS NOT NULL`);
  const staff: { id: string; email: string }[] = await commerce.query(`SELECT id::text AS id, lower(email) AS email FROM users`);
  const byEmail = new Map(staff.map((s) => [s.email, s.id]));
  const maps: UserMaps = { staffId: new Map(), email: new Map() };
  for (const u of joshUsers) {
    if (u.email) maps.email.set(u.id, u.email);
    const id = u.email && byEmail.get(u.email); if (id) maps.staffId.set(u.id, id);
  }
  return maps;
}

async function copy(josh: DataSource, commerce: DataSource, plan: Plan, users: UserMaps) {
  const into = plan.target ?? plan.table;
  const target = await columnsOf(commerce, into);
  const source = new Set(await columnsOf(josh, plan.table));
  if (!target.length) throw new Error(`commerce has no table ${into} — run migrations first`);
  if (!source.size) throw new Error(`josh has no table ${plan.table}`);
  const keys = (plan.key ?? 'id').split(',');
  const cols = target.filter((c) => source.has(c));
  const missing = target.filter((c) => !source.has(c));

  let rows: Record<string, unknown>[] = await josh.query(`SELECT ${cols.map(q).join(', ')} FROM ${q(plan.table)}`);
  let skipped = 0;
  if (plan.customerColumn) {
    const customers = new Set((await commerce.query(`SELECT id::text AS id FROM josh_customers WHERE deleted_at IS NULL`)).map((r: { id: string }) => r.id));
    const kept = rows.filter((row) => customers.has(String(row[plan.customerColumn!])));
    skipped = rows.length - kept.length;
    rows = kept;
  }
  let unmatchedUsers = 0;
  const rest = cols.filter((c) => !keys.includes(c));
  const sql = `INSERT INTO ${q(into)} (${cols.map(q).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
    ON CONFLICT (${keys.map(q).join(', ')}) DO ${rest.length ? `UPDATE SET ${rest.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}` : 'NOTHING'}`;

  await commerce.transaction(async (m) => {
    for (const row of rows) {
      for (const [cols, map] of [[plan.userColumns, users.staffId], [plan.emailColumns, users.email]] as const) {
        for (const col of cols ?? []) {
          const id = row[col] as string | null;
          if (!id) continue;
          const mapped = map.get(String(id));
          if (mapped) row[col] = mapped; else unmatchedUsers++;
        }
      }
      // pg needs json/jsonb values as JSON text.
      await m.query(sql, cols.map((c) => (row[c] !== null && typeof row[c] === 'object' && !(row[c] instanceof Date) ? JSON.stringify(row[c]) : row[c])));
    }
  });
  console.log(`${plan.table}${into !== plan.table ? ` → ${into}` : ''}: ${rows.length} rows upserted` +
    (skipped ? ` · ${skipped} rows of users not in the customer copy skipped` : '') +
    (missing.length ? ` · columns only in commerce (left default): ${missing.join(', ')}` : '') +
    (plan.userColumns || plan.emailColumns ? ` · user ids without a matching commerce staff email: ${unmatchedUsers}` : ''));
}

async function main() {
  const scope = process.argv[2] as Scope | 'all' | undefined;
  const url = process.env.JOSH_DATABASE_URL;
  if (!url || !scope || !['research', 'scraping', 'competitor', 'segments', 'sales-reps', 'all'].includes(scope)) {
    console.error('usage: JOSH_DATABASE_URL=… import-from-josh <research|scraping|competitor|segments|sales-reps|all>');
    process.exit(1);
  }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const users = await userMaps(josh, commerce);
    const scopes = scope === 'all' ? (['research', 'scraping', 'competitor', 'segments', 'sales-reps'] as const) : [scope];
    for (const s of scopes) {
      if (s === 'competitor') {
        const replica = new JoshReplica();
        const sync = new JoshCatalogSyncService(commerce.getRepository(JoshCatalogProduct), replica);
        try { console.log(`josh_catalog_products: ${await sync.syncAll()} products synced`); } finally { await replica.onModuleDestroy(); }
      }
      for (const plan of PLANS[s]) await copy(josh, commerce, plan, users);
    }
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
