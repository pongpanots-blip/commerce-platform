/**
 * One-off copy of data that moved from josh to commerce-platform.
 *
 *   JOSH_DATABASE_URL=postgres://readonly@josh-db/webjosh_db npm run import-from-josh -- research
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- scraping
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- competitor   (needs scraping first)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- sales-reps   (stage 2b; re-run on switch day)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- erp-sales-history   (stage 2c; static ERP export)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- prices   (stage 4a; prices + MER queue, before the switch)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- contents   (stage 4b; product content, before the switch)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- categories   (stage 4c; category tree + brands, replaced, before the switch)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- masters   (stage 4d; ERP product master of live SKUs + its MER queue, before the switch)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- images   (stage 4e; product galleries, before the switch)
 *   JOSH_DATABASE_URL=… npm run import-from-josh -- ordering   (stage 4f; supplier order rounds + SKU logistics fields, before the switch)
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
 *   Also copies non-customer users → josh_staff (source_version 0) so the sales app can sign in and CS can assign a
 *   rep before the stage 2c staff.snapshot backfill. A later snapshot (version > 0) is left as josh sent it.
 * Commerce side: uses the normal COMMERCE_DB_* / COMMERCE_DATABASE_URL env.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { JoshCatalogSyncService } from '../modules/integration/connector/josh/josh-catalog-sync.service';
import { JoshCatalogProduct } from '../modules/integration/connector/josh/josh-catalog-product.entity';
import { JoshReplica } from '../modules/integration/connector/josh/josh-replica';
import { JOSH_CONTENT_SQL } from '../modules/commerce/product-contents/content-fields';
import { CATEGORY_COLUMNS } from '../modules/commerce/product-categories/category-rules';
import { JOSH_MASTER_SQL, MASTER_KEYS } from '../modules/commerce/product-masters/master-fields';
import { JOSH_IMAGES_SQL } from '../modules/commerce/product-images/josh-images.sql';
import { JOSH_ORDER_PERIODS_SQL } from '../modules/commerce/ordering/order-periods';
import { JOSH_LOGISTICS_SQL, logisticsFromJosh } from '../modules/commerce/ordering/logistics-fields';

type Scope = 'research' | 'scraping' | 'competitor' | 'segments' | 'sales-reps' | 'erp-sales-history' | 'prices' | 'contents' | 'categories' | 'masters' | 'images' | 'ordering';
/**
 * userColumns → commerce staff id (by email) · emailColumns → the josh user's email · key: upsert key, comma-separated
 * for a composite one (default id) · target: commerce table when it differs · customerColumn: keep only rows whose
 * user is in commerce's customer copy (josh_customers) · pageBy: read and write in pages ordered by this column (big tables;
 * no user remapping).
 */
type Plan = { table: string; userColumns?: string[]; emailColumns?: string[]; key?: string; target?: string; customerColumn?: string; pageBy?: string };
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
  // stage 2c: the static ERP invoice export winback's sync reads (~554K lines), only the columns commerce keeps.
  'erp-sales-history': [{ table: 'erp_sales_history', target: 'josh_erp_sales_history', pageBy: 'id' }],
  // stage 4a: every SKU's base price, ERP box price and MOQ (same column names) — run before COMMERCE_OWNS_PRICES; it
  // overwrites commerce's rows. The MER queue (erp_pending_payload's price / MOQ) follows in importPendingPrices.
  prices: [{ table: 'product_inventory', target: 'product_prices', key: 'product_inventory_sku', pageBy: 'product_inventory_sku' }],
  // Stage 4b: built by JOSH_CONTENT_SQL (inventory columns + th / en translation) in importContents.
  contents: [],
  // Stage 4c: replaced whole in importCategories (codes are unique, so a row-by-row upsert can collide).
  categories: [],
  // Stage 4d: built by JOSH_MASTER_SQL in importMasters.
  masters: [],
  // Stage 4e: galleries built by JOSH_IMAGES_SQL in importImages.
  images: [],
  ordering: [],
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

  if (plan.pageBy) return copyPaged(josh, commerce, plan, into, cols, keys);
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

