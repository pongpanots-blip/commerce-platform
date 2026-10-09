/**
 * One-off for Josh's PromotionPricesAsSellUnitTotal1792500000000 (2026-10-09): Josh's tier prices move from a rate per
 * ERP `selling_unit` to the sell-unit TOTAL, each SKU × one factor (its catalog total ÷ its rate). Commerce's owned copy
 * (`product_promotion_rules.rules`) still holds rates, and the next staff save would push them back over Josh's totals.
 *
 * Run after Josh's migration and a fresh `promotion-rules` backfill (so `shadow_rules` holds Josh's totals). Prints the
 * SKUs whose rules differ from the shadow ONLY by that conversion; `--apply` copies the shadow into `rules` for them.
 * Nothing is published: Josh already holds these values. Any other difference is listed under `manual` and left alone.
 */
import 'reflect-metadata';
import { AppDataSource } from '../data-source';
import { validatePromotionRules, type PromotionRule } from '../modules/commerce/product-promotion-rules/promotion-rules';

const key = (r: PromotionRule) => JSON.stringify([r.min_qty, r.max_qty ?? null, r.unit_label ?? null, r.badge_text ?? null]);

/** Same tiers, every price × one factor (rounded to satang per row, as Josh's migration does). */
export function isSellUnitTotalConversion(rules: PromotionRule[], josh: PromotionRule[]): boolean {
  if (!rules.length || rules.length !== josh.length) return false;
  const a = [...rules].sort((x, y) => x.min_qty - y.min_qty);
  const b = [...josh].sort((x, y) => x.min_qty - y.min_qty);
  if (a.some((r, i) => key(r) !== key(b[i]))) return false;
  // The largest rate gives the most precise factor; every row must land on Josh's value within one satang.
  const i = a.reduce((best, r, j) => (r.promotion_price > a[best].promotion_price ? j : best), 0);
  if (!(a[i].promotion_price > 0) || !(b[i].promotion_price > 0)) return false;
  const factor = b[i].promotion_price / a[i].promotion_price;
  if (Math.abs(factor - 1) < 1e-9) return false;
  return a.every((r, j) => Math.abs(Math.round(r.promotion_price * factor * 100) / 100 - b[j].promotion_price) <= 0.011);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await AppDataSource.initialize();
  try {
    const rows: Array<{ sku: string; rules: unknown; shadow_rules: unknown }> = await db.query(
      `SELECT sku, rules, shadow_rules FROM product_promotion_rules
       WHERE lock IS NULL AND shadow_rules IS NOT NULL AND rules IS DISTINCT FROM shadow_rules ORDER BY sku`);
    const adopt: Array<{ sku: string; stored: unknown; from: PromotionRule[]; to: PromotionRule[] }> = [];
    const manual: Array<{ sku: string; rules: unknown; shadow_rules: unknown }> = [];
    for (const row of rows) {
      const rules = validatePromotionRules(row.rules ?? []);
      const josh = validatePromotionRules(row.shadow_rules);
      if (isSellUnitTotalConversion(rules, josh)) adopt.push({ sku: row.sku, stored: row.rules, from: rules, to: josh });
      else manual.push(row);
    }
    if (apply) {
      for (const { sku, stored, to } of adopt) {
        await db.transaction(async (m) => {
          await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`promotion-rules:${sku}`]);
          // Only when nobody edited the row since it was read.
          await m.query(`UPDATE product_promotion_rules SET rules = $2::jsonb WHERE sku = $1 AND lock IS NULL AND rules = $3::jsonb`,
            [sku, JSON.stringify(to), JSON.stringify(stored)]);
        });
      }
    }
    console.log(JSON.stringify({ applied: apply, adopt: adopt.length, manual: manual.length, adoptSample: adopt.slice(0, 20).map(({ sku, from, to }) => ({ sku, from, to })), manualSample: manual.slice(0, 20) }, null, 2));
  } finally { await db.destroy(); }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
