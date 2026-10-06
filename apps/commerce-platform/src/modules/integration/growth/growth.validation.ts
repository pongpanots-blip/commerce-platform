import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { GrowthPlanInput } from '@cp/growth';

const text = (max: number) => z.string().trim().max(max);
const ids = z.array(z.string().uuid()).max(50).refine(a => new Set(a).size === a.length, 'IDs must be unique');
const iso = z.string().datetime({ offset: true }).nullable();
export const contentSchema = z.object({
  label: text(100), title: text(200), body: text(4000), evidenceIds: z.array(text(200).min(1)).max(50),
}).strict();
export const planSchema = z.object({
  title: text(200).min(1), goal: text(2000).min(1), template: z.enum(['cart_idle', 'reorder', 'winback', 'market']),
  owner: text(200), segmentIds: ids, excludeSegmentIds: ids, productSkus: z.array(text(100).min(1)).max(50),
  notifyTemplateKey: text(100).regex(/^custom_[a-zA-Z0-9_-]+$/).nullable(),
  scheduleAt: iso, budgetThb: z.number().finite().min(0).max(10000000),
  minimumMarginPercent: z.number().finite().min(0).max(100), holdoutPercent: z.number().int().min(1).max(50),
  cooldownDays: z.number().int().min(1).max(365), conversionWindowDays: z.number().int().min(1).max(90),
  variants: z.array(contentSchema).min(1).max(2), selectedVariant: z.number().int().min(0).max(1),
  researchTopicId: z.string().uuid().nullable(), researchRunId: z.string().uuid().nullable(),
}).strict().superRefine((p, ctx) => {
  if (p.selectedVariant >= p.variants.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'selectedVariant is missing' });
  if (!!p.researchTopicId !== !!p.researchRunId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'research topic and run must be supplied together' });
  if (p.segmentIds.some(id => p.excludeSegmentIds.includes(id))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'audience and exclusions overlap' });
});
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();
export const planListSchema = z.object({
  page: z.coerce.number().int().min(1).max(50000).default(1), limit: z.coerce.number().int().min(1).max(200).default(20),
  search: text(200).default(''), status: z.enum(['draft', 'review', 'approved', 'ready', 'exporting', 'export_unknown']).optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
}).strict();
export const createSchema = z.object({ requestId: z.string().uuid(), plan: planSchema }).strict();
export const updateSchema = z.object({ version: z.number().int().positive(), plan: planSchema }).strict();
export const taskSchema = z.object({
  version: z.number().int().positive(),
  tasks: z.array(z.object({ id: z.string().uuid(), title: text(500).min(1), owner: text(200), dueAt: iso, done: z.boolean() }).strict()).max(100),
}).strict().refine(p => new Set(p.tasks.map(t => t.id)).size === p.tasks.length, 'task IDs must be unique');
export const aiRequestSchema = z.object({ version: z.number().int().positive(), instruction: text(4000).min(1) }).strict();
export const aiDraftSchema = z.object({ variants: z.array(contentSchema).length(2), rationale: text(4000).min(1), evidenceIds: z.array(text(200).min(1)).max(50) }).strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}
export function assertCitations(plan: Pick<GrowthPlanInput, 'variants'>, evidenceIds: Set<string>) {
  if (plan.variants.some(v => v.evidenceIds.some(id => !evidenceIds.has(id)))) throw new BadRequestException('ข้อความอ้างอิงหลักฐานที่ไม่ได้อยู่ในแผนนี้');
}
export function assertReviewable(plan: GrowthPlanInput) {
  const v = plan.variants[plan.selectedVariant];
  if (!plan.owner || !plan.segmentIds.length || !v.title || !v.body) throw new BadRequestException('ระบุเจ้าของ กลุ่มเป้าหมาย หัวข้อและข้อความก่อนส่งตรวจ');
}