/** Stage 4a: the price / MOQ part of josh's MER queue (erp_pending_payload) → product_price_pending (replaced). */
async function importPendingPrices(josh: DataSource, commerce: DataSource) {
  const rows: Array<{ sku: string; sell: string | null; ord: string | null; moq: number | null; at: Date | null }> = await josh.query(
    `SELECT product_inventory_sku AS sku, erp_pending_payload->>'selling_unit_price' AS sell, erp_pending_payload->>'ordering_price' AS ord,
            (erp_pending_payload->>'moq')::int AS moq, erp_pending_at AS at
       FROM product_inventory WHERE erp_pending_payload ?| array['selling_unit_price', 'ordering_price', 'moq']`);
  await commerce.transaction(async (m) => {
    await m.query(`DELETE FROM product_price_pending`);
    for (const r of rows) {
      await m.query(`INSERT INTO product_price_pending (product_inventory_sku, selling_unit_price, ordering_price, moq, changed_at) VALUES ($1, $2, $3, $4, $5)`,
        [r.sku, r.sell, r.ord, r.moq, r.at]);
    }
  });
  console.log(`erp_pending_payload (price / MOQ) → product_price_pending: ${rows.length} rows`);
}

/** Stage 4b: josh's content per SKU → product_contents (the whole row replaced; source import), pages of 1000 SKUs. */
async function importContents(josh: DataSource, commerce: DataSource) {
  let last = '';
  let total = 0;
  for (;;) {
    const rows: Array<{ sku: string; fields: Record<string, unknown> }> = await josh.query(
      `${JOSH_CONTENT_SQL} WHERE p.product_inventory_sku > $1 ORDER BY p.product_inventory_sku LIMIT 1000`, [last]);
    if (!rows.length) break;
    await commerce.query(
      `INSERT INTO product_contents (product_inventory_sku, fields, source, updated_by, updated_at)
       SELECT r.sku, r.fields, 'import', NULL, now() FROM jsonb_to_recordset($1::jsonb) AS r(sku varchar, fields jsonb)
       ON CONFLICT (product_inventory_sku) DO UPDATE SET fields = EXCLUDED.fields, source = 'import', updated_by = NULL, updated_at = now()`,
      [JSON.stringify(rows)]);
    total += rows.length;
    last = rows[rows.length - 1].sku;
  }
  console.log(`product_inventory (+ translations) → product_contents: ${total} SKUs`);
}

/** Stage 4c: josh's category tree and brands → product_categories / product_brands, replaced in one transaction. */
async function importCategories(josh: DataSource, commerce: DataSource) {
  const cols = CATEGORY_COLUMNS.join(', ');
  const tree = await josh.query(`SELECT ${cols} FROM product_category`);
  const brands = await josh.query(`SELECT id, brand_code, brand_name_th, brand_name_en FROM brand`);
  if (!tree.length) throw new Error('josh returned no categories — check JOSH_DATABASE_URL');
  await commerce.transaction(async (m) => {
    await m.query(`DELETE FROM product_categories`);
    await m.query(`INSERT INTO product_categories (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::product_categories, $1::jsonb)`, [JSON.stringify(tree)]);
    await m.query(`DELETE FROM product_brands`);
    await m.query(`INSERT INTO product_brands (id, brand_code, brand_name_th, brand_name_en)
      SELECT id, brand_code, brand_name_th, brand_name_en FROM jsonb_populate_recordset(NULL::product_brands, $1::jsonb)`, [JSON.stringify(brands)]);
  });
  console.log(`product_category → product_categories: ${tree.length} · brand → product_brands: ${brands.length}`);
}

/**
 * Stage 4d: josh's live products' ERP master → product_masters (paged by SKU), and the master part of josh's MER queue
 * (erp_pending_payload of live products) → product_master_pending (replaced).
 */
async function importMasters(josh: DataSource, commerce: DataSource) {
  let last = '';
  let total = 0;
  for (;;) {
    const rows: Array<{ sku: string; fields: Record<string, unknown> }> = await josh.query(
      `${JOSH_MASTER_SQL} AND p.product_inventory_sku > $1 ORDER BY p.product_inventory_sku LIMIT 1000`, [last]);
    if (!rows.length) break;
    await commerce.query(
      `INSERT INTO product_masters (product_inventory_sku, fields, source, updated_by, updated_at)
       SELECT r.sku, r.fields, 'import', NULL, now() FROM jsonb_to_recordset($1::jsonb) AS r(sku varchar, fields jsonb)
       ON CONFLICT (product_inventory_sku) DO UPDATE SET fields = EXCLUDED.fields, source = 'import', updated_by = NULL, updated_at = now()`,
      [JSON.stringify(rows)]);
    total += rows.length;
    last = rows[rows.length - 1].sku;
  }
  const keys = MASTER_KEYS.map((k) => `'${k}'`).join(', ');
  const pending: Array<{ sku: string; patch: Record<string, unknown>; at: Date | null }> = await josh.query(
    `SELECT product_inventory_sku AS sku, (SELECT jsonb_object_agg(k, v) FROM jsonb_each(erp_pending_payload) e(k, v) WHERE k IN (${keys})) AS patch,
            erp_pending_at AS at
       FROM product_inventory WHERE product_status IS DISTINCT FROM 'draft' AND erp_pending_payload ?| array[${keys}]`);
  await commerce.transaction(async (m) => {
    await m.query(`DELETE FROM product_master_pending`);
    for (const r of pending) {
      await m.query(`INSERT INTO product_master_pending (product_inventory_sku, patch, changed_at) VALUES ($1, $2, $3)`, [r.sku, JSON.stringify(r.patch), r.at]);
    }
  });
  console.log(`product_inventory (live) → product_masters: ${total} SKUs · erp_pending_payload (master keys) → product_master_pending: ${pending.length}`);
}

