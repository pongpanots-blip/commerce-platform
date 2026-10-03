import { parseWeightRange, WeightRange } from './weight-range.helper';

export type AvgPriceInput = {
  selling_unit_price: number | string | null; // resolved price the customer actually pays
  /**
   * ERP selling unit. When this is already a weight/volume unit (KG/G/ML/L/…),
   * `selling_unit_price` is SELLING_UNIT_PRICE (per kg etc.) — do NOT divide by pack
   * weight again. Pack ORDERING_PRICE lives in `ordering_price` separately.
   */
  selling_unit?: string | null;
  packaging_type: string | null;
  pack_size: string | null;
  units_per_box: string | null;
  weight_per_unit: string | null;
};

export type AvgPriceResult = {
  avgPriceMin: number | null;
  avgPriceMax: number | null; // === avgPriceMin when perPiece is a single value, not a range
  avgPriceUnit: string | null;
};

const WEIGHT_VOLUME_UNITS = new Set(['KG', 'GM', 'G', 'ML', 'L', 'LT']);

/** ERP pack / carton selling units — `selling_unit_price` is the whole-box total. */
/** `CA` is a can (`245 ML X 24 CA`), a piece — not a case. */
const BOX_SELLING_UNITS = new Set(['BX', 'CT', 'CS']);

type SideQuantity = { value: number; unit: string | null };

/** GM/ML normalize into KG/L; everything else (KG, L/LT, count units) pass through as-is. */
type UnitNormalization = { value: number; unit: string };

/**
 * Named conversion table for the weight/volume units this design deals with —
 * deliberately not inlined arithmetic, see avg-price-formula-fix design doc.
 */
const WEIGHT_VOLUME_NORMALIZERS: Record<
  string,
  (value: number) => UnitNormalization
> = {
  KG: (value) => ({ value, unit: 'KG' }),
  GM: (value) => ({ value: value / 1000, unit: 'KG' }),
  G: (value) => ({ value: value / 1000, unit: 'KG' }),
  ML: (value) => ({ value: value / 1000, unit: 'L' }),
  L: (value) => ({ value, unit: 'L' }),
  LT: (value) => ({ value, unit: 'L' }),
};

function isWeightVolumeUnit(unit: string | null): boolean {
  return unit != null && WEIGHT_VOLUME_UNITS.has(unit.toUpperCase());
}

function isBoxSellingUnit(unit: string | null | undefined): boolean {
  return unit != null && BOX_SELLING_UNITS.has(unit.trim().toUpperCase());
}

/** Normalizes a weight/volume side's value + unit via the named table above. */
function normalizeWeightVolume(
  value: number,
  unit: string,
): UnitNormalization {
  const normalizer = WEIGHT_VOLUME_NORMALIZERS[unit.toUpperCase()];
  return normalizer ? normalizer(value) : { value, unit: unit.toUpperCase() };
}

/**
 * Parses the sellingUnitQty (second) side of a pack_size string, e.g. the
 * "5 KG" in "0.05 - 0.06 KG X 5 KG" or the "1 BX" in "48 PC X 1 BX" —
 * single value + unit, never a range on this side.
 */
export function parseSideQuantity(
  value: string | null | undefined,
): SideQuantity | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/);
  if (!match) return null;

  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return null;

  return { value: num, unit: match[2] ?? null };
}

type ParsedPackSize = {
  perPiece: WeightRange | SideQuantity | null;
  sellingUnitQty: SideQuantity | null;
};

/** Splits "<perPieceQty> X <sellingUnitQty>" into its two raw sides. */
function splitPackSize(
  packSize: string,
): { perPieceRaw: string; sellingUnitRaw: string } | null {
  const parts = packSize.split(/\s+x\s+/i);
  if (parts.length !== 2) return null;
  return { perPieceRaw: parts[0].trim(), sellingUnitRaw: parts[1].trim() };
}

