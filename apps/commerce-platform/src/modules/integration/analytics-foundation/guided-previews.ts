import { z } from 'zod';
import { FixtureScope, SEGMENT_LIMITS, SegmentDefinition } from './segment-contracts';
import { FixtureSegmentExecutor, FixtureSegmentPreview } from './fixture-executor';

export const GUIDED_PREVIEWS = [
  { id: 'approved_without_order', title: 'Approved branches still waiting for their first order', inputs: [
    { key: 'approvalAgeDays', label: 'Approved at least how many days ago?', default: 7, min: 7, max: 365 },
    { key: 'historyLimitDays', label: 'How many days of complete branch history can be checked?', default: 365, min: 1, max: 365 },
  ], note: 'Eligible branches only. Missing approval, birth date or complete lifetime history stays unverified.' },
  { id: 'repeat_buyers_inactive', title: 'Repeat buyers who have not ordered recently', inputs: [
    { key: 'minimumOrders', label: 'At least how many confirmed orders?', default: 3, min: 3, max: 10000 },
    { key: 'purchaseWindowDays', label: 'Over how many days?', default: 90, min: 1, max: 365 },
    { key: 'inactiveDays', label: 'No confirmed orders in the last how many days?', default: 14, min: 1, max: 365 },
  ], note: 'This describes recorded inactivity. It does not predict churn or create a contact audience.' },
] as const;
const days = z.number().int().min(1).max(SEGMENT_LIMITS.maxWindowDays);
const request = z.discriminatedUnion('template', [
  z.object({ template: z.literal('approved_without_order'), inputs: z.object({ approvalAgeDays: days.min(7).default(7), historyLimitDays: days.default(365) }).strict().default({ approvalAgeDays: 7, historyLimitDays: 365 }) }).strict(),
  z.object({ template: z.literal('repeat_buyers_inactive'), inputs: z.object({ minimumOrders: z.number().int().min(3).max(SEGMENT_LIMITS.maxCount).default(3), purchaseWindowDays: days.default(90), inactiveDays: days.default(14) }).strict().default({ minimumOrders: 3, purchaseWindowDays: 90, inactiveDays: 14 }) }).strict(),
]).superRefine((v, ctx) => {
  if (v.template === 'repeat_buyers_inactive' && v.inputs.inactiveDays > v.inputs.purchaseWindowDays) ctx.addIssue({ code: 'custom', message: 'Recent inactivity must fit inside the purchase window.', path: ['inputs', 'inactiveDays'] });
});

/** Internal template rule. The public guided preview response never exposes AST, SQL or parameters. */
export function guidedDefinition(raw: unknown): { template: typeof GUIDED_PREVIEWS[number]; definition: SegmentDefinition; inputs: Record<string, number> } {
  const p = request.parse(raw);
  const template = GUIDED_PREVIEWS.find(t => t.id === p.template)!;
  const eligible = { kind: 'profile', field: 'eligible', operator: 'eq', value: true } as const;
  const definition: SegmentDefinition = p.template === 'approved_without_order'
    ? { schemaVersion: 1, ruleVersion: 1, rule: { kind: 'and', children: [eligible,
      { kind: 'profile', field: 'approvedAt', operator: 'at_least_days_ago', value: p.inputs.approvalAgeDays },
      { kind: 'event_count', event: 'order_accepted', window: { kind: 'branch_lifetime', maxDays: p.inputs.historyLimitDays }, operator: 'eq', value: 0 }] } }
    : { schemaVersion: 1, ruleVersion: 1, rule: { kind: 'and', children: [eligible,
      { kind: 'event_count', event: 'order_accepted', window: { kind: 'last_days', days: p.inputs.purchaseWindowDays }, operator: 'gte', value: p.inputs.minimumOrders },
      { kind: 'event_count', event: 'order_accepted', window: { kind: 'last_days', days: p.inputs.inactiveDays }, operator: 'eq', value: 0 }] } };
  return { template, definition, inputs: p.inputs };
}
export interface GuidedFixturePreview { template: string; title: string; inputs: Record<string, number>; note: string; preview: FixtureSegmentPreview }
export async function previewGuidedFixture(executor: FixtureSegmentExecutor, raw: unknown, scope: FixtureScope, time: unknown): Promise<GuidedFixturePreview> {
  const p = guidedDefinition(raw);
  return { template: p.template.id, title: p.template.title, inputs: p.inputs, note: p.template.note, preview: await executor.evaluate(p.definition, scope, time) };
}
