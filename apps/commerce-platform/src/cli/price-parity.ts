/**
 * Stage 4a check: does commerce hold the same base price, ERP box price and MOQ per SKU as josh?
 *
 *   JOSH_DATABASE_URL=<josh read-only> npm run price-parity
 *
 * Compares commerce product_prices with josh product_inventory (2-decimal prices, MOQ). Before the switch run it after
 * import-from-josh -- prices; after the switch it shows any SKU josh did not take from product.price.snapshot.
 * Exit code 1 when anything differs.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';

type Price = { sku: string; sell: string | null; ord: string | null; moq: number | null };
const key = (p: Price) => [p.sell == null ? '' : Number(p.sell).toFixed(2), p.ord == null ? '' : Number(p.ord).toFixed(2), p.moq ?? ''].join('|');

async function main() {
  const url = process.env.JOSH_DATABASE_URL;
  if (!url) { console.error('JOSH_DATABASE_URL (read-only) is required'); process.exit(1); }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const sql = (t: string) => `SELECT product_inventory_sku AS sku, selling_unit_price AS sell, ordering_price AS ord, moq FROM ${t}`;
    const [a, b]: [Price[], Price[]] = await Promise.all([josh.query(sql('product_inventory')), commerce.query(sql('product_prices'))]);
    const mine = new Map(b.map((p) => [p.sku, p]));
    const different: Array<{ sku: string; josh: string; commerce: string }> = [];
    const missing: string[] = [];
    for (const p of a) {
      const c = mine.get(p.sku);
      if (!c) missing.push(p.sku);
      else if (key(c) !== key(p)) different.push({ sku: p.sku, josh: key(p), commerce: key(c) });
    }
    console.log(JSON.stringify({ josh: a.length, commerce: b.length, same: a.length - different.length - missing.length,
      different: different.length, missing: missing.length, sample: different.slice(0, 20), missingSample: missing.slice(0, 20) }, null, 2));
    if (different.length || missing.length) process.exitCode = 1;
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
