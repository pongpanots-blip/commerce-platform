import { z } from 'zod';
import { promotionRehearsalSchema } from '../commerce-previews/promotion-rehearsal';
export const promotionScenarioSchema = z.object({ name: z.string().trim().min(1).max(120), line: promotionRehearsalSchema.shape.line,
  proposedValue: promotionRehearsalSchema.shape.rules.unwrap().element.shape.value.nullable(),
  minimumGrossMarginPercent: promotionRehearsalSchema.shape.minimumGrossMarginPercent }).strict();
export const createPromotionDraftSchema = z.object({ requestId: z.uuid().transform(s => s.toLowerCase()), scenario: promotionScenarioSchema }).strict();
export const updatePromotionDraftSchema = createPromotionDraftSchema.extend({ revision: z.number().int().positive().max(2_147_483_646) }).strict();
export type PromotionScenario = z.infer<typeof promotionScenarioSchema>;