/** Stage 4e: josh's image rows → product_images (one ordered gallery per SKU), paged by SKU. */
async function importImages(josh: DataSource, commerce: DataSource) {
  let last = '';
  let total = 0;
  for (;;) {
    const rows: Array<{ sku: string; images: string[] }> = await josh.query(
      `SELECT * FROM (${JOSH_IMAGES_SQL}) g WHERE g.sku > $1 ORDER BY g.sku LIMIT 1000`, [last]);
    if (!rows.length) break;
    await commerce.query(
      `INSERT INTO product_images (product_inventory_sku, images, source, updated_by, updated_at)
       SELECT r.sku, r.images, 'import', NULL, now() FROM jsonb_to_recordset($1::jsonb) AS r(sku varchar, images jsonb)
       ON CONFLICT (product_inventory_sku) DO UPDATE SET images = EXCLUDED.images, source = 'import', updated_by = NULL, updated_at = now()`,
      [JSON.stringify(rows)]);
    total += rows.length;
    last = rows[rows.length - 1].sku;
  }
  console.log(`product_media (images) → product_images: ${total} SKUs`);
}

/**
 * Stage 4f: josh's supplier order rounds → supplier_order_periods (replaced: josh's table is the truth until the switch),
 * and every product's logistics columns → product_logistics (paged by SKU, normalised like a staff edit).
 */
async function importOrdering(josh: DataSource, commerce: DataSource) {
  const periods: Array<Record<string, unknown>> = await josh.query(JOSH_ORDER_PERIODS_SQL);
  const rows = periods.map((r) => ({ ...r, close_at: r.close_at == null ? null : new Date(r.close_at as string).toISOString() }));
  await commerce.transaction(async (m) => {
    await m.query(`DELETE FROM supplier_order_periods`);
    if (rows.length) {
      await m.query(
        `INSERT INTO supplier_order_periods (sup_code, erp_order_period, date_from, date_to, close_at, status, synced_at)
         SELECT r.sup_code, r.erp_order_period, r.date_from::date, r.date_to::date, r.close_at::timestamptz, r.status, now()
           FROM jsonb_to_recordset($1::jsonb) AS r(sup_code text, erp_order_period text, date_from text, date_to text, close_at text, status text)`,
        [JSON.stringify(rows)]);
    }
  });
  let last = '';
  let total = 0;
  for (;;) {
    const page: Array<Record<string, unknown> & { sku: string }> = await josh.query(
      `${JOSH_LOGISTICS_SQL} WHERE product_inventory_sku > $1 ORDER BY product_inventory_sku LIMIT 1000`, [last]);
    if (!page.length) break;
    await commerce.query(
      `INSERT INTO product_logistics (product_inventory_sku, fields, source, updated_by, updated_at)
       SELECT r.sku, r.fields, 'import', NULL, now() FROM jsonb_to_recordset($1::jsonb) AS r(sku varchar, fields jsonb)
       ON CONFLICT (product_inventory_sku) DO UPDATE SET fields = EXCLUDED.fields, source = 'import', updated_by = NULL, updated_at = now()`,
      [JSON.stringify(page.map((r) => ({ sku: r.sku, fields: logisticsFromJosh(r) })))]);
    total += page.length;
    last = page[page.length - 1].sku;
  }
  console.log(`supplier_order_period → supplier_order_periods: ${rows.length} rounds · product_inventory → product_logistics: ${total} SKUs`);
}

/**
 * Non-customer josh users → josh_staff. Same predicate as the stage 2c staff count (user_type IS DISTINCT FROM
 * 'customer'). source_version 0 so a staff.snapshot still wins; a staff.deleted tombstone is not resurrected.
 */
export const STAFF_FROM_JOSH_SQL = `SELECT u.id, u.email, u.first_name, u.last_name, u.role, r.user_type,
  COALESCE(u.is_active, true) AS is_active, COALESCE(u.token_version, 0) AS token_version,
  u.company_id, u.created_at, u.last_app_login_at
  FROM users u LEFT JOIN app_roles r ON r.code = u.role
  WHERE r.user_type IS DISTINCT FROM 'customer'`;

