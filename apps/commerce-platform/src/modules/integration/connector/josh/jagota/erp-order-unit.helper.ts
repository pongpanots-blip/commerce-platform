import { resolvePackTotalQty } from '../../../../../shared-kernel/helpers/pack-order-price.helper';

/**
 * Which unit Josh sends as `P_UNIT` (order create / quotation create).
 *
 * Mirrors jagota-node-api `order.service.ts:114`:
 * - order-taking SKU → unit must be one of the SKU's UNIT_ORDER_TAKING rows
 * - stock SKU        → unit must be one of the SKU's UNIT_SELLING rows
 *
 * Both lists arrive as `ORDERING_OPTIONS[].UNIT_CODE` (stored in
 * `product_inventory.erp_ordering_units`). Preference order:
 * 1. the unit Josh already prices in (`order_taking_unit` / `selling_unit`) when ERP lists it
 * 2. the first unit ERP lists
 * 3. legacy fallback when `erp_ordering_units` was never synced
 */
export type ErpOrderUnitSource = {
  order_taking_flag?: string | null;
  order_taking_unit?: string | null;
  selling_unit?: string | null;
  erp_ordering_units?: string[] | null;
};

export function normalizeErpOrderingUnits(
  options: unknown,
): string[] | null {
  if (!Array.isArray(options)) return null;
  const codes = options
    .map((opt) => {
      if (typeof opt === 'string') return opt;
      const code = (opt as { UNIT_CODE?: unknown } | null)?.UNIT_CODE;
      return typeof code === 'string' ? code : null;
    })
    .map((code) => code?.trim().toUpperCase() ?? '')
    .filter((code) => code.length > 0);
  return [...new Set(codes)];
}

export function resolveErpOrderUnit(
  inventory: ErpOrderUnitSource | null | undefined,
): string {
  if (!inventory) return '';
  const isOrderTaking = inventory.order_taking_flag === 'Y';
  const preferred = (
    (isOrderTaking ? inventory.order_taking_unit : inventory.selling_unit) ??
    inventory.selling_unit ??
    ''
  )
    .trim()
    .toUpperCase();

  const allowed = inventory.erp_ordering_units ?? [];
  if (allowed.length === 0) return preferred;
  if (preferred && allowed.includes(preferred)) return preferred;
  return allowed[0];
}


export type ErpOrderLineSource = ErpOrderUnitSource & {
  packaging_type?: string | null;
  pack_size?: string | null;
  units_per_box?: string | null;
  weight_per_unit?: string | null;
};

export type ErpOrderLine = {
  /** unit sent as P_UNIT / UNIT */
  unit: string;
  /** quantity in that unit (P_QTY / QTY) */
  qty: number;
  /** price per that unit (P_RATE / RATE) */
  rate: number;
};

/**
 * Josh prices an Approx SKU per order unit (one pack: rate × pack weight, see
 * resolveApproxOrderUnitPrice) but ERP prices it per selling unit (KG). Convert
 * the Josh line (packs × pack price) back to what ERP expects (KG × per-KG rate)
 * whenever the ERP unit is the weight unit the pack total is expressed in.
 * Fixed SKUs, count units, or unparsable packs pass through unchanged.
 */
export function resolveErpOrderLine(
  inventory: ErpOrderLineSource | null | undefined,
  item: { quantity: number; unitPrice: number },
): ErpOrderLine {
  const unit = resolveErpOrderUnit(inventory);
  const passthrough = { unit, qty: item.quantity, rate: item.unitPrice };
  if (!inventory) return passthrough;
  if (!/^approx$/i.test(String(inventory.packaging_type ?? '').trim())) {
    return passthrough;
  }
  const packTotal = resolvePackTotalQty(inventory);
  if (!packTotal || packTotal.max <= 0) return passthrough;
  if (packTotal.unit.toUpperCase() !== unit.toUpperCase()) return passthrough;

  const qty = Math.round(item.quantity * packTotal.max * 1000) / 1000;
  const rate = Math.round((item.unitPrice / packTotal.max) * 100) / 100;
  return { unit, qty, rate };
}
