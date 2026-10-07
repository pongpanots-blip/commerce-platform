/**
 * Stage 4d check: does josh hold the ERP product master commerce has?
 *
 *   JOSH_DATABASE_URL=<josh read-only> npm run master-parity
 *
 * Per live SKU, every key commerce holds in product_masters vs the same key built from josh (JOSH_MASTER_SQL). Live
 * SKUs commerce has no row for (activated drafts, not changed since) are listed as joshOnly — josh's values stand.
 * Exit code 1 when anything differs.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { JOSH_MASTER_SQL } from '../modules/commerce/product-masters/master-fields';

type Row = { sku: string; fields: Record<string, unknown> };
// Season dates: josh stores a date, the ERP sends a date or a timestamp — compare the day.
const norm = (k: string, v: unknown) => (k.startsWith('season_') && typeof v === 'string' ? v.slice(0, 10) : JSON.stringify(v ?? null));

async function main() {
  const url = process.env.JOSH_DATABASE_URL;
  if (!url) { console.error('JOSH_DATABASE_URL (read-only) is required'); process.exit(1); }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const [a, b]: [Row[], Row[]] = await Promise.all([
      josh.query(JOSH_MASTER_SQL),
      commerce.query(`SELECT product_inventory_sku AS sku, fields FROM product_masters`),
    ]);
    const theirs = new Map(a.map((r) => [r.sku, r.fields]));
    const mine = new Set(b.map((r) => r.sku));
    const different: Array<{ sku: string; key: string; josh: unknown; commerce: unknown }> = [];
    const notLiveInJosh: string[] = [];
    for (const r of b) {
      const j = theirs.get(r.sku);
      if (!j) { notLiveInJosh.push(r.sku); continue; }
      for (const [key, v] of Object.entries(r.fields)) if (norm(key, v) !== norm(key, j[key])) different.push({ sku: r.sku, key, josh: j[key] ?? null, commerce: v });
    }
    const joshOnly = a.filter((r) => !mine.has(r.sku)).map((r) => r.sku);
    const skus = new Set(different.map((d) => d.sku)).size;
    console.log(JSON.stringify({ josh: a.length, commerce: b.length, same: b.length - skus - notLiveInJosh.length, different: skus,
      fieldsDifferent: different.length, notLiveInJosh: notLiveInJosh.length, joshOnly: joshOnly.length,
      sample: different.slice(0, 20), notLiveInJoshSample: notLiveInJosh.slice(0, 20), joshOnlySample: joshOnly.slice(0, 20) }, null, 2));
    if (different.length || notLiveInJosh.length) process.exitCode = 1;
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
