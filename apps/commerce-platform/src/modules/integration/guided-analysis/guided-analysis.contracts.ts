import { z } from 'zod';
import { GUIDED_PREVIEWS, guidedDefinition } from '../analytics-foundation/guided-previews';
import type { FixtureSegmentPreview } from '../analytics-foundation/fixture-executor';

export const GUIDED_ANALYSIS_HOME = '/analysis/customer-behavior';
export const GUIDED_ANALYSIS_API = '/reports/guided-analysis';
export const guidedAnalysisRoles = ['admin', 'business_analyst'] as const;
export const guidedTemplateId = z.enum(['approved_without_order', 'repeat_buyers_inactive']);
const integer = (min: number, max: number) => z.union([
  z.number(), z.string().regex(/^\d+$/).transform(Number),
]).pipe(z.number().int().min(min).max(max));
export const guidedQuerySchema = z.discriminatedUnion('template', [
  z.strictObject({ template: z.literal('approved_without_order'), approvalAgeDays: integer(7, 365).default(7), historyLimitDays: integer(1, 365).default(365) }),
  z.strictObject({ template: z.literal('repeat_buyers_inactive'), minimumOrders: integer(3, 10000).default(3), purchaseWindowDays: integer(1, 365).default(90), inactiveDays: integer(1, 365).default(14) }),
]).refine(v => v.template !== 'repeat_buyers_inactive' || v.inactiveDays <= v.purchaseWindowDays, 'Recent inactivity must fit inside the purchase window.');
export type GuidedQuery = z.infer<typeof guidedQuerySchema>;
export function normalizeGuidedQuery(raw: unknown): GuidedQuery {
  const query = guidedQuerySchema.parse(raw);
  // Use the original template validator and AST semantics as the authority.
  const { inputs } = guidedDefinition({ template: query.template, inputs: Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'template')) });
  return guidedQuerySchema.parse({ template: query.template, ...inputs });
}
export function guidedSearch(query: GuidedQuery, includeTemplate = true) {
  return '?' + new URLSearchParams(Object.entries(query).filter(([key]) => includeTemplate || key !== 'template').map(([key, value]) => [key, String(value)])).toString();
}
export const guidedTemplatePath = (query: GuidedQuery, action?: 'preview' | 'evidence') =>
  `${GUIDED_ANALYSIS_HOME}/templates/${query.template}${action ? '/' + action : ''}${guidedSearch(query, false)}`;

