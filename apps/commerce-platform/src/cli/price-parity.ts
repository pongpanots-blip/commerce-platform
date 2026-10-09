/**
 * Stage 4a check: does commerce hold the same ERP price and MOQ per SKU as josh?
 *
 *   JOSH_DATABASE_URL=<josh read-only> npm run price-parity
 *
 * Compares commerce product_prices (ERP PRICE per order unit) with josh product_inventory. josh keeps no ERP rate since its
 * total-price model: it stores original_price = ERP PRICE × the sell-unit factor (resolveSellUnit), so commerce's price is
 * scaled the same way before comparing (2 decimals, plus MOQ). Before the switch run it after
 * import-from-josh -- prices; after the switch it shows any SKU josh did not take from product.price.snapshot.
 * Exit code 1 when anything differs.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { resolveSellUnit, type JoshOrderUnitSource } from '../shared-kernel/helpers/pack-order-price.helper';

type Price = { sku: string; price: number | null; moq: number | null };
const key = (p: Price) => [p.price == null ? '' : p.price.toFixed(2), p.moq ?? ''].join('|');
const money = (v: unknown) => (v == null ? null : Number(v));

/** commerce's ERP PRICE as the sell-unit total josh derives from it (josh applyErpPrice). */
export function erpPriceAsJoshTotal(ord: unknown, inv: JoshOrderUnitSource): number | null {
  const price = money(ord);
  return price == null ? null : Math.round(price * resolveSellUnit(inv).factor * 100) / 100;
}

async function main() {
  const url = process.env.JOSH_DATABASE_URL;
  if (!url) { console.error('JOSH_DATABASE_URL (read-only) is required'); process.exit(1); }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const [joshRows, commerceRows] = await Promise.all([
      josh.query(`SELECT product_inventory_sku AS sku, original_price, moq, order_taking_unit, sub_packing_unit, selling_unit,
        pack_size, units_per_box, weight_per_unit FROM product_inventory`),
      commerce.query(`SELECT product_inventory_sku AS sku, ordering_price, moq FROM product_prices`),
    ]);
    const joshBySku = new Map<string, JoshOrderUnitSource>(joshRows.map((r: JoshOrderUnitSource & { sku: string }) => [r.sku, r]));
    const a: Price[] = joshRows.map((r: { sku: string; original_price: unknown; moq: number | null }) => ({ sku: r.sku, price: money(r.original_price), moq: r.moq }));
    const b: Price[] = commerceRows.map((r: { sku: string; ordering_price: unknown; moq: number | null }) =>
      ({ sku: r.sku, price: erpPriceAsJoshTotal(r.ordering_price, joshBySku.get(r.sku) ?? {}), moq: r.moq }));
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

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
