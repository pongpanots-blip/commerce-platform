/**
 * Stage 4f check: does josh hold the supplier order rounds and SKU logistics commerce has?
 *
 *   JOSH_DATABASE_URL=<josh read-only> npm run ordering-parity
 *
 * Rounds: per (supplier, round) the dates, close time and status, both ways (missing in josh / missing in commerce).
 * Logistics: per SKU commerce holds, every key vs josh's column (read the same way as the import); SKUs josh has and
 * commerce does not are listed as joshOnly (new products since the import — josh's values stand).
 * Exit code 1 when anything differs.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../data-source';
import { JOSH_ORDER_PERIODS_SQL } from '../modules/commerce/ordering/order-periods';
import { JOSH_LOGISTICS_SQL, logisticsFromJosh } from '../modules/commerce/ordering/logistics-fields';

type Period = { sup_code: string; erp_order_period: string; date_from: string; date_to: string; close_at: string | Date | null; status: string };
const periodKey = (p: Period) => `${p.sup_code}/${p.erp_order_period}`;
const periodValue = (p: Period) => JSON.stringify([p.date_from, p.date_to, p.close_at == null ? null : new Date(p.close_at).toISOString(), p.status]);

async function main() {
  const url = process.env.JOSH_DATABASE_URL;
  if (!url) { console.error('JOSH_DATABASE_URL (read-only) is required'); process.exit(1); }
  const josh = await new DataSource({ type: 'postgres', url, entities: [] }).initialize();
  const commerce = await AppDataSource.initialize();
  try {
    const [jp, cp]: [Period[], Period[]] = await Promise.all([
      josh.query(JOSH_ORDER_PERIODS_SQL),
      commerce.query(`SELECT sup_code, erp_order_period, to_char(date_from, 'YYYY-MM-DD') AS date_from, to_char(date_to, 'YYYY-MM-DD') AS date_to, close_at, status FROM supplier_order_periods`),
    ]);
    const theirRounds = new Map(jp.map((p) => [periodKey(p), p]));
    const myRounds = new Set(cp.map(periodKey));
    const roundsDifferent: Array<{ round: string; josh: string; commerce: string }> = [];
    const roundsNotInJosh: string[] = [];
    for (const p of cp) {
      const j = theirRounds.get(periodKey(p));
      if (!j) roundsNotInJosh.push(periodKey(p));
      else if (periodValue(j) !== periodValue(p)) roundsDifferent.push({ round: periodKey(p), josh: periodValue(j), commerce: periodValue(p) });
    }
    const roundsNotInCommerce = jp.filter((p) => !myRounds.has(periodKey(p))).map(periodKey);

    const [jl, cl]: [Array<Record<string, unknown> & { sku: string }>, Array<{ sku: string; fields: Record<string, unknown> }>] = await Promise.all([
      josh.query(JOSH_LOGISTICS_SQL),
      commerce.query(`SELECT product_inventory_sku AS sku, fields FROM product_logistics`),
    ]);
    const theirs = new Map(jl.map((r) => [r.sku, logisticsFromJosh(r)]));
    const mine = new Set(cl.map((r) => r.sku));
    const different: Array<{ sku: string; key: string; josh: unknown; commerce: unknown }> = [];
    const notInJosh: string[] = [];
    for (const r of cl) {
      const j = theirs.get(r.sku);
      if (!j) { notInJosh.push(r.sku); continue; }
      for (const [key, v] of Object.entries(r.fields)) {
        if (JSON.stringify(v ?? null) !== JSON.stringify(j[key] ?? null)) different.push({ sku: r.sku, key, josh: j[key] ?? null, commerce: v });
      }
    }
    const joshOnly = jl.filter((r) => !mine.has(r.sku)).map((r) => r.sku);
    const skus = new Set(different.map((d) => d.sku)).size;
    console.log(JSON.stringify({
      rounds: { josh: jp.length, commerce: cp.length, different: roundsDifferent.length, notInJosh: roundsNotInJosh.length, notInCommerce: roundsNotInCommerce.length,
        sample: roundsDifferent.slice(0, 20), notInJoshSample: roundsNotInJosh.slice(0, 20), notInCommerceSample: roundsNotInCommerce.slice(0, 20) },
      logistics: { josh: jl.length, commerce: cl.length, same: cl.length - skus - notInJosh.length, different: skus, fieldsDifferent: different.length,
        notInJosh: notInJosh.length, joshOnly: joshOnly.length, sample: different.slice(0, 20), notInJoshSample: notInJosh.slice(0, 20), joshOnlySample: joshOnly.slice(0, 20) },
    }, null, 2));
    if (roundsDifferent.length || roundsNotInJosh.length || roundsNotInCommerce.length || different.length || notInJosh.length) process.exitCode = 1;
  } finally {
    await josh.destroy();
    await commerce.destroy();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