export const missingContractIds = ['branch_approval_and_eligibility', 'branch_birth', 'canonical_order_acceptance', 'occurrence_identity', 'server_branch_grants', 'complete_history_watermarks', 'consent_and_retention', 'live_projection', 'daily_trends', 'personalization'] as const;
export const criterionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('eligible_branch') }),
  z.strictObject({ kind: z.literal('approval_age'), days: z.number().int().min(7).max(365) }),
  z.strictObject({ kind: z.literal('no_lifetime_order'), maxDays: z.number().int().min(1).max(365) }),
  z.strictObject({ kind: z.literal('confirmed_order_count'), minimum: z.number().int().min(3).max(10000), days: z.number().int().min(1).max(365) }),
  z.strictObject({ kind: z.literal('no_recent_order'), days: z.number().int().min(1).max(365) }),
]);
export type GuidedCriterion = z.infer<typeof criterionSchema>;
export function guidedCriteria(query: GuidedQuery): GuidedCriterion[] {
  return query.template === 'approved_without_order'
    ? [{ kind: 'eligible_branch' }, { kind: 'approval_age', days: query.approvalAgeDays }, { kind: 'no_lifetime_order', maxDays: query.historyLimitDays }]
    : [{ kind: 'eligible_branch' }, { kind: 'confirmed_order_count', minimum: query.minimumOrders, days: query.purchaseWindowDays }, { kind: 'no_recent_order', days: query.inactiveDays }];
}
const instant = z.iso.datetime();
const result = z.enum(['included', 'excluded', 'unknown']);
const condition = z.strictObject({ result, description: z.string().min(1).max(1000), observedCount: z.number().int().nonnegative().nullable().optional() });
const branch = z.strictObject({ branchId: z.string().min(1).max(128), companyId: z.string().min(1).max(128).nullable(), result, reasons: z.array(condition).min(1).max(32) });
const coverage = z.strictObject({ branchId: z.string().min(1).max(128), event: z.enum(['branch_selected', 'checkout_started', 'order_accepted']), completeFrom: instant, completeThrough: instant, assertedAt: instant, identityComplete: z.boolean() });
const template = z.strictObject({ id: guidedTemplateId, title: z.string(), inputs: z.array(z.strictObject({ key: z.string(), label: z.string(), default: z.number().int(), min: z.number().int(), max: z.number().int() })).min(2).max(3), note: z.string() });
export const guidedCatalogSchema = z.strictObject({ schemaVersion: z.literal(1), templates: z.array(template).max(2), mode: z.literal('live_unavailable'), missingContracts: z.array(z.enum(missingContractIds)).min(1), activationAllowed: z.literal(false), liveIntegrationComplete: z.literal(false), operationalWrites: z.literal(false) });
export type GuidedCatalog = z.infer<typeof guidedCatalogSchema>;
export function verifyGuidedCatalog(raw: unknown): GuidedCatalog {
  const catalog = guidedCatalogSchema.parse(raw);
  if (new Set(catalog.templates.map(t => t.id)).size !== catalog.templates.length || catalog.templates.some(t => JSON.stringify(t) !== JSON.stringify(GUIDED_PREVIEWS.find(original => original.id === t.id))) || catalog.missingContracts.length !== missingContractIds.length || new Set(catalog.missingContracts).size !== missingContractIds.length) throw Error('Template contract mismatch');
  return catalog;
}
export const guidedPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1), ruleVersion: z.literal(1), query: guidedQuerySchema,
  criteria: z.array(criterionSchema).length(3), scope: z.literal('branches'),
  capturedAt: instant, evaluatedAt: instant.nullable(), mode: z.enum(['live_unavailable', 'synthetic_fixture']),
  status: z.enum(['source_unavailable', 'evaluated']),
  counts: z.strictObject({ matched: z.number().int().nonnegative().nullable(), excluded: z.number().int().nonnegative().nullable(), unknown: z.number().int().nonnegative().nullable() }),
  branches: z.array(branch).max(100),
  source: z.strictObject({ kind: z.enum(['unavailable', 'synthetic_fixture']), coverageAssertions: z.array(coverage).max(300), profileAsOf: z.array(z.strictObject({ branchId: z.string().min(1).max(128), asOf: instant.nullable() })).max(100) }),
  missingContracts: z.array(z.enum(missingContractIds)).min(1),
  activationAllowed: z.literal(false), liveIntegrationComplete: z.literal(false), operationalWrites: z.literal(false),
});
export type GuidedPreview = z.infer<typeof guidedPreviewSchema>;
export function verifyGuidedPreview(raw: unknown, expected: GuidedQuery): GuidedPreview {
  const preview = guidedPreviewSchema.parse(raw), query = normalizeGuidedQuery(expected);
  if (guidedSearch(preview.query) !== guidedSearch(query) || JSON.stringify(preview.criteria) !== JSON.stringify(guidedCriteria(query))) throw Error('Returned criteria differ from the requested analysis');
  const ids = preview.branches.map(b => b.branchId);
  if (new Set(ids).size !== ids.length || new Set(preview.source.profileAsOf.map(p => p.branchId)).size !== preview.source.profileAsOf.length || new Set(preview.source.coverageAssertions.map(c => c.branchId + ':' + c.event)).size !== preview.source.coverageAssertions.length || preview.missingContracts.length !== missingContractIds.length || new Set(preview.missingContracts).size !== missingContractIds.length) throw Error('Duplicate or incomplete source evidence');
  if (preview.mode === 'live_unavailable') {
    if (preview.status !== 'source_unavailable' || preview.evaluatedAt !== null || Object.values(preview.counts).some(v => v !== null) || preview.branches.length || preview.source.kind !== 'unavailable' || preview.source.coverageAssertions.length || preview.source.profileAsOf.length) throw Error('Unavailable source cannot establish counts or membership');
  } else {
    if (preview.status !== 'evaluated' || !preview.evaluatedAt || preview.source.kind !== 'synthetic_fixture' || Object.values(preview.counts).some(v => v === null)) throw Error('Incomplete synthetic evaluation');
    for (const [key, membership] of [['matched', 'included'], ['excluded', 'excluded'], ['unknown', 'unknown']] as const) if (preview.counts[key] !== preview.branches.filter(b => b.result === membership).length) throw Error('Membership counts differ from branch evidence');
    if (preview.source.profileAsOf.length !== ids.length || preview.source.profileAsOf.some(p => !ids.includes(p.branchId) || (p.asOf && Date.parse(p.asOf) > Date.parse(preview.evaluatedAt!))) || preview.source.coverageAssertions.some(c => !ids.includes(c.branchId) || Date.parse(c.completeFrom) > Date.parse(c.completeThrough) || Date.parse(c.completeThrough) > Date.parse(c.assertedAt) || Date.parse(c.assertedAt) > Date.parse(preview.evaluatedAt!))) throw Error('Inconsistent source evidence');
  }
  return preview;
}
export function unavailableGuidedPreview(query: GuidedQuery, capturedAt = new Date().toISOString()): GuidedPreview {
  return verifyGuidedPreview({ schemaVersion: 1, ruleVersion: 1, query, criteria: guidedCriteria(query), scope: 'branches', capturedAt, evaluatedAt: null, mode: 'live_unavailable', status: 'source_unavailable', counts: { matched: null, excluded: null, unknown: null }, branches: [], source: { kind: 'unavailable', coverageAssertions: [], profileAsOf: [] }, missingContracts: [...missingContractIds], activationAllowed: false, liveIntegrationComplete: false, operationalWrites: false }, query);
}
export function fixtureGuidedPreview(query: GuidedQuery, value: FixtureSegmentPreview, capturedAt = new Date().toISOString()): GuidedPreview {
  return verifyGuidedPreview({ schemaVersion: value.schemaVersion, ruleVersion: value.ruleVersion, query, criteria: guidedCriteria(query), scope: 'branches', capturedAt, evaluatedAt: value.evaluatedAt, mode: value.mode, status: 'evaluated', counts: { matched: value.matchedCount, excluded: value.excludedCount, unknown: value.unknownCount }, branches: value.branches, source: { kind: value.dataFreshness.source, coverageAssertions: value.dataFreshness.coverageAssertions, profileAsOf: value.dataFreshness.profileAsOf }, missingContracts: [...missingContractIds], activationAllowed: value.activationAllowed, liveIntegrationComplete: value.liveIntegrationComplete, operationalWrites: false }, query);
}
