/**
 * josh's checkout money math, copied (orders.service placeOrder → shipment-group.service
 * computeGroupPricing + coupon-redemption.service applyDiscountToGroups, shared/helpers/vat.helper,
 * shared/constants/checkout.constants). Kept as plain functions so commerce can rebuild the totals
 * of an order josh placed — and later quote a cart itself — with exactly josh's rounding.
 */

export const FREE_DELIVERY_THRESHOLD_EX_VAT = 2500;
export const STANDARD_DELIVERY_FEE = 100;
const DEFAULT_VAT_RATE = 0.07;
const VAT_ERP_RATE_MAP: Record<string, number> = { '0%': 0, '7%': 0.07, V0: 0, V7: 0.07, VAT0: 0, VAT7: 0.07, '0': 0, '7': 0.07 };

export const roundMoney = (v: number) => Math.round(v * 100) / 100;

export function resolveVatRate(code?: string | null): number {
  if (!code?.trim()) return DEFAULT_VAT_RATE;
  const n = code.trim().toUpperCase();
  if (VAT_ERP_RATE_MAP[n] !== undefined) return VAT_ERP_RATE_MAP[n];
  if (n.endsWith('0') || n.includes('EXEMPT')) return 0;
  return DEFAULT_VAT_RATE;
}

export function splitPriceIncVat(amountIncVat: number, vatRate: number) {
  if (vatRate <= 0) return { exVat: roundMoney(amountIncVat), vat: 0 };
  const exVat = amountIncVat / (1 + vatRate);
  return { exVat: roundMoney(exVat), vat: roundMoney(amountIncVat - exVat) };
}

export interface QuoteLine {
  quantity: number;
  unitPriceIncVat: number;
  vatType: string | null;
  fulfillmentType: string | null;
  /** List price per unit inc VAT (josh unit_list_price_inc_vat); a higher list price = a product discount. */
  unitListPriceIncVat: number | null;
  /** Customer / contract price: never counted as a product discount. */
  isSpecialPrice: boolean;
}

export interface GroupPricing { fulfillmentType: string | null; subtotalExVat: number; vatAmount: number; subtotalIncVat: number; deliveryFee: number; productDiscountExVat: number; grossExVat: number }

/** shipment-group.service computeGroupPricing: one group = the lines of one fulfillment type. */
export function groupPricing(lines: QuoteLine[], fulfillmentType: string | null): GroupPricing {
  let subtotalExVat = 0, vatAmount = 0, subtotalIncVat = 0, productDiscountExVat = 0;
  for (const l of lines) {
    const rate = resolveVatRate(l.vatType);
    const unit = splitPriceIncVat(l.unitPriceIncVat, rate);
    const incVat = roundMoney(l.unitPriceIncVat * l.quantity);
    const exVat = roundMoney(unit.exVat * l.quantity);
    subtotalExVat += exVat;
    vatAmount += roundMoney(incVat - exVat);
    subtotalIncVat += incVat;
    const listExVat = l.unitListPriceIncVat == null ? null : splitPriceIncVat(l.unitListPriceIncVat, rate).exVat;
    if (!l.isSpecialPrice && listExVat != null && listExVat > unit.exVat) productDiscountExVat += roundMoney((listExVat - unit.exVat) * l.quantity);
  }
  subtotalExVat = roundMoney(subtotalExVat);
  productDiscountExVat = roundMoney(productDiscountExVat);
  return {
    fulfillmentType, subtotalExVat, vatAmount: roundMoney(vatAmount), subtotalIncVat: roundMoney(subtotalIncVat),
    deliveryFee: subtotalExVat >= FREE_DELIVERY_THRESHOLD_EX_VAT ? 0 : STANDARD_DELIVERY_FEE,
    productDiscountExVat, grossExVat: roundMoney(subtotalExVat + productDiscountExVat),
  };
}

