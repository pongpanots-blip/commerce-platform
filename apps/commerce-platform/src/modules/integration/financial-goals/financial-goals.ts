import { z } from 'zod';

export const GOAL_HOME = '/planning/profit-goals';
export const GOAL_API = '/reports/financial-goals';
export const goalRoles = ['admin', 'sales_manager', 'business_analyst'] as const;
export const canSaveGoal = (role: string) => role === 'admin';
export const goalUuid = z.uuid().transform(v => v.toLowerCase());
export const goalPeriod = z.string().regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/);
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
const percent = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/).refine(v => Number(v) <= 100);
const instant = z.iso.datetime({ offset: true });
export const goalMetric = z.enum(['gross_profit_ex_vat', 'gross_margin_percent', 'total_cost_ceiling_ex_vat', 'net_profit_ex_vat']);
export const goalScenarioSchema = z.object({ kind: z.literal('financial_goal'), name: z.string().trim().min(1).max(120), period: goalPeriod,
  metric: goalMetric, target: z.string(), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  hypothetical: z.object({ netSalesExVat: amount, internalCostExVat: amount, operatingExpensesExVat: amount, assumption: z.string().trim().min(1).max(300) }).strict().nullable(),
}).strict().superRefine((v, c) => {
  const valid = v.metric === 'gross_margin_percent' ? percent.safeParse(v.target) : amount.safeParse(v.target);
  if (!valid.success) c.addIssue({ code: 'custom', path: ['target'], message: 'Invalid target amount or percentage' });
});
export type GoalScenario = z.infer<typeof goalScenarioSchema>;
export function goalRange(raw: string) {
  const period = goalPeriod.parse(raw), [year, month] = period.split('-').map(Number);
  return { from: new Date(Date.UTC(year, month - 1, 1)).toISOString(), to: new Date(Date.UTC(year, month, 1) - 1).toISOString(), timezone: 'UTC' as const };
}
const unknownActuals = z.object({ netSalesExVat: z.null(), internalCostExVat: z.null(), operatingExpensesExVat: z.null(), grossProfitExVat: z.null(), grossMarginPercent: z.null(), totalCostExVat: z.null(), netProfitExVat: z.null(), achievementPercent: z.null() }).strict();
export const goalInputsSchema = z.object({ schemaVersion: z.literal(1), period: goalPeriod, capturedAt: instant, sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.literal('existing_winback_team_report'), source: z.enum(['copies', 'replica']), upstreamFreshness: z.literal('unverified'),
  range: z.object({ from: instant, to: instant, timezone: z.literal('UTC') }).strict(),
  context: z.object({ gmvIncVat: amount.nullable(), monthlyGmvTarget: amount.nullable(), targetSet: z.boolean().nullable(), coverage: z.enum(['available', 'unavailable']), reason: z.enum(['existing_gmv_context_only', 'source_unavailable', 'source_invalid']) }).strict(),
  actuals: unknownActuals, limitations: z.array(z.enum(['net_sales_ex_vat_unavailable', 'internal_cost_unavailable', 'operating_expenses_unavailable', 'catalog_and_report_freshness_unverified', 'gmv_is_not_profit_or_net_sales'])),
  operationalWrites: z.literal(false), activationAllowed: z.literal(false),
}).strict().superRefine((v, c) => {
  if (JSON.stringify(v.range) !== JSON.stringify(goalRange(v.period))) c.addIssue({ code: 'custom', message: 'Goal period identity mismatch' });
  const context = v.context, valid = context.coverage === 'available' ? context.reason === 'existing_gmv_context_only' && context.gmvIncVat !== null && context.targetSet !== null && (context.targetSet ? context.monthlyGmvTarget !== null : context.monthlyGmvTarget === null) : context.reason !== 'existing_gmv_context_only' && context.gmvIncVat === null && context.monthlyGmvTarget === null && context.targetSet === null;
  if (!valid) c.addIssue({ code: 'custom', path: ['context'], message: 'Inconsistent source coverage' });
});
export type GoalInputs = z.infer<typeof goalInputsSchema>;
const B = BigInt;
const cents = (v: string) => { const [whole, fraction = ''] = v.split('.'); return B(whole + fraction.padEnd(2, '0')); };
const money = (v: bigint) => { const negative = v < B(0), digits = (negative ? -v : v).toString().padStart(3, '0'); return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`; };
const scaled = (v: bigint, denominator: bigint, places: number) => {
  const negative = v < B(0), n = (negative ? -v : v) * B('1' + '0'.repeat(places));
  const rounded = (n * B(2) + denominator) / (denominator * B(2)), digits = rounded.toString().padStart(places + 1, '0');
  return `${negative && rounded !== B(0) ? '-' : ''}${digits.slice(0, -places)}.${digits.slice(-places)}`;
};
export function previewGoal(rawScenario: unknown, rawInputs: unknown) {
  const scenario = goalScenarioSchema.parse(rawScenario), inputs = goalInputsSchema.parse(rawInputs);
  if (scenario.period !== inputs.period || scenario.sourceFingerprint !== inputs.sourceFingerprint) throw Error('Goal source identity changed');
  const h = scenario.hypothetical;
  let hypothetical: { kind: 'hypothetical_only'; grossProfitExVat: string; grossMarginPercent: string | null; totalCostExVat: string; netProfitExVat: string; actualAchievementPercent: null } | null = null;
  if (h) {
    const revenue = cents(h.netSalesExVat), cost = cents(h.internalCostExVat), expenses = cents(h.operatingExpensesExVat), profit = revenue - cost;
    hypothetical = { kind: 'hypothetical_only', grossProfitExVat: money(profit), grossMarginPercent: revenue === B(0) ? null : scaled(profit * B(100), revenue, 4), totalCostExVat: money(cost + expenses), netProfitExVat: money(profit - expenses), actualAchievementPercent: null };
  }
  return { scenario, inputs, preview: { mode: 'review' as const, persisted: false as const, operationalWrites: false as const, activationAllowed: false as const,
    targetDirection: scenario.metric === 'total_cost_ceiling_ex_vat' ? 'at_most' as const : 'at_least' as const, targetUnit: scenario.metric === 'gross_margin_percent' ? 'percent' as const : 'THB_ex_vat' as const,
    actual: null, achievementPercent: null, hypothetical } };
}
const decimalResult = z.string().regex(/^-?\d+\.\d+$/);
const previewResult = z.object({ mode: z.literal('review'), persisted: z.literal(false), operationalWrites: z.literal(false), activationAllowed: z.literal(false), targetDirection: z.enum(['at_least', 'at_most']), targetUnit: z.enum(['percent', 'THB_ex_vat']), actual: z.null(), achievementPercent: z.null(),
  hypothetical: z.object({ kind: z.literal('hypothetical_only'), grossProfitExVat: decimalResult, grossMarginPercent: decimalResult.nullable(), totalCostExVat: decimalResult, netProfitExVat: decimalResult, actualAchievementPercent: z.null() }).strict().nullable() }).strict();
export const goalPreviewSchema = z.object({ scenario: goalScenarioSchema, inputs: goalInputsSchema, preview: previewResult }).superRefine((v, c) => {
  try { if (JSON.stringify(previewGoal(v.scenario, v.inputs).preview) !== JSON.stringify(v.preview)) c.addIssue({ code: 'custom', message: 'Invalid goal calculation' }); } catch { c.addIssue({ code: 'custom', message: 'Invalid goal source identity' }); }
});
export type GoalPreview = z.infer<typeof goalPreviewSchema>;
export const goalReceiptSchema = goalPreviewSchema.safeExtend({ id: goalUuid, revision: z.number().int().positive(), status: z.literal('draft'), saved: z.literal(true), persisted: z.literal(true), operationalWrites: z.literal(false), activationAllowed: z.literal(false), createdAt: instant, updatedAt: instant, replayed: z.boolean().optional() }).superRefine((v, c) => { if (Date.parse(v.updatedAt) < Date.parse(v.createdAt)) c.addIssue({ code: 'custom', message: 'Invalid saved goal time' }); });
export type GoalReceipt = z.infer<typeof goalReceiptSchema>;
export const goalDraftPageSchema = z.object({ items: z.array(goalReceiptSchema).max(20), next: goalUuid.nullable() }).superRefine((v, c) => {
  if (new Set(v.items.map(i => i.id)).size !== v.items.length || v.next !== null && v.next !== v.items[v.items.length - 1]?.id) c.addIssue({ code: 'custom', message: 'Invalid goal page' });
});
export const createGoalSchema = z.object({ requestId: goalUuid, scenario: goalScenarioSchema }).strict();
export const updateGoalSchema = createGoalSchema.extend({ revision: z.number().int().positive().max(2147483646) }).strict();
export function goalPreviewUrl(value: GoalScenario) {
  const bytes = new TextEncoder().encode(JSON.stringify(goalScenarioSchema.parse(value))); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); if (encoded.length > 7000) throw Error('Goal preview limit exceeded');
  return `${GOAL_API}/preview?scenario=${encoded}`;
}