/** Parses pack_size, falling back to the units_per_box/weight_per_unit column pair. */
function parseSides(inv: AvgPriceInput): ParsedPackSize | null {
  if (inv.pack_size) {
    const split = splitPackSize(inv.pack_size);
    if (split) {
      const perPiece = parseWeightRange(split.perPieceRaw);
      const sellingUnitQty = parseSideQuantity(split.sellingUnitRaw);
      if (perPiece && sellingUnitQty) {
        return { perPiece, sellingUnitQty };
      }
    }
  }

  // Fallback: units_per_box / weight_per_unit as independent columns —
  // classify each by its own unit, same as the pack_size split would.
  const a = parseWeightRange(inv.units_per_box);
  const b = parseWeightRange(inv.weight_per_unit);
  if (!a && !b) return null;

  const aIsWeight = isWeightVolumeUnit(a?.unit ?? null);
  const bIsWeight = isWeightVolumeUnit(b?.unit ?? null);

  // Classify each column by its own unit, exactly like the pack_size path:
  // whichever of units_per_box/weight_per_unit carries a weight/volume unit
  // is perPiece (keeping its range), the other is sellingUnitQty. If both or
  // neither carry a weight/volume unit, fall back to the pack_size grammar's
  // default ordering (units_per_box first, as perPiece).
  if (a && b) {
    if (bIsWeight && !aIsWeight) {
      return {
        perPiece: b,
        sellingUnitQty: { value: a.min, unit: a.unit },
      };
    }
    return {
      perPiece: a,
      sellingUnitQty: { value: b.min, unit: b.unit },
    };
  }
  if (a && !b) {
    return aIsWeight
      ? { perPiece: a, sellingUnitQty: null }
      : { perPiece: { value: a.min, unit: a.unit }, sellingUnitQty: null };
  }
  if (b && !a) {
    return bIsWeight
      ? { perPiece: b, sellingUnitQty: null }
      : { perPiece: { value: b.min, unit: b.unit }, sellingUnitQty: null };
  }
  return null;
}

function isRange(side: WeightRange | SideQuantity): side is WeightRange {
  return 'min' in side;
}

function sideValueBounds(side: WeightRange | SideQuantity): {
  min: number;
  max: number;
} {
  if (isRange(side)) {
    return { min: side.min, max: side.max ?? side.min };
  }
  return { min: side.value, max: side.value };
}

function sideUnit(side: WeightRange | SideQuantity): string | null {
  return side.unit;
}

