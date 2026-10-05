import { parseWeightRange } from './weight-range.helper';

/** Weight / volume units that can form a pack total for Approx reverse-cal. */
const WEIGHT_VOLUME = new Set([
  'KG',
  'GM',
  'G',
  'MG',
  'ML',
  'L',
  'LT',
  'OZ',
  'LB',
]);

function isWeightUnit(unit: string | null | undefined): boolean {
  return unit != null && WEIGHT_VOLUME.has(unit.trim().toUpperCase());
}

/**
 * Normalize to KG or L for pack-total math (Approx rate × total).
 * OZ/LB → KG; MG → KG; ML → L.
 */
function normalizeToKgOrL(
  value: number,
  unit: string,
): { value: number; unit: string } {
  const u = unit.toUpperCase();
  if (u === 'GM' || u === 'G') return { value: value / 1000, unit: 'KG' };
  if (u === 'MG') return { value: value / 1_000_000, unit: 'KG' };
  if (u === 'OZ') return { value: value * 0.0283495, unit: 'KG' };
  if (u === 'LB') return { value: value * 0.453592, unit: 'KG' };
  if (u === 'ML') return { value: value / 1000, unit: 'L' };
  if (u === 'LT' || u === 'L') return { value: value, unit: 'L' };
  return { value, unit: 'KG' };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Baht tolerance for “is this the catalog box / box×pack?” checks. */
const UNIT_EPS = 1;

type ApproxPackFields = {
  packaging_type?: string | null;
  selling_unit?: string | null;
  selling_unit_price?: number | string | null;
  ordering_price?: number | string | null;
  pack_size?: string | null;
  units_per_box?: string | null;
  weight_per_unit?: string | null;
};

function isApproxWeightSku(input: ApproxPackFields): boolean {
  if (!/^approx$/i.test(String(input.packaging_type ?? '').trim())) {
    return false;
  }
  return isWeightUnit(String(input.selling_unit ?? '').trim());
}

/**
 * Approx special/quotation amounts must be per-kg (same unit as `selling_unit_price`).
 * ERP/admin sometimes send the box (`ordering_price`) or box × pack instead.
 *
 * - 760 vs catalog 750 → 760 (already per-kg)
 * - 4875 box / pack 6.5 → 750
 * - 31687.50 = box × pack → 750
 */
export function normalizeApproxPerKgRate(input: {
  selling_unit_price?: number | string | null;
  ordering_price?: number | string | null;
  resolved?: number | string | null;
  packTotalMax?: number | null;
}): number | null {
  const raw = Number(input.resolved ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return null;

  const packMax = Number(input.packTotalMax ?? 0);
  const ordering = Number(input.ordering_price ?? 0);

  if (packMax > 1 && Number.isFinite(ordering) && ordering > 0) {
    if (Math.abs(raw - ordering * packMax) < UNIT_EPS) {
      return roundMoney(raw / packMax / packMax);
    }
    if (Math.abs(raw - ordering) < UNIT_EPS) {
      return roundMoney(raw / packMax);
    }
  }

  return roundMoney(raw);
}

/**
 * Value to store on `private_price.private_selling_price`.
 * Approx + weight → per-kg. Fixed / other → `RATE` (fallback `ORDERING_RATE`) as-is.
 */
export function resolveQuotationPrivateSellingPrice(
  inventory: ApproxPackFields,
  quotation: { rate?: number | string | null; ordering_rate?: number | string | null },
): number | null {
  const rate = Number(quotation.rate ?? 0);
  const orderingRate = Number(quotation.ordering_rate ?? 0);
  const raw = rate > 0 ? rate : orderingRate;
  if (!Number.isFinite(raw) || raw <= 0) return null;

  if (!isApproxWeightSku(inventory)) {
    return roundMoney(raw);
  }

  const packMax = resolvePackTotalQty(inventory)?.max ?? null;
  return normalizeApproxPerKgRate({
    selling_unit_price: inventory.selling_unit_price,
    ordering_price: inventory.ordering_price,
    resolved: raw,
    packTotalMax: packMax,
  });
}

function parseSide(
  raw: string | null | undefined,
): { min: number; max: number; unit: string | null } | null {
  if (!raw?.trim()) return null;
  const match = raw
    .trim()
    // Single value ("473 ML") or range ("0.60 - 2.5 KG")
    .match(/^(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?)\s*)?([A-Za-z]+)?$/i);
  if (!match) return null;
  const min = Number(match[1]);
  const max = match[2] != null ? Number(match[2]) : min;
  if (!Number.isFinite(min) || min <= 0 || !Number.isFinite(max) || max <= 0) {
    return null;
  }
  return { min, max, unit: match[3] ?? null };
}

export type PackTotalQty = { max: number; min: number; unit: string };

/**
 * Total sellable qty in one order unit from pack_size grammar.
 *
 * Weight/volume × count:
 * - "0.60 - 2.5 KG X 9 PC" → 5.4–22.5 KG
 * - "473 ML X 8 PC"        → 3.784 L
 * - "100 - 300 GM X 6 KG"  → 6 KG (both weight → right wins)
 * - "0.10 - 2 KG X 20 KG"  → 20 KG
 * - "15 - 20 KG X 1 BX"    → 15–20 KG
 * - "1 - 2 PC X 1 KG"      → 1 KG (count × weight → weight side)
 *
 * Count × count (PC×BX, …) → null (no weight/volume total).
 */
export function resolvePackTotalQty(inv: {
  pack_size?: string | null;
  units_per_box?: string | null;
  weight_per_unit?: string | null;
}): PackTotalQty | null {
  const pack = inv.pack_size?.trim();
  if (pack) {
    const parts = pack.split(/\s+x\s+/i);
    if (parts.length === 2) {
      const left = parseSide(parts[0]);
      const right = parseSide(parts[1]);
      if (left && right) {
        const leftW = isWeightUnit(left.unit);
        const rightW = isWeightUnit(right.unit);
        // Both weight/volume → second side is pack total.
        if (leftW && rightW && right.unit) {
          const n = normalizeToKgOrL(right.max, right.unit);
          const nMin = normalizeToKgOrL(right.min, right.unit);
          return {
            max: roundMoney(n.value),
            min: roundMoney(nMin.value),
            unit: n.unit,
          };
        }
        // Weight/volume × count → total = per-piece × count
        if (leftW && !rightW && left.unit) {
          const count = right.max;
          const nMax = normalizeToKgOrL(left.max * count, left.unit);
          const nMin = normalizeToKgOrL(left.min * count, left.unit);
          return {
            max: roundMoney(nMax.value),
            min: roundMoney(nMin.value),
            unit: nMax.unit,
          };
        }
        // Count × weight/volume → total = weight/volume side
        if (!leftW && rightW && right.unit) {
          const n = normalizeToKgOrL(right.max, right.unit);
          const nMin = normalizeToKgOrL(right.min, right.unit);
          return {
            max: roundMoney(n.value),
            min: roundMoney(nMin.value),
            unit: n.unit,
          };
        }
      }
    }
  }

  const wpu = parseWeightRange(inv.weight_per_unit);
  if (wpu && isWeightUnit(wpu.unit)) {
    const countSide = parseSide(inv.units_per_box);
    const count =
      countSide && !isWeightUnit(countSide.unit) ? countSide.max : 1;
    const unit = wpu.unit!;
    const max = (wpu.max ?? wpu.min) * count;
    const min = wpu.min * count;
    const nMax = normalizeToKgOrL(max, unit);
    const nMin = normalizeToKgOrL(min, unit);
    return {
      max: roundMoney(nMax.value),
      min: roundMoney(nMin.value),
      unit: nMax.unit,
    };
  }

  return null;
}

/**
 * Approx + weight/volume selling_unit only.
 * - Catalog → ERP `ordering_price` as-is (no reinvent).
 * - Special / promo → per-kg × pack total max (normalize box / box×pack first).
 * - Fixed / non-Approx → empty; cart keeps ERP resolved price.
 */
export function resolveApproxOrderUnitPrice(input: {
  packaging_type?: string | null;
  selling_unit?: string | null;
  selling_unit_price?: number | string | null;
  ordering_price?: number | string | null;
  resolved_per_kg?: number | string | null;
  pack_size?: string | null;
  units_per_box?: string | null;
  weight_per_unit?: string | null;
}): {
  orderUnitPrice: number | null;
  perKgRate: number | null;
  packTotalMax: number | null;
  packTotalMin: number | null;
  usedOrdering: boolean;
} {
  const empty = {
    orderUnitPrice: null,
    perKgRate: null,
    packTotalMax: null,
    packTotalMin: null,
    usedOrdering: false,
  };

  if (!/^approx$/i.test(String(input.packaging_type ?? '').trim())) {
    return empty;
  }
  const sellingUnit = String(input.selling_unit ?? '').trim();
  if (!isWeightUnit(sellingUnit)) return empty;

  const catalogRate = Number(input.selling_unit_price ?? 0);
  const ordering = Number(input.ordering_price ?? 0);
  const resolvedRaw = input.resolved_per_kg;
  const resolvedRate =
    resolvedRaw != null && resolvedRaw !== ''
      ? Number(resolvedRaw)
      : catalogRate;

  if (!Number.isFinite(resolvedRate) || resolvedRate <= 0) return empty;

  const total = resolvePackTotalQty(input);
  const packTotalMax = total?.max ?? null;
  const packTotalMin = total?.min ?? null;

  const perKgRate = normalizeApproxPerKgRate({
    selling_unit_price: catalogRate,
    ordering_price: ordering,
    resolved: resolvedRate,
    packTotalMax,
  });
  if (perKgRate == null || perKgRate <= 0) return empty;

  const catalogAligned =
    Number.isFinite(catalogRate) &&
    catalogRate > 0 &&
    Math.abs(perKgRate - catalogRate) < 0.5;

  if (catalogAligned && Number.isFinite(ordering) && ordering > 0) {
    return {
      orderUnitPrice: roundMoney(ordering),
      perKgRate: roundMoney(catalogRate),
      packTotalMax,
      packTotalMin,
      usedOrdering: true,
    };
  }

  if (packTotalMax != null && packTotalMax > 0) {
    return {
      orderUnitPrice: roundMoney(perKgRate * packTotalMax),
      perKgRate: roundMoney(perKgRate),
      packTotalMax,
      packTotalMin,
      usedOrdering: false,
    };
  }

  return empty;
}

/**
 * Catalog list/detail/enrich: always return box/order-unit price when computable.
 * Compute-on-read only — does not write `product_inventory.ordering_price`.
 *
 * 1. Stored ERP `PRICE` (`ordering_price`) when > 0
 * 2. Approx + weight selling_unit → `selling_unit_price × pack_total_max`
 * 3. Fixed, or any non-weight selling_unit (Approx sold per CT/BX) → `selling_unit_price`
 *    (already the box/CT sell price)
 */
export function resolveCatalogOrderingPrice(input: {
  packaging_type?: string | null;
  selling_unit?: string | null;
  selling_unit_price?: number | string | null;
  ordering_price?: number | string | null;
  pack_size?: string | null;
  units_per_box?: string | null;
  weight_per_unit?: string | null;
}): number | null {
  const stored = Number(input.ordering_price);
  if (Number.isFinite(stored) && stored > 0) {
    return roundMoney(stored);
  }

  const approx = resolveApproxOrderUnitPrice({
    packaging_type: input.packaging_type,
    selling_unit: input.selling_unit,
    selling_unit_price: input.selling_unit_price,
    ordering_price: null,
    pack_size: input.pack_size,
    units_per_box: input.units_per_box,
    weight_per_unit: input.weight_per_unit,
  });
  if (approx.orderUnitPrice != null) {
    return approx.orderUnitPrice;
  }

  // Fixed, or Approx sold per box/CT (not per weight): the selling rate already is the box.
  const sellingUnit = String(input.selling_unit ?? '').trim();
  if (
    /^fixed$/i.test(String(input.packaging_type ?? '').trim()) ||
    (sellingUnit !== '' && !isWeightUnit(sellingUnit))
  ) {
    const selling = Number(input.selling_unit_price);
    if (Number.isFinite(selling) && selling > 0) {
      return roundMoney(selling);
    }
  }

  return null;
}
