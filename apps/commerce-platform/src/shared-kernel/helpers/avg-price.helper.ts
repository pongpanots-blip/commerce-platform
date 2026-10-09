import {
  isWeightUnit,
  normalizeToKgOrL,
  resolvePackTotalQty,
  resolveSellUnit,
} from './pack-order-price.helper';

/**
 * avg = ราคาแดงรวม (order-unit total) ÷ ตัวหารจาก `order_taking_unit` เมื่อเป็นหน่วย
 * น้ำหนัก/ปริมาตร **และไม่ใช่ sell unit แบบ pack** มิฉะนั้น ÷ ตัวหารจาก pack
 * (docs/pricing-total-model.md, decision 2026-09-28 — sell unit):
 * - `order_taking_unit` เป็นหน่วยน้ำหนัก/ปริมาตร (KG/G/GM/GR/L/LT/ML/…) และ pack ไม่ใหญ่
 *   กว่า 1 หน่วยนั้น (`resolveSellUnit().factor === 1`) → ราคาต่อ ONE order_taking_unit
 *   อยู่แล้ว (ERP `PRICE` ต่อ 1 กก./1 กรัม/1 ลิตร ฯลฯ ไม่ใช่ต่อแพ็ค) → ÷ ขนาดของ 1
 *   order_taking_unit เทียบเป็น KG/L (เช่น GM → ×1000, ML → ×1000/L) min = max เสมอ —
 *   กติกานี้ทำก่อนกติกา pack ด้านล่างเสมอ
 * - pack เป็น sell unit (`factor !== 1`, ราคาแดงเป็นราคาต่อแพ็คแล้ว — เช่น SFYCWT26852027
 *   30000 ÷ 15 กก. = 2000/กก., VBCUNB08120130 3520 ÷ 32000/กก.) หรือไม่เข้าเงื่อนไขบน
 *   แล้ว pack มีน้ำหนัก/ปริมาตร → ÷ `resolvePackTotalQty().max` หน่วยนั้น (min = max เสมอ)
 * - pack เป็นหน่วยนับล้วน (เช่น `6 PC X 1 PK`, `48 PC X 1 BX`) → ÷ จำนวนชิ้นฝั่งซ้าย
 *   หน่วย = หน่วยนับนั้น
 * - parse ไม่ได้ → null
 */
export type AvgPriceInput = {
  pack_size: string | null;
  units_per_box: string | null;
  weight_per_unit: string | null;
  order_taking_unit?: string | null;
  sub_packing_unit?: string | null;
  selling_unit?: string | null;
};

export type AvgPriceResult = {
  avgPriceMin: number | null;
  avgPriceMax: number | null;
  avgPriceUnit: string | null;
};

const nullResult: AvgPriceResult = {
  avgPriceMin: null,
  avgPriceMax: null,
  avgPriceUnit: null,
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseSideQuantity(
  value: string | null | undefined,
): { value: number; unit: string | null } | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  return { value: num, unit: match[2] ?? null };
}

/**
 * หน่วยนับล้วน (ไม่มีน้ำหนัก/ปริมาตร) — ตัวหารคือฝั่งซ้ายของ `pack_size`
 * ("<count> <UNIT> X <count> <UNIT>"), fallback `units_per_box` เมื่อไม่มี pack_size.
 */
function resolveCountPackDivisor(
  inv: AvgPriceInput,
): { count: number; unit: string } | null {
  const pack = inv.pack_size?.trim();
  if (pack) {
    const parts = pack.split(/\s+x\s+/i);
    if (parts.length === 2) {
      const left = parseSideQuantity(parts[0]);
      if (left?.unit) return { count: left.value, unit: left.unit.toUpperCase() };
    }
  }

  const fallback = parseSideQuantity(inv.units_per_box);
  if (fallback?.unit) return { count: fallback.value, unit: fallback.unit.toUpperCase() };

  return null;
}

export function computeAvgPrice(
  sellingPriceTotal: number | string | null | undefined,
  inv: AvgPriceInput,
): AvgPriceResult {
  const total = Number(sellingPriceTotal);
  if (!Number.isFinite(total) || total <= 0) return nullResult;

  const otu = inv.order_taking_unit?.trim();
  if (isWeightUnit(otu) && resolveSellUnit(inv).factor === 1) {
    const perUnit = normalizeToKgOrL(1, otu!);
    if (perUnit.value > 0) {
      const price = round2(total / perUnit.value);
      return { avgPriceMin: price, avgPriceMax: price, avgPriceUnit: perUnit.unit };
    }
  }

  const packTotal = resolvePackTotalQty(inv);
  if (packTotal && packTotal.max > 0) {
    const price = round2(total / packTotal.max);
    return { avgPriceMin: price, avgPriceMax: price, avgPriceUnit: packTotal.unit };
  }

  const countDivisor = resolveCountPackDivisor(inv);
  if (countDivisor && countDivisor.count > 0) {
    const price = round2(total / countDivisor.count);
    return { avgPriceMin: price, avgPriceMax: price, avgPriceUnit: countDivisor.unit };
  }

  return nullResult;
}
