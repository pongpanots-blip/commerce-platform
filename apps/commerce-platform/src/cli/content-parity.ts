/**
 * Stage 4b check: does josh hold the product content commerce has?
 *
 *   JOSH_DATABASE_URL=<josh read-only> npm run content-parity
 *
 * Per SKU, every key commerce holds in product_contents vs the same key built from josh (JOSH_CONTENT_SQL). SKUs only
 * josh has (new drafts from the ERP, not edited in commerce yet) are listed as joshOnly — josh's values stand for them.
 * Before the switch run it after import-from-josh -- contents; after the switch it shows any SKU josh did not take
 * from product.content.snapshot. Exit code 1 when anything differs.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { JOSH_CONTENT_SQL } from '../modules/commerce/product-contents/content-fields';

type Row = { sku: string; fields: Record<string, unknown> };
// numeric 12.50 and 12.5 are the same value; '' and null are not (josh keeps both).
const norm = (v: unknown) => (typeof v === 'number' ? v.toFixed(2) : JSON.stringify(v ?? null));

async function main() {
  const url = process.env.JOSH_DATABASE_URL;
  if (!url) { console.error('JOSH_DATABASE_URL (read-only) is required'); process.exit(1); }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const [a, b]: [Row[], Row[]] = await Promise.all([
      josh.query(JOSH_CONTENT_SQL),
      commerce.query(`SELECT product_inventory_sku AS sku, fields FROM product_contents`),
    ]);
    const theirs = new Map(a.map((r) => [r.sku, r.fields]));
    const mine = new Set(b.map((r) => r.sku));
    const different: Array<{ sku: string; key: string; josh: unknown; commerce: unknown }> = [];
    const missingInJosh: string[] = [];
    for (const r of b) {
      const j = theirs.get(r.sku);
      if (!j) { missingInJosh.push(r.sku); continue; }
      for (const [key, v] of Object.entries(r.fields)) {
        if (norm(v) !== norm(j[key])) different.push({ sku: r.sku, key, josh: j[key] ?? null, commerce: v });
      }
    }
    const joshOnly = a.filter((r) => !mine.has(r.sku)).map((r) => r.sku);
    const skusDifferent = new Set(different.map((d) => d.sku)).size;
    console.log(JSON.stringify({ josh: a.length, commerce: b.length, same: b.length - skusDifferent - missingInJosh.length,
      different: skusDifferent, fieldsDifferent: different.length, missingInJosh: missingInJosh.length, joshOnly: joshOnly.length,
      sample: different.slice(0, 20), missingInJoshSample: missingInJosh.slice(0, 20), joshOnlySample: joshOnly.slice(0, 20) }, null, 2));
    if (different.length || missingInJosh.length) process.exitCode = 1;
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
