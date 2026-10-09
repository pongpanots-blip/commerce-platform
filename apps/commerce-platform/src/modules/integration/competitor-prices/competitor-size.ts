import { InventoryShape, roundMoney } from './catalog-shape';
import { computeAvgPrice } from '../../../shared-kernel/helpers/avg-price.helper';
import { isWeightUnit, resolvePackTotalQty, resolveSellUnit } from '../../../shared-kernel/helpers/pack-order-price.helper';

// Ported from josh apps/backend/src/app/competitor-prices/competitor-size.ts (origin/main 8a44dd00; ourPack from refactor/pricing-total-price-model 714f4427); keep in step.

/** Comparison units. Everything is converted to one of these before two prices are compared. */
export type BaseUnit = 'kg' | 'l' | 'piece';
/** What a person can type for a pack size; g/ml convert to kg/l. */
export type InputUnit = 'kg' | 'g' | 'l' | 'ml' | 'piece';
export type PackSize = { unit: BaseUnit; min: number; max: number; packCount: number };

export const unitLabel: Record<BaseUnit, string> = { kg: 'กก.', l: 'ลิตร', piece: 'ชิ้น' };
const fmt = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 3 });
const baht = (n: number) => `฿${Math.round(n).toLocaleString('th-TH')}`;

/** A typed size → base unit. `min = max` for a fixed size; `packCount` pieces per pack (250 มล. × 24). */
export function toPackSize(input: { unit: InputUnit; min: number; max?: number | null; packCount?: number | null }): PackSize {
  const factor = input.unit === 'g' || input.unit === 'ml' ? 1 / 1000 : 1;
  const unit: BaseUnit = input.unit === 'g' || input.unit === 'kg' ? 'kg' : input.unit === 'ml' || input.unit === 'l' ? 'l' : 'piece';
  const min = input.min * factor;
  const max = (input.max ?? input.min) * factor;
  return { unit, min: Math.min(min, max), max: Math.max(min, max), packCount: Math.max(1, Math.round(input.packCount ?? 1)) };
}
/** Total quantity used for price per unit: the middle of a range × pieces. */
export const packQuantity = (size: PackSize) => (size.min + size.max) / 2 * size.packCount;
export function packSizeText(size: PackSize) {
  const each = size.min === size.max ? `${fmt(size.min)} ${unitLabel[size.unit]}` : `${fmt(size.min)}–${fmt(size.max)} ${unitLabel[size.unit]}`;
  return size.packCount > 1 ? `${each} × ${size.packCount}` : each;
}

/** Liters written in a name or weight_per_unit: "1 ลิตร", "500 มล.", "1L". */
export function extractedVolumeL(text: string): number | null {
  if (/\d\s*[-–]\s*\d|[x×]\s*\d/i.test(text)) return null;
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(ลิตร|มล\.?|ml|l)(?![a-z])/gi)];
  if (matches.length !== 1) return null;
  const value = Number(matches[0][1]) / (/^(มล\.?|ml)$/i.test(matches[0][2]) ? 1000 : 1);
  return value > 0 && value <= 100000 ? value : null;
}
/** The size readable from a collected item's name (kg first, then liters); null = a person must type it. */
export function itemPackSize(name: string, weightKg: number | null): PackSize | null {
  if (weightKg != null && weightKg > 0) return { unit: 'kg', min: weightKg, max: weightKg, packCount: 1 };
  const liters = extractedVolumeL(name);
  return liters ? { unit: 'l', min: liters, max: liters, packCount: 1 } : null;
}

/**
 * How we sell this SKU, in comparison terms: unit, quantity of one sell unit, and our price per unit (the shop's
 * avg price of `selling_price`). Per-kg SKUs compare at one fixed-weight pack, else 1 kg. `rate` is null when the
 * catalog has no single price per unit (Approx carton range).
 */
export function ourPack(product: InventoryShape, pricePerKg: { min: number; max: number } | null) {
  const avg = computeAvgPrice(product.selling_price, product);
  if (avg.avgPriceUnit === 'KG') {
    const pack = resolvePackTotalQty(product);
    const fixedPackKg = pack && !isWeightUnit(resolveSellUnit(product).unit) && pack.unit === 'KG' && pack.min === pack.max ? pack.max : null;
    return { unit: 'kg' as BaseUnit, qty: fixedPackKg ?? 1, rate: pricePerKg && pricePerKg.min === pricePerKg.max ? pricePerKg.min : null };
  }
  if (avg.avgPriceUnit === 'L') return { unit: 'l' as BaseUnit, qty: 1, rate: avg.avgPriceMax };
  const price = Number(product.selling_price) || 0;
  return { unit: 'piece' as BaseUnit, qty: 1, rate: avg.avgPriceMax ?? (price > 0 ? price : null) };
}

export type CompareTone = 'cheaper' | 'pricier' | 'close' | 'unknown';
/**
 * Compare at OUR pack size, in baht first — what a buyer feels. A 2 กก. vs 1 กก. pack never shows as a big gap:
 * within ±3 % or ±฿5 per our pack is "พอๆ กัน". Ranges compare at their middle and say so.
 */
export function compareAtOurPack(our: { unit: BaseUnit; qty: number; rate: number | null }, packPrice: number | null, size: PackSize | null) {
  const packLine = size ? `แพ็ก ${packSizeText(size)}${packPrice == null ? '' : ` = ${baht(packPrice)}`}` : packPrice == null ? 'ยังไม่มีราคา' : `ราคา ${baht(packPrice)} · ขนาดยังไม่ระบุ`;
  const result = (verdict: string, tone: CompareTone, equivLine = '', differencePercent: number | null = null) => ({ packLine, equivLine, verdict, tone, differencePercent });
  if (!size) return result('ใส่ขนาดก่อนเทียบ', 'unknown');
  if (packPrice == null) return result('ยังไม่มีราคาที่ยืนยัน VAT', 'unknown');
  if (size.unit !== our.unit) return result(`หน่วยไม่ตรงกัน (เรา ${unitLabel[our.unit]} / เขา ${unitLabel[size.unit]})`, 'unknown');
  if (our.rate == null) return result('ราคาเราเป็นช่วง เทียบไม่ได้', 'unknown');
  const theirRate = packPrice / packQuantity(size);
  const theirs = theirRate * our.qty;
  const ours = our.rate * our.qty;
  const diff = theirs - ours;
  const pct = roundMoney(diff / theirs * 100);
  const mid = size.min === size.max ? '' : ' (ค่ากลางของช่วง)';
  const equivLine = `ถ้าซื้อ ${fmt(our.qty)} ${unitLabel[our.unit]} เท่าเรา: เขา ${baht(theirs)}${mid} · เรา ${baht(ours)}`;
  if (Math.abs(pct) < 3 || Math.abs(diff) < 5) return result(`พอๆ กัน (ต่าง ${baht(Math.abs(diff))})`, 'close', equivLine, pct);
  return result(`${diff > 0 ? 'เราถูกกว่า' : 'เราแพงกว่า'} ${baht(Math.abs(diff))} (${Math.abs(pct)}%)`, diff > 0 ? 'cheaper' : 'pricier', equivLine, pct);
}
