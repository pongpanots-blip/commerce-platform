import { parseWeightRange } from './weight-range.helper';

/** Weight / volume units that can form a pack total for Approx reverse-cal. */
const WEIGHT_VOLUME = new Set([
  'KG',
  'GM',
  'G',
  'GR',
  'MG',
  'ML',
  'L',
  'LT',
  'OZ',
  'LB',
]);

export function isWeightUnit(unit: string | null | undefined): boolean {
  return unit != null && WEIGHT_VOLUME.has(unit.trim().toUpperCase());
}

/**
 * Normalize to KG or L for pack-total math (Approx rate × total).
 * OZ/LB → KG; MG → KG; ML → L. Trims the unit itself so every caller is safe
 * against padded ERP values (`'GM '`, `' GM'`) — matching `isWeightUnit`'s
 * trim, not just uppercase.
 */
export function normalizeToKgOrL(
  value: number,
  unit: string,
): { value: number; unit: string } {
  const u = unit.trim().toUpperCase();
  if (u === 'GM' || u === 'G' || u === 'GR') return { value: value / 1000, unit: 'KG' };
  if (u === 'MG') return { value: value / 1_000_000, unit: 'KG' };
  if (u === 'OZ') return { value: value * 0.0283495, unit: 'KG' };
  if (u === 'LB') return { value: value * 0.453592, unit: 'KG' };
  if (u === 'ML') return { value: value / 1000, unit: 'L' };
  if (u === 'LT' || u === 'L') return { value: value, unit: 'L' };
  return { value, unit: 'KG' };
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Fields needed to resolve "the Josh order unit" and its pack total. */
export type JoshOrderUnitSource = {
  order_taking_unit?: string | null;
  sub_packing_unit?: string | null;
  selling_unit?: string | null;
  pack_size?: string | null;
  units_per_box?: string | null;
  weight_per_unit?: string | null;
};

/**
 * The unit Josh prices/sells the SKU in — `order_taking_unit`, else
 * `sub_packing_unit`, else `selling_unit` (first set). Same chain as shop-web
 * `resolveOrderUnitCode` (docs/pricing-total-model.md); '' when none are set.
 */
export function resolveJoshOrderUnit(
  inventory: JoshOrderUnitSource | null | undefined,
): string {
  if (!inventory) return '';
  return (
    inventory.order_taking_unit?.trim() ||
    inventory.sub_packing_unit?.trim() ||
    inventory.selling_unit?.trim() ||
    ''
  ).toUpperCase();
}

/**
 * How many `erpUnit`s are in ONE SELL UNIT — shared by `resolveErpOrderLine`
 * (apps/backend/src/app/jagota-order/erp-order-unit.helper.ts, Josh → ERP) and
 * `resolveQuotationPrivateSellingPrice` below (ERP → Josh, the inverse) so both
 * read the same rule (docs/pricing-total-model.md, decision 2026-09-28 — the
 * sell unit). Sell unit is `resolveSellUnit` below; for a non-pack SKU the sell
 * unit IS the Josh order unit (`resolveJoshOrderUnit`), so this reduces to the
 * pre-sell-unit rule:
 * - pack sell unit (`resolveSellUnit(inventory).factor !== 1`):
 *   - sell unit's own code equals `erpUnit` → the sell unit's `qty` (e.g. a
 *     10-piece bag, ERP also takes PC → 10)
 *   - `erpUnit` is weight/volume → the sell unit's `factor` (already
 *     expressed in the Josh order unit) converted to `erpUnit`'s scale
 *   - neither → null (no reliable factor)
 * - otherwise (no pack, sell unit === Josh order unit), same as before:
 *   - same unit → 1
 *   - both weight/volume (GM ↔ KG, ML ↔ L, …) → unit scale
 *   - Josh sells a pack (BX/PC/PK, not weight) and `erpUnit` is weight/volume →
 *     pack total (`resolvePackTotalQty`) in that dimension
 *   - anything else (count ↔ count, weight → count, unresolvable unit) → null
 */
export function joshToErpUnitFactor(
  inventory: JoshOrderUnitSource | null | undefined,
  erpUnit: string | null | undefined,
): number | null {
  if (!inventory) return null;
  const joshUnit = resolveJoshOrderUnit(inventory);
  const unit = (erpUnit ?? '').trim().toUpperCase();
  if (!joshUnit || !unit) return null;

  const sellUnit = resolveSellUnit(inventory);
  if (sellUnit.factor !== 1) {
    if (sellUnit.unit === unit) return sellUnit.qty;
    if (isWeightUnit(unit)) {
      const from = normalizeToKgOrL(sellUnit.factor, joshUnit);
      const to = normalizeToKgOrL(1, unit);
      return from.unit === to.unit ? from.value / to.value : null;
    }
    return null;
  }

  if (joshUnit === unit) return 1;

  if (isWeightUnit(joshUnit) && isWeightUnit(unit)) {
    const from = normalizeToKgOrL(1, joshUnit);
    const to = normalizeToKgOrL(1, unit);
    return from.unit === to.unit ? from.value / to.value : null;
  }

  if (!isWeightUnit(joshUnit) && isWeightUnit(unit)) {
    const packTotal = resolvePackTotalQty(inventory);
    if (packTotal && packTotal.max > 0) {
      const to = normalizeToKgOrL(1, unit);
      if (packTotal.unit === to.unit) return packTotal.max / to.value;
    }
    return null;
  }

  return null;
}

/**
 * The "sell unit" (docs/pricing-total-model.md, decision 2026-09-28): for a
 * SKU whose Josh order unit (`resolveJoshOrderUnit`, U) is weight/volume and
 * whose pack is BIGGER than 1 U, Josh sells and prices the PACK, not the raw
 * U — cart quantity = number of packs, `selling_price` = price per pack, avg
 * = per KG/L. `factor` = how many U are in one sell unit.
 *
 * A pack only becomes a sell unit when it prices out higher than the plain
 * per-U rate (`factor > 1`, with a small epsilon for float noise) — a pack
 * smaller than 1 U (e.g. `0.02 - 0.04 KG X 1 PC`, `0.40 - 0.50 KG X 1 PC`) is
 * still just sold/priced per U, same as before this decision.
 *
 * - U weight/volume, `pack_size` right side (after " X ") parses as
 *   `<qty> <UNIT>` → `factor` = the RAW parsed pack quantity (not
 *   `resolvePackTotalQty`'s money-rounded total — reuses the same `parseSide`
 *   left/right split, unrounded, then rounds only the final ratio to 6dp to
 *   kill float noise like `0.35 / 0.001`) expressed in U (KG → as-is; GM →
 *   ×1000; ML → ×1000). `factor <= 1 + 0.001` → not a pack:
 *   `{unit: U, qty: 1, factor: 1}`.
 * - anything else (U not weight/volume, no `pack_size`, unparseable sides,
 *   no weight/volume side at all, cross-dimension) →
 *   `{unit: U, qty: 1, factor: 1}` — Josh sells 1 U at a time, same as
 *   before this decision.
 */
export function resolveSellUnit(
  inventory: JoshOrderUnitSource | null | undefined,
): { unit: string; qty: number; factor: number } {
  const unit = resolveJoshOrderUnit(inventory);
  const identity = { unit, qty: 1, factor: 1 };
  if (!inventory || !isWeightUnit(unit)) return identity;

  const pack = inventory.pack_size?.trim();
  if (!pack) return identity;
  const parts = pack.split(/\s+x\s+/i);
  if (parts.length !== 2) return identity;

  const left = parseSide(parts[0]);
  const right = parseSide(parts[1]);
  if (!left || !right || !right.unit) return identity;

  const leftW = isWeightUnit(left.unit);
  const rightW = isWeightUnit(right.unit);

  let rawMax: number | null = null;
  let rawUnit: string | null = null;
  if (leftW && rightW && right.unit) {
    // Both weight/volume — right side is the raw pack total.
    rawMax = right.max;
    rawUnit = right.unit;
  } else if (leftW && !rightW && left.unit) {
    // Weight/volume × count — raw total = per-piece × count.
    rawMax = left.max * right.max;
    rawUnit = left.unit;
  } else if (!leftW && rightW && right.unit) {
    // Count × weight/volume — raw total = the weight/volume side.
    rawMax = right.max;
    rawUnit = right.unit;
  }
  if (rawMax == null || !rawUnit) return identity;

  const totalNorm = normalizeToKgOrL(rawMax, rawUnit);
  const oneU = normalizeToKgOrL(1, unit);
  if (totalNorm.unit !== oneU.unit || oneU.value <= 0) return identity;

  const rawFactor = totalNorm.value / oneU.value;
  const factor = Math.round(rawFactor * 1_000_000) / 1_000_000;
  if (!(factor > 1 + 0.001)) return identity;

  return { unit: right.unit.toUpperCase(), qty: right.max, factor };
}

/**
 * SELL-UNIT TOTAL to store on `private_price.private_selling_price` from an
 * approved ERP quotation — the inverse of `resolveErpOrderLine`, via the same
 * `joshToErpUnitFactor` (docs/pricing-total-model.md, decision 2026-09-28):
 * `RATE` is per `quotation.unit`; multiply by how many of that unit make up
 * ONE SELL UNIT (`resolveSellUnit` above — the Josh order unit itself for a
 * non-pack SKU) to land on the sell-unit total (e.g. otu PC, pack
 * `7-9 KG X 1 PC`, unit KG rate 3485 → 3485 × 9 = 31365; lobster otu KG, pack
 * `800-900 GM X 15 KG`, unit KG rate 2400 → 2400 × 15 = 36000; unit KG on a
 * non-pack otu-KG SKU → factor 1, rate unchanged).
 *
 * Returns `null` (caller must NOT write a price) when:
 * - `RATE` is missing/zero — never falls back to `ORDERING_RATE`; that field
 *   is RATE × pack weight even when RATE is already per-piece (see docs), so
 *   using it raw would silently store a box price as a per-piece total.
 * - `quotation.unit` is present, differs from the Josh order unit, and there
 *   is no reliable factor for the pair (count ↔ count, weight → count) —
 *   guessing a price here is worse than skipping it.
 * `quotation.unit` missing entirely → assumed to already be the Josh order
 * unit (factor 1, `RATE` unchanged).
 */
export function resolveQuotationPrivateSellingPrice(
  inventory: JoshOrderUnitSource,
  quotation: {
    unit?: string | null;
    rate?: number | string | null;
    ordering_rate?: number | string | null;
  },
): number | null {
  const rate = Number(quotation.rate ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const unit = quotation.unit?.trim();
  if (!unit) return roundMoney(rate);

  const factor = joshToErpUnitFactor(inventory, unit);
  if (factor == null) return null;

  return roundMoney(rate * factor);
}

export function parseSide(
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
 * Weight of ONE cart unit of an Approx SKU — what the price is charged on (cart line = price × qty),
 * so cart "น้ำหนักรวม" = this × qty. Weight order unit sold per 1 U → exactly 1 U; a weight pack
 * sell unit or a count order unit (PC/BX) → the pack total ("0.20 - 0.21 KG X 24 PC" → 4.8–5.04 KG).
 * Fixed SKUs have no weight range → null.
 */
export function sellUnitWeightRange(
  inv: (JoshOrderUnitSource & { packaging_type?: string | null }) | null | undefined,
): PackTotalQty | null {
  if (inv?.packaging_type?.trim().toLowerCase() !== 'approx') return null;
  const sell = resolveSellUnit(inv);
  if (isWeightUnit(sell.unit) && sell.factor === 1) {
    const one = normalizeToKgOrL(1, sell.unit);
    return { min: one.value, max: one.value, unit: one.unit };
  }
  return resolvePackTotalQty(inv);
}
