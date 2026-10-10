import { commerceText as text } from '../../commerce-copy';
import { scenarioSchema, type PromotionScenario } from './promotion-contracts';

export interface TierForm { min: string; max: string; price: string; unitLabel?: string; badgeText?: string }
export interface PromotionForm { name: string; sku: string; quantity: string; quantityKind: 'count' | 'measure'; unit: string; type: 'none' | 'percentage' | 'fixed' | 'bogo' | 'tiered'; percent: string; amount: string; buy: string; get: string; getPercent: string; margin: string; tiers: TierForm[] }
export const blankPromotionForm = (): PromotionForm => ({ name: '', sku: '', quantity: '1', quantityKind: 'count', unit: '', type: 'percentage', percent: '', amount: '', buy: '1', get: '1', getPercent: '100', margin: '', tiers: [{ min: '1', max: '', price: '' }] });
export function formFromScenario(s: PromotionScenario): PromotionForm {
  const v = s.proposedValue;
  return { ...blankPromotionForm(), name: s.name, sku: s.line.sku, quantity: String(s.line.quantity), quantityKind: s.line.quantityKind, unit: s.line.unit,
    type: v?.type ?? 'none', percent: v?.type === 'percentage' ? String(v.percent) : '', amount: v?.type === 'fixed' ? String(v.amount) : '',
    buy: v?.type === 'bogo' ? String(v.buy_qty) : '1', get: v?.type === 'bogo' ? String(v.get_qty) : '1', getPercent: v?.type === 'bogo' ? String(v.get_discount_percent) : '100',
    margin: s.minimumGrossMarginPercent === null ? '' : String(s.minimumGrossMarginPercent),
    tiers: v?.type === 'tiered' ? v.tiers.map(t => ({ min: String(t.min_qty), max: t.max_qty === undefined ? '' : String(t.max_qty), price: String(t.promotion_price), unitLabel: t.unit_label, badgeText: t.badge_text })) : blankPromotionForm().tiers };
}
const numeric = (v: string) => /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN;
export function buildPromotionScenario(form: PromotionForm) {
  const errors: Record<string, string> = {};
  const invalid = text('กรอกตัวเลขในช่วงที่กำหนด', 'Enter a number within the stated range.');
  const v = form.type === 'none' ? null : form.type === 'percentage' ? { type: 'percentage', percent: numeric(form.percent) } : form.type === 'fixed' ? { type: 'fixed', amount: numeric(form.amount) }
    : form.type === 'bogo' ? { type: 'bogo', buy_qty: numeric(form.buy), get_qty: numeric(form.get), get_discount_percent: numeric(form.getPercent) }
      : { type: 'tiered', tiers: form.tiers.map(t => ({ min_qty: numeric(t.min), ...(t.max.trim() ? { max_qty: numeric(t.max) } : {}), promotion_price: numeric(t.price), ...(t.unitLabel !== undefined ? { unit_label: t.unitLabel } : {}), ...(t.badgeText !== undefined ? { badge_text: t.badgeText } : {}) })) };
  const parsed = scenarioSchema.safeParse({ name: form.name, line: { sku: form.sku, quantity: numeric(form.quantity), quantityKind: form.quantityKind, unit: form.unit }, proposedValue: v, minimumGrossMarginPercent: form.margin.trim() ? numeric(form.margin) : null });
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const path = issue.path.join('.'), field = path === 'name' ? 'name' : path === 'line.sku' ? 'sku' : path === 'line.quantity' ? 'quantity' : path === 'line.unit' ? 'unit'
      : path.endsWith('get_discount_percent') ? 'getPercent' : path.endsWith('percent') ? 'percent' : path.endsWith('amount') ? 'amount' : path.endsWith('buy_qty') ? 'buy' : path.endsWith('get_qty') ? 'get' : path === 'minimumGrossMarginPercent' ? 'margin' : path.replace('proposedValue.', '');
    errors[field] = ['name', 'sku'].includes(field) ? text('กรอกข้อมูลนี้ก่อนดำเนินการต่อ', 'Complete this field before continuing.') : invalid;
  }
  if (form.quantityKind === 'count' && !Number.isInteger(numeric(form.quantity))) errors.quantity = text('จำนวนชิ้นต้องเป็นจำนวนเต็ม หากวัดตามน้ำหนักให้เปลี่ยนวิธีนับ', 'Count quantities must be whole numbers. Use measured quantity for weight.');
  if (form.type === 'bogo' && form.quantityKind !== 'count') errors.quantityKind = text('ชุดแถมใช้ได้กับจำนวนชิ้นเท่านั้น', 'Buy/get offers require count quantities.');
  if (form.type === 'tiered') for (let i = 0; i < form.tiers.length; i++) {
    const t = form.tiers[i], min = numeric(t.min), max = t.max.trim() ? numeric(t.max) : null;
    if (max !== null && max < min) errors[`tiers.${i}.max_qty`] = text('จำนวนสูงสุดต้องไม่น้อยกว่าจำนวนเริ่มต้น', 'Maximum quantity cannot be below the minimum.');
    const previous = form.tiers[i - 1];
    if (previous && (!previous.max.trim() || min <= numeric(previous.max))) errors[`tiers.${i}.min_qty`] = text('ช่วงจำนวนต้องเรียงจากน้อยไปมากและไม่ทับกัน', 'Quantity ranges must increase without overlapping.');
  }
  return { scenario: parsed.success && !Object.keys(errors).length ? parsed.data : null, errors };
}

const backupKey = (owner: string, draftId?: string) => `cp:promotion-form:v1:${encodeURIComponent(owner)}:${draftId ?? 'new'}`;
export function readPromotionForm(owner: string, draftId?: string): { revision: number | null; form: PromotionForm } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(backupKey(owner, draftId)) ?? 'null');
    if (v && (v.revision === null || Number.isSafeInteger(v.revision) && v.revision > 0) && v.form && Object.keys(blankPromotionForm()).every(k => k === 'tiers' ? Array.isArray(v.form[k]) && v.form[k].length <= 100 && v.form[k].every((t: TierForm) => ['min', 'max', 'price'].every(p => typeof t[p as keyof TierForm] === 'string')) : typeof v.form[k] === 'string') && ['count', 'measure'].includes(v.form.quantityKind) && ['none', 'percentage', 'fixed', 'bogo', 'tiered'].includes(v.form.type)) return v;
  } catch { /* A corrupt or unavailable browser backup is never saved as a server draft. */ }
  return null;
}
export function storePromotionForm(owner: string, draftId: string | undefined, revision: number | null, form: PromotionForm) { try { sessionStorage.setItem(backupKey(owner, draftId), JSON.stringify({ revision, form })); } catch { /* Pending writes still require a verified durable journal. */ } }
export function clearPromotionForm(owner: string, draftId?: string) { try { sessionStorage.removeItem(backupKey(owner, draftId)); } catch { /* Receipt verification remains authoritative. */ } }
