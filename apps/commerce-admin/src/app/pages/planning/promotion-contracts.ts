import { z } from 'zod';
import { commerceText as text } from '../../commerce-copy';

export const PROMOTION_HOME = '/planning/promotions';
export const promotionApi = '/reports/promotion-planning';
export const uuid = z.uuid().transform(v => v.toLowerCase());
const timestamp = z.iso.datetime({ offset: true });
const quantity = z.number().finite().positive().max(1000000).refine(v => Math.abs(v * 10000 - Math.round(v * 10000)) < 0.00001);
export const promotionValue = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percentage'), percent: z.number().finite().min(0).max(100) }).strict(),
  z.object({ type: z.literal('fixed'), amount: z.number().finite().min(0).max(9999999999.99) }).strict(),
  z.object({ type: z.literal('bogo'), buy_qty: z.number().int().positive().max(1000000), get_qty: z.number().int().positive().max(1000000), get_discount_percent: z.number().finite().min(0).max(100) }).strict(),
  z.object({ type: z.literal('tiered'), tiers: z.array(z.object({ min_qty: z.number().int().positive(), max_qty: z.number().int().positive().optional(), promotion_price: z.number().finite().nonnegative(), unit_label: z.string().optional(), badge_text: z.string().optional() }).strict()).min(1).max(100) }).strict(),
]);
export const scenarioSchema = z.object({ name: z.string().trim().min(1).max(120), line: z.object({ sku: z.string().trim().min(1).max(100).regex(/^[^\x00-\x1f\x7f]+$/), quantity, unit: z.string().min(1).max(32), quantityKind: z.enum(['count', 'measure']) }).strict(), proposedValue: promotionValue.nullable(), minimumGrossMarginPercent: z.number().finite().min(-1000).max(100).nullable() }).strict();
export type PromotionScenario = z.infer<typeof scenarioSchema>;
const inputsSchema = z.object({ schemaVersion: z.literal(1), sku: z.string(), observedAt: timestamp, sourceFreshness: z.literal('unavailable'),
  product: z.object({ id: z.string().min(1), unit: z.string().nullable(), packagingType: z.string().nullable(), packSize: z.string().nullable(), sourceVersion: z.string().nullable(), sourceAsOf: timestamp.nullable() }),
  price: z.object({ unitPrice: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).refine(v => Number(v) > 0).nullable(), currency: z.literal('THB'), basis: z.literal('inclusive'), vatRateBasisPoints: z.number().int().min(0).max(10000).nullable(), source: z.enum(['commerce_price', 'catalog_copy']), sourceAsOf: timestamp.nullable() }),
  stock: z.null(), cost: z.null(), existingRules: z.object({ source: z.enum(['commerce', 'josh_shadow']), rules: z.array(z.unknown()).nullable(), mechanicAssigned: z.boolean().nullable(), version: z.string().nullable(), sourceAsOf: z.null() }), unavailable: z.array(z.string()).max(50), activationAllowed: z.literal(false) });
export type PromotionInputs = z.infer<typeof inputsSchema>;
const minor = z.number().int().nonnegative().max(999999999999), unknownCost = z.null();
const amountsSchema = z.object({ currency: z.literal('THB'), basis: z.literal('inclusive'), beforeDiscountMinor: minor, discountMinor: minor, afterDiscountUnitMinor: minor, afterDiscountMinor: minor,
  nominalEngineAfterDiscountMinor: minor, roundingAdjustmentMinor: z.number().int().min(-999999999999).max(999999999999), totalIncVatMinor: minor.nullable(), revenueExVatMinor: minor.nullable(), vatMinor: minor.nullable(),
  costExVatMinor: unknownCost, grossProfitMinor: unknownCost, grossMarginPercent: unknownCost, markupPercent: unknownCost }).superRefine((v, ctx) => {
    if (v.beforeDiscountMinor - v.discountMinor !== v.afterDiscountMinor || v.afterDiscountMinor - v.nominalEngineAfterDiscountMinor !== v.roundingAdjustmentMinor ||
      v.revenueExVatMinor !== null && v.vatMinor !== null && v.totalIncVatMinor !== v.revenueExVatMinor + v.vatMinor) ctx.addIssue({ code: 'custom', message: 'Inconsistent amount evidence' });
  });