const nullResult: AvgPriceResult = {
  avgPriceMin: null,
  avgPriceMax: null,
  avgPriceUnit: null,
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Piece/pack count inside one box when `selling_unit` is BX/CT/…
 * Prefer `units_per_box` (e.g. `16 PC`), else the non-box count side of `pack_size`.
 * Never use weight/volume or BX itself as the divisor (that was Flora → ฿325/KG).
 */
function resolveBoxPieceCount(
  inv: AvgPriceInput,
): { count: number; unit: string } | null {
  const asPiece = (
    value: number,
    unit: string | null,
  ): { count: number; unit: string } | null => {
    if (!Number.isFinite(value) || value <= 0) return null;
    if (!unit || isWeightVolumeUnit(unit) || isBoxSellingUnit(unit)) {
      return null;
    }
    return { count: value, unit: unit.toUpperCase() };
  };

  const fromUnits = parseSideQuantity(inv.units_per_box);
  if (fromUnits) {
    const hit = asPiece(fromUnits.value, fromUnits.unit);
    if (hit) return hit;
  }

  const parsed = parseSides(inv);
  if (parsed?.sellingUnitQty) {
    const hit = asPiece(
      parsed.sellingUnitQty.value,
      parsed.sellingUnitQty.unit,
    );
    if (hit) return hit;
  }
  if (parsed?.perPiece) {
    const { max } = sideValueBounds(parsed.perPiece);
    const hit = asPiece(max, sideUnit(parsed.perPiece));
    if (hit) return hit;
  }

  return null;
}

export function computeAvgPrice(inv: AvgPriceInput): AvgPriceResult {
  const selling = Number(inv.selling_unit_price);
  if (!Number.isFinite(selling) || selling <= 0) return nullResult;

  // Split by selling_unit (PC / BX / KG) before pack_size weight grammar:
  // - KG/L/… → selling_unit_price is already the rate (do not ÷ pack kg again)
  // - BX/CT/… → selling_unit_price is the box total → ÷ piece count in the box
  // - other count units (PC/PK/…) → selling_unit_price is already per that unit
  const sellingUnit = inv.selling_unit?.trim() || null;
  if (sellingUnit && isWeightVolumeUnit(sellingUnit)) {
    const normalized = normalizeWeightVolume(1, sellingUnit);
    const price = round2(selling);
    return {
      avgPriceMin: price,
      avgPriceMax: price,
      avgPriceUnit: normalized.unit,
    };
  }

  if (sellingUnit && isBoxSellingUnit(sellingUnit)) {
    const piece = resolveBoxPieceCount(inv);
    if (!piece) {
      // No piece count to divide by — still show a unit price (per box), never hide it.
      const price = round2(selling);
      return {
        avgPriceMin: price,
        avgPriceMax: price,
        avgPriceUnit: sellingUnit.toUpperCase(),
      };
    }
    const price = round2(selling / piece.count);
    return {
      avgPriceMin: price,
      avgPriceMax: price,
      avgPriceUnit: piece.unit,
    };
  }

  if (sellingUnit && !isWeightVolumeUnit(sellingUnit)) {
    // PC / PK / DZ / … — price is already per selling_unit.
    const price = round2(selling);
    return {
      avgPriceMin: price,
      avgPriceMax: price,
      avgPriceUnit: sellingUnit.toUpperCase(),
    };
  }

  const parsed = parseSides(inv);
  if (!parsed || !parsed.perPiece) return nullResult;

  const { perPiece, sellingUnitQty } = parsed;
  const perPieceIsWeight = isWeightVolumeUnit(sideUnit(perPiece));
  const sellingIsWeight =
    sellingUnitQty != null && isWeightVolumeUnit(sellingUnitQty.unit);

  // Whichever side carries a weight/volume unit wins as the divisor when
  // BOTH sides do — it is the pack's total weight/volume by construction,
  // the other side is informational only in that case.
  if (sellingIsWeight && sellingUnitQty) {
    const divisor = sellingUnitQty.value;
    if (!divisor) return nullResult;
    const normalized = normalizeWeightVolume(divisor, sellingUnitQty.unit!);
    const price = round2(selling / normalized.value);
    return { avgPriceMin: price, avgPriceMax: price, avgPriceUnit: normalized.unit };
  }

  // perPiece is the divisor (weight/volume or count), possibly multiplied by
  // a sellingUnitQty count, possibly a range.
  const count = sellingUnitQty ? sellingUnitQty.value : 1;
  if (!Number.isFinite(count) || count <= 0) return nullResult;

  const { min, max } = sideValueBounds(perPiece);
  const unit = sideUnit(perPiece);
  if (!min || !max) return nullResult;

  const divisorMin = min * count;
  const divisorMax = max * count;

  if (perPieceIsWeight && unit) {
    const normalizedMin = normalizeWeightVolume(divisorMin, unit);
    const normalizedMax = normalizeWeightVolume(divisorMax, unit);
    // avgPriceMax = selling/min divisor (smaller divisor → higher price),
    // avgPriceMin = selling/max divisor.
    return {
      avgPriceMax: round2(selling / normalizedMin.value),
      avgPriceMin: round2(selling / normalizedMax.value),
      avgPriceUnit: normalizedMin.unit,
    };
  }

  if (!unit) return nullResult;
  return {
    avgPriceMax: round2(selling / divisorMin),
    avgPriceMin: round2(selling / divisorMax),
    avgPriceUnit: unit,
  };
}
