import { z } from 'zod';
import { resolvePromotionValue, PromotionValue, validatePromotionValue } from '../connector/josh/pricing/promotion-value';
import { validatePromotionRules } from '../../commerce/product-promotion-rules/promotion-rules';
import { roundOrderUnitPrice } from '../connector/josh/pricing/pricing.types';

const instant = z.iso.datetime({ offset: true });
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const quantity = z.number().finite().positive().max(1_000_000)
  .refine(n => Math.abs(n * 10_000 - Math.round(n * 10_000)) < 0.00001, 'Quantity supports at most 4 decimals');
const stamp = z.object({ id: z.string().min(1).max(128), version: z.string().min(1).max(128),
  asOf: instant, validUntil: instant }).strict();
const unit = z.string().min(1).max(32);
const value = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fixed'), amount: z.number().finite().nonnegative().max(9_999_999_999.99) }).strict(),
  z.object({ type: z.literal('percentage'), percent: z.number().finite().min(0).max(100) }).strict(),
  z.object({ type: z.literal('tiered'), tiers: z.array(z.object({ min_qty: z.number().int().positive(),
    max_qty: z.number().int().positive().optional(), promotion_price: z.number().finite().nonnegative(),
    unit_label: z.string().optional(), badge_text: z.string().optional() }).strict()).min(1).max(100) }).strict(),
  z.object({ type: z.literal('bogo'), buy_qty: z.number().int().positive().max(1_000_000),
    get_qty: z.number().int().positive().max(1_000_000), get_discount_percent: z.number().finite().min(0).max(100) }).strict(),
]);

/** Attested snapshots are inputs, never a claim that a caller's costs were fetched/verified here. */
export const promotionRehearsalSchema = z.object({
  at: instant,
  line: z.object({ sku: z.string().min(1).max(100), quantity, unit, quantityKind: z.enum(['count', 'measure']) }).strict(),
  price: z.object({ kind: z.literal('selling_price'), sku: z.string(), unit, currency: z.string().length(3),
    unitPrice: money, source: stamp, pricingSource: z.enum(['base', 'customer_sku', 'contract_sku', 'promotion', 'promotion_mechanic']),
    pricingBasis: z.enum(['fixed_selling_unit', 'approx_weight_pack', 'unknown']),
    tax: z.object({ basis: z.enum(['inclusive', 'exclusive']), rateBasisPoints: z.number().int().min(0).max(10_000).nullable() }).strict(),
  }).strict().nullable(),
  cost: z.object({ kind: z.enum(['authoritative_unit_cost', 'supplier_quote', 'competitor_observation', 'current_metadata']),
    sku: z.string(), unit, currency: z.string().length(3), unitCostExVat: money, source: stamp,
    effectiveFrom: instant, effectiveUntil: instant.nullable() }).strict().nullable(),
  stock: z.object({ sku: z.string(), warehouseId: z.string().min(1).max(128), unit,
    quantity: z.number().finite().nonnegative().max(1_000_000), reserved: z.number().finite().nonnegative().max(1_000_000),
    source: stamp }).strict().nullable(),
  rules: z.array(z.object({ source: stamp, scope: z.enum(['sku', 'cart', 'group']), value,
    predicate: z.unknown().optional(), capacity: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('uncapped') }).strict(),
      z.object({ kind: z.literal('capped'), remainingUnits: z.number().finite().nonnegative() }).strict(),
      z.object({ kind: z.literal('unknown') }).strict(),
    ]) }).strict()).max(10).nullable(),
  stacking: z.enum(['none', 'requested']),
  minimumGrossMarginPercent: z.number().finite().min(-1000).max(100).nullable(),
}).strict();
export type PromotionRehearsalInput = z.infer<typeof promotionRehearsalSchema>;
export type PreviewIssue = { code: string; input: string };
export interface PromotionRehearsalResult {
  mode: 'preview'; persisted: false; activationAllowed: false;
  inputAuthority: 'caller_attested_snapshots'; at: string;
  roundingPolicy: 'josh_unit_price_then_preview_line_half_up';
  status: 'complete' | 'incomplete' | 'rejected' | 'constraints_failed';
  issues: PreviewIssue[];
  amounts: { currency: 'THB'; basis: 'inclusive' | 'exclusive'; beforeDiscountMinor: number; discountMinor: number;
    afterDiscountUnitMinor: number; afterDiscountMinor: number; nominalEngineAfterDiscountMinor: number; roundingAdjustmentMinor: number;
    totalIncVatMinor: number | null; revenueExVatMinor: number | null; vatMinor: number | null;
    costExVatMinor: number | null; grossProfitMinor: number | null; grossMarginPercent: number | null;
    markupPercent: number | null } | null;
  stock: { available: number; required: number; shortage: number; warehouseId: string } | null;
  evidence: Array<{ input: string; id: string; version: string; asOf: string; validUntil: string }>;
}