const previewSchema = z.object({ mode: z.literal('preview'), persisted: z.literal(false), activationAllowed: z.literal(false), inputAuthority: z.literal('server_read_observations'), at: timestamp,
  roundingPolicy: z.literal('josh_unit_price_then_preview_line_half_up'), status: z.enum(['incomplete', 'rejected', 'constraints_failed']), issues: z.array(z.object({ code: z.string(), input: z.string() })).min(1).max(100), amounts: amountsSchema.nullable(), stock: z.null(),
  evidence: z.array(z.object({ input: z.string(), id: z.string(), version: z.string(), asOf: timestamp, validUntil: timestamp })).max(30) });
export const previewResponseSchema = z.object({ scenario: scenarioSchema, inputs: inputsSchema, preview: previewSchema }).superRefine((v, ctx) => {
  if (v.scenario.line.sku !== v.inputs.sku) ctx.addIssue({ code: 'custom', message: 'SKU identity mismatch' });
});
export const receiptSchema = z.object({ id: uuid, revision: z.number().int().positive(), status: z.literal('draft'), saved: z.literal(true), persisted: z.literal(true), activationAllowed: z.literal(false), operationalWrites: z.literal(false),
  scenario: scenarioSchema, inputs: inputsSchema, preview: previewSchema, createdAt: timestamp, updatedAt: timestamp, replayed: z.boolean().optional() }).superRefine((v, ctx) => {
    if (v.scenario.line.sku !== v.inputs.sku || Date.parse(v.updatedAt) < Date.parse(v.createdAt)) ctx.addIssue({ code: 'custom', message: 'Invalid draft evidence' });
  });
export type PromotionReceipt = z.infer<typeof receiptSchema>;
export type PromotionPreview = z.infer<typeof previewResponseSchema>;
export const draftPageSchema = z.object({ items: z.array(receiptSchema).max(20), next: uuid.nullable() }).superRefine((v, ctx) => {
  if (new Set(v.items.map(i => i.id)).size !== v.items.length || v.next !== null && (!v.items.length || v.next !== v.items[v.items.length - 1].id)) ctx.addIssue({ code: 'custom', message: 'Invalid draft cursor' });
});
export function parseInputs(raw: unknown, sku: string) { const v = inputsSchema.parse(raw); if (v.sku !== sku) throw new Error(text('ข้อมูลสินค้าไม่ตรงกับรหัสที่เลือก', 'Product identity does not match.')); return v; }
export function parsePreview(raw: unknown, scenario: PromotionScenario) { const v = previewResponseSchema.parse(raw); if (!sameScenario(v.scenario, scenario)) throw new Error(text('ผลทดลองไม่ตรงกับร่างนี้', 'Preview does not match this draft.')); return v; }
export function parseReceipt(raw: unknown, id?: string) { const v = receiptSchema.parse(raw); if (id && v.id !== id) throw new Error(text('ผลบันทึกไม่ตรงกับร่างนี้', 'Receipt identity does not match.')); return v; }
export function sameScenario(a: PromotionScenario, b: PromotionScenario) { return JSON.stringify(scenarioSchema.parse(a)) === JSON.stringify(scenarioSchema.parse(b)); }
export const money = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value / 100);
export const observedTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('th-TH') : text('ยังยืนยันเวลาไม่ได้', 'Timestamp unavailable');
export function friendlyError(error: unknown) {
  if (error instanceof z.ZodError) return text('ข้อมูลที่ได้รับยังยืนยันไม่ได้ โปรดลองโหลดอีกครั้ง', 'The response could not be verified. Try loading again.');
  const status = (error as { status?: number })?.status;
  if (status === 409) return text('ข้อมูลเปลี่ยนหรือรหัสสินค้ายังไม่ชัดเจน ตรวจฉบับล่าสุดก่อนลองใหม่', 'The draft changed or the SKU is ambiguous. Review the latest version.');
  if (status === 404) return text('ยังไม่พบรายการนี้ในแหล่งข้อมูลที่อ่านได้', 'This record was not found in the readable source.');
  if (status === 401 || status === 403) return text('ยังเข้าถึงข้อมูลนี้ไม่ได้ โปรดตรวจบัญชีที่ใช้งาน', 'This account cannot access this record.');
  return text('ช่วงนี้ยังยืนยันข้อมูลไม่ได้ โปรดลองอีกครั้ง', 'The source could not be verified. Try again.');
}