/** coupon-redemption.service distributeDiscountAcrossGroups: largest remainder in satang. */
export function distributeDiscount(groupTotals: number[], grandTotal: number, totalDiscount: number): number[] {
  if (totalDiscount <= 0 || grandTotal <= 0) return groupTotals.map(() => 0);
  const totalSatang = Math.round(totalDiscount * 100);
  const base = BigInt(Math.round(grandTotal * 100));
  const weighted = groupTotals.map((t, index) => {
    const num = BigInt(totalSatang) * BigInt(Math.round(t * 100));
    return { index, share: Number(num / base), remainder: num % base };
  });
  const residual = totalSatang - weighted.reduce((s, r) => s + r.share, 0);
  const ranked = [...weighted].sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (let i = 0; i < residual; i++) ranked[i].share += 1;
  return weighted.map((r) => r.share / 100);
}

export interface OrderTotals { total_price: number; subtotal_ex_vat: number; vat_amount: number; delivery_fee: number; discount_amount: number; discount_inc_vat: number; product_discount_ex_vat: number; gross_ex_vat: number }

/**
 * orders.service placeOrder: groups by fulfillment type, checkout discount (coupon / credit) split
 * across groups (applyDiscountToGroups), order = sum of groups. The discount is an input here: it is
 * the coupon / credit amount josh decided (coupon eligibility is a separate check).
 */
export function orderTotals(lines: QuoteLine[], discount: { exVat: number; incVat: number }): OrderTotals {
  const byType = new Map<string | null, QuoteLine[]>();
  for (const l of lines) byType.set(l.fulfillmentType, [...(byType.get(l.fulfillmentType) ?? []), l]);
  const groups = [...byType.entries()].map(([t, ls]) => groupPricing(ls, t));
  const share = (bases: number[], total: number) => distributeDiscount(bases, roundMoney(bases.reduce((s, v) => s + v, 0)), total);
  const exShares = share(groups.map((g) => g.subtotalExVat), discount.exVat);
  const vatShares = share(groups.map((g) => roundMoney(g.subtotalIncVat - g.subtotalExVat)), roundMoney(discount.incVat - discount.exVat));
  const net = groups.map((g, i) => {
    const discountExVat = exShares[i] ?? 0;
    const discountIncVat = roundMoney(discountExVat + (vatShares[i] ?? 0));
    const subtotalExVat = roundMoney(Math.max(0, g.subtotalExVat - discountExVat));
    const subtotalIncVat = roundMoney(g.subtotalIncVat - discountIncVat);
    return { discountExVat, discountIncVat, subtotalExVat, vatAmount: roundMoney(subtotalIncVat - subtotalExVat), deliveryFee: g.deliveryFee, totalIncVat: roundMoney(subtotalIncVat + g.deliveryFee) };
  });
  const sum = (f: (x: (typeof net)[number]) => number) => roundMoney(net.reduce((s, x) => s + f(x), 0));
  return {
    total_price: sum((x) => x.totalIncVat), subtotal_ex_vat: sum((x) => x.subtotalExVat), vat_amount: sum((x) => x.vatAmount),
    delivery_fee: sum((x) => x.deliveryFee), discount_amount: sum((x) => x.discountExVat), discount_inc_vat: sum((x) => x.discountIncVat),
    product_discount_ex_vat: roundMoney(groups.reduce((s, g) => s + g.productDiscountExVat, 0)), gross_ex_vat: roundMoney(groups.reduce((s, g) => s + g.grossExVat, 0)),
  };
}

/** josh product-card-pricing.helper SPECIAL_PRICE_SOURCES. */
export const isSpecialPriceSource = (source?: string | null) => ['customer_sku', 'contract_sku', 'branch_special'].includes(source ?? '');

export const TOTAL_FIELDS: (keyof OrderTotals)[] = ['total_price', 'subtotal_ex_vat', 'vat_amount', 'delivery_fee', 'discount_amount', 'discount_inc_vat', 'product_discount_ex_vat', 'gross_ex_vat'];

/** Fields where josh's stored value and commerce's differ by a satang or more. */
export function diffTotals(josh: Partial<Record<keyof OrderTotals, number | null>>, commerce: OrderTotals) {
  return TOTAL_FIELDS.filter((k) => josh[k] != null && Math.abs(Number(josh[k]) - commerce[k]) >= 0.005)
    .map((k) => ({ field: k, josh: Number(josh[k]), commerce: commerce[k] }));
}