// Match Josh's existing UNIT rounding first. Preview line/cost/tax money is half-up to cents; never currency float sums.
const MAX_MINOR = BigInt(999_999_999_999);
const divide = (n: bigint, d: bigint) => (n + d / BigInt(2)) / d;
const cents = (s: string) => { const [whole, frac = ''] = s.split('.'); return BigInt(whole) * BigInt(100) + BigInt(frac.padEnd(2, '0')); };
const qtyUnits = (q: number) => BigInt(Math.round(q * 10_000));
const lineMoney = (price: bigint, q: number) => divide(price * qtyUnits(q), BigInt(10_000));
function engineMoney(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0 || amount > Number(MAX_MINOR) / 100) throw new Error('money_out_of_range');
  // Retain the engine's nominal line total so the stored-unit rounding adjustment is visible.
  const [whole, fraction] = amount.toFixed(8).split('.');
  return divide(BigInt(whole) * BigInt(100_000_000) + BigInt(fraction), BigInt(1_000_000));
}
const percent = (n: number, d: number) => d === 0 ? null : Math.round(n / d * 1_000_000) / 10_000;

/** Pure, deterministic SKU rehearsal. Reuses Josh's value engine; never composes unsupported cart/coupon stacking. */
export function rehearsePromotion(raw: unknown): PromotionRehearsalResult {
  const input = promotionRehearsalSchema.parse(raw);
  const { line, at } = input;
  const result: PromotionRehearsalResult = { mode: 'preview', persisted: false, activationAllowed: false,
    inputAuthority: 'caller_attested_snapshots', roundingPolicy: 'josh_unit_price_then_preview_line_half_up', at,
    status: 'complete', issues: [], amounts: null, stock: null, evidence: [] };
  const issue = (code: string, field: string, status: PromotionRehearsalResult['status'] = 'incomplete') => {
    result.issues.push({ code, input: field });
    if (status === 'rejected' || (result.status !== 'rejected' && (status === 'constraints_failed' || result.status === 'complete'))) result.status = status;
  };
  const fresh = (s: z.infer<typeof stamp>, field: string) => {
    result.evidence.push({ input: field, ...s });
    const current = Date.parse(at), start = Date.parse(s.asOf), end = Date.parse(s.validUntil);
    if (end < start) { issue('invalid_validity_window', field, 'rejected'); return false; }
    if (start > current || end < current) { issue(start > current ? 'input_not_yet_effective' : 'input_stale', field); return false; }
    return true;
  };
  if (line.quantityKind === 'count' && !Number.isInteger(line.quantity)) issue('fractional_count_quantity', 'line', 'rejected');
  if (input.stacking !== 'none' || (input.rules?.length ?? 0) > 1) issue('stacking_not_supported', 'rules', 'rejected');
  if (input.rules == null) issue('rules_unavailable', 'rules');
  for (const rule of input.rules ?? []) {
    fresh(rule.source, 'rule');
    if (rule.scope !== 'sku' || rule.predicate != null) issue('rule_scope_or_predicate_not_supported', 'rules', 'rejected');
    try {
      validatePromotionValue(rule.value as PromotionValue);
      if (rule.value.type === 'tiered') validatePromotionRules(rule.value.tiers);
    } catch { issue('invalid_promotion_rule', 'rules', 'rejected'); }
    if (rule.value.type === 'bogo' && (line.quantityKind !== 'count' || !Number.isInteger(line.quantity))) issue('bogo_requires_count_units', 'rules', 'rejected');
    if (rule.capacity.kind === 'unknown') issue('promotion_capacity_unavailable', 'rules');
    else if (rule.capacity.kind === 'capped' && rule.capacity.remainingUnits < line.quantity) issue('promotion_capacity_exceeded', 'rules', 'constraints_failed');
  }
  let stockUsable = false;
  if (!input.stock) issue('stock_unavailable', 'stock');
  else {
    stockUsable = fresh(input.stock.source, 'stock');
    if (input.stock.sku !== line.sku || input.stock.unit !== line.unit) { issue('stock_identity_or_uom_mismatch', 'stock'); stockUsable = false; }
    if (input.stock.reserved > input.stock.quantity) { issue('stock_reservations_exceed_quantity', 'stock'); stockUsable = false; }
    if ([input.stock.quantity, input.stock.reserved].some(n => Math.abs(n * 10_000 - Math.round(n * 10_000)) > 0.00001)) {
      issue('stock_quantity_precision_unsupported', 'stock'); stockUsable = false;
    }
    if (stockUsable) {
      const available = Math.round((input.stock.quantity - input.stock.reserved) * 10_000) / 10_000;
      const shortage = Math.max(0, Math.round((line.quantity - available) * 10_000) / 10_000);
      result.stock = { available, required: line.quantity, shortage, warehouseId: input.stock.warehouseId };
      if (shortage > 0) issue('insufficient_unreserved_stock', 'stock', 'constraints_failed');
    }
  }
  let costUsable = false;
  if (!input.cost) issue('cost_unavailable', 'cost');
  else {
    const cost = input.cost;
    costUsable = fresh(cost.source, 'cost');
    if (cost.kind !== 'authoritative_unit_cost') { issue('cost_not_authoritative', 'cost'); costUsable = false; }
    if (cost.sku !== line.sku || cost.unit !== line.unit || cost.currency !== 'THB') { issue('cost_identity_currency_or_uom_mismatch', 'cost'); costUsable = false; }
    if (Date.parse(cost.effectiveFrom) > Date.parse(at) || (cost.effectiveUntil != null && Date.parse(cost.effectiveUntil) < Date.parse(at))) {
      issue('cost_not_effective', 'cost'); costUsable = false;
    }
    if (cost.effectiveUntil && Date.parse(cost.effectiveUntil) < Date.parse(cost.effectiveFrom)) { issue('invalid_cost_window', 'cost', 'rejected'); costUsable = false; }
  }
  if (!input.price) { issue('selling_price_unavailable', 'price'); return result; }
  const price = input.price;
  const priceFresh = fresh(price.source, 'price');
  if (price.sku !== line.sku || price.unit !== line.unit || price.currency !== 'THB') issue('selling_price_identity_currency_or_uom_mismatch', 'price', 'rejected');
  if ((input.rules?.length ?? 0) && price.pricingSource !== 'base') issue('higher_priority_price_or_existing_rule', 'price', 'rejected');
  if (price.pricingBasis !== 'fixed_selling_unit') { issue('approx_or_unknown_price_basis_unsupported', 'price'); return result; }
  if (price.tax.rateBasisPoints == null) issue('tax_rate_unavailable', 'price');
  // A stale/missing rule cannot be treated as no discount. Stock/cost gaps may still allow a labeled price preview.
  if (result.status === 'rejected' || !priceFresh || input.rules == null || result.issues.some(i => i.input === 'rule')) return result;
  try {
    const base = cents(price.unitPrice);
    const before = lineMoney(base, line.quantity);
    if (base > MAX_MINOR || before > MAX_MINOR) throw new Error('money_out_of_range');
    const selected = input.rules[0];
    const calculated = selected ? resolvePromotionValue(selected.value as PromotionValue, { basePrice: Number(base) / 100, quantity: line.quantity }) : {};
    const baseNumber = Number(base) / 100;
    const rawUnit = calculated.finalPrice ?? (baseNumber * line.quantity - (calculated.discountAmount ?? 0)) / line.quantity;
    const storedUnit = roundOrderUnitPrice(rawUnit);
    if (!Number.isFinite(storedUnit) || storedUnit < 0 || storedUnit > Number(MAX_MINOR) / 100) throw new Error('money_out_of_range');
    const afterUnit = cents(storedUnit.toFixed(2));
    const after = lineMoney(afterUnit, line.quantity);
    const nominalAfter = engineMoney(rawUnit * line.quantity);
    if (after < BigInt(0) || after > before || after > MAX_MINOR) { issue('rule_is_not_a_supported_discount', 'rules', 'rejected'); return result; }
    const rate = price.tax.rateBasisPoints;
    const net = rate == null ? null : price.tax.basis === 'inclusive' ? divide(after * BigInt(10_000), BigInt(10_000 + rate)) : after;
    const tax = net == null ? null : price.tax.basis === 'inclusive' ? after - net : divide(net * BigInt(rate!), BigInt(10_000));
    const cost = costUsable ? lineMoney(cents(input.cost!.unitCostExVat), line.quantity) : null;
    const gross = net != null && tax != null ? net + tax : null;
    if ((cost != null && cost > MAX_MINOR) || (gross != null && gross > MAX_MINOR)) throw new Error('money_out_of_range');
    const profit = net != null && cost != null ? Number(net - cost) : null;
    result.amounts = { currency: 'THB', basis: price.tax.basis, beforeDiscountMinor: Number(before), discountMinor: Number(before - after),
      afterDiscountUnitMinor: Number(afterUnit), afterDiscountMinor: Number(after), nominalEngineAfterDiscountMinor: Number(nominalAfter),
      roundingAdjustmentMinor: Number(after - nominalAfter), totalIncVatMinor: gross == null ? null : Number(gross),
      revenueExVatMinor: net == null ? null : Number(net), vatMinor: tax == null ? null : Number(tax),
      costExVatMinor: cost == null ? null : Number(cost), grossProfitMinor: profit,
      grossMarginPercent: profit == null || net == null ? null : percent(profit, Number(net)),
      markupPercent: profit == null || cost == null ? null : percent(profit, Number(cost)) };
    if (input.minimumGrossMarginPercent != null) {
      if (result.amounts.grossMarginPercent == null) issue('margin_constraint_unavailable', 'minimumGrossMarginPercent');
      else if (profit! / Number(net!) * 100 < input.minimumGrossMarginPercent) issue('margin_below_minimum', 'minimumGrossMarginPercent', 'constraints_failed');
    }
  } catch { issue('money_out_of_range', 'amounts', 'rejected'); result.amounts = null; }
  return result;
}