export async function importStaff(josh: DataSource, commerce: DataSource) {
  const rows: Array<Record<string, unknown>> = await josh.query(STAFF_FROM_JOSH_SQL);
  let wrote = 0;
  await commerce.transaction(async (m) => {
    for (const r of rows) {
      const saved: unknown[] = await m.query(
        `INSERT INTO josh_staff (id, email, first_name, last_name, role, user_type, is_active, token_version, company_id, created_at, last_app_login_at, source_version)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0
         WHERE NOT EXISTS (SELECT 1 FROM josh_reference_tombstones WHERE tbl = 'josh_staff' AND id = $1)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
           role = EXCLUDED.role, user_type = EXCLUDED.user_type, is_active = EXCLUDED.is_active, token_version = EXCLUDED.token_version,
           company_id = EXCLUDED.company_id, created_at = EXCLUDED.created_at, last_app_login_at = EXCLUDED.last_app_login_at
         WHERE josh_staff.source_version = 0
         RETURNING id`,
        [r.id, r.email, r.first_name, r.last_name, r.role, r.user_type, r.is_active, r.token_version, r.company_id, r.created_at, r.last_app_login_at]);
      if (saved.length) wrote++;
    }
  });
  console.log(`users (non-customer) → josh_staff: ${wrote} rows (of ${rows.length}; event-owned rows kept)`);
}

const PAGE = 5000;

/** Big tables: pages of PAGE rows by plan.pageBy, one multi-row upsert each, so memory stays flat. */
async function copyPaged(josh: DataSource, commerce: DataSource, plan: Plan, into: string, cols: string[], keys: string[]) {
  const by = q(plan.pageBy!);
  const rest = cols.filter((c) => !keys.includes(c));
  let last: unknown = null;
  let total = 0;
  for (;;) {
    const rows: Record<string, unknown>[] = await josh.query(
      `SELECT ${cols.map(q).join(', ')} FROM ${q(plan.table)} ${last === null ? '' : `WHERE ${by} > $1`} ORDER BY ${by} LIMIT ${PAGE}`,
      last === null ? [] : [last]);
    if (!rows.length) break;
    const values = rows.map((_, r) => `(${cols.map((__, c) => `$${r * cols.length + c + 1}`).join(', ')})`).join(', ');
    await commerce.query(
      `INSERT INTO ${q(into)} (${cols.map(q).join(', ')}) VALUES ${values}
       ON CONFLICT (${keys.map(q).join(', ')}) DO ${rest.length ? `UPDATE SET ${rest.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}` : 'NOTHING'}`,
      rows.flatMap((row) => cols.map((c) => row[c])));
    total += rows.length;
    last = rows[rows.length - 1][plan.pageBy!];
  }
  console.log(`${plan.table} → ${into}: ${total} rows upserted in pages of ${PAGE}`);
}

async function main() {
  const scope = process.argv[2] as Scope | 'all' | undefined;
  const url = process.env.JOSH_DATABASE_URL;
  if (!url || !scope || !['research', 'scraping', 'competitor', 'segments', 'sales-reps', 'erp-sales-history', 'prices', 'contents', 'categories', 'masters', 'images', 'ordering', 'all'].includes(scope)) {
    console.error('usage: JOSH_DATABASE_URL=… import-from-josh <research|scraping|competitor|segments|sales-reps|erp-sales-history|prices|contents|categories|masters|images|ordering|all>');
    process.exit(1);
  }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const users = await userMaps(josh, commerce);
    const scopes = scope === 'all' ? (['research', 'scraping', 'competitor', 'segments', 'sales-reps', 'erp-sales-history', 'prices', 'contents', 'categories', 'masters', 'images', 'ordering'] as const) : [scope];
    for (const s of scopes) {
      if (s === 'competitor') {
        const replica = new JoshReplica();
        const sync = new JoshCatalogSyncService(commerce.getRepository(JoshCatalogProduct), replica);
        try { console.log(`josh_catalog_products: ${await sync.syncAll()} products synced`); } finally { await replica.onModuleDestroy(); }
      }
      for (const plan of PLANS[s]) await copy(josh, commerce, plan, users);
      if (s === 'sales-reps') await importStaff(josh, commerce);
      if (s === 'prices') await importPendingPrices(josh, commerce);
      if (s === 'contents') await importContents(josh, commerce);
      if (s === 'categories') await importCategories(josh, commerce);
      if (s === 'masters') await importMasters(josh, commerce);
      if (s === 'images') await importImages(josh, commerce);
      if (s === 'ordering') await importOrdering(josh, commerce);
    }
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
