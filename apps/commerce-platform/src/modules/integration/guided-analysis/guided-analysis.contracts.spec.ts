import { GUIDED_PREVIEWS, guidedDefinition } from '../analytics-foundation/guided-previews';
import type { FixtureSegmentPreview } from '../analytics-foundation/fixture-executor';
import { fixtureGuidedPreview, guidedCriteria, guidedSearch, normalizeGuidedQuery, unavailableGuidedPreview, verifyGuidedCatalog, verifyGuidedPreview } from './guided-analysis.contracts';
import { GuidedAnalysisService } from './guided-analysis.service';

const at = '2026-10-09T00:00:00.000Z', readAt = '2026-10-10T00:00:00.000Z';
const staff = { userId: 'analyst_a', role: 'business_analyst' as const, email: 'fixture@example.invalid' };
const query = normalizeGuidedQuery({ template: 'repeat_buyers_inactive' });
function fixture(result: 'included' | 'excluded' | 'unknown' = 'unknown'): FixtureSegmentPreview {
  return { schemaVersion: 1, ruleVersion: 1, evaluatedAt: at, mode: 'synthetic_fixture', matchedCount: result === 'included' ? 1 : 0, excludedCount: result === 'excluded' ? 1 : 0, unknownCount: result === 'unknown' ? 1 : 0,
    branches: [{ branchId: 'branch_fixture', companyId: 'company_fixture', result, reasons: [{ result, description: 'Synthetic evidence only', observedCount: result === 'unknown' ? null : 0 }] }],
    dataFreshness: { source: 'synthetic_fixture', coverageAssertions: [], profileAsOf: [{ branchId: 'branch_fixture', asOf: at }], note: 'Synthetic only' }, activationAllowed: false, liveIntegrationComplete: false };
}
describe('guided analysis: existing bounded semantics and explicit source gates', () => {
  it.each(GUIDED_PREVIEWS)('uses the original defaults, validation and AST for $id', template => {
    const q = normalizeGuidedQuery({ template: template.id });
    expect(Object.fromEntries(Object.entries(q).filter(([key]) => key !== 'template'))).toEqual(guidedDefinition({ template: template.id }).inputs);
    expect(guidedCriteria(q)).toHaveLength(3);
    expect(guidedSearch(q)).toContain('template=' + template.id);
  });
  it('normalizes typed GET strings without accepting scope, time or SQL overrides', () => {
    expect(normalizeGuidedQuery({ template: 'repeat_buyers_inactive', minimumOrders: '4', purchaseWindowDays: '30', inactiveDays: '7' })).toEqual({ template: 'repeat_buyers_inactive', minimumOrders: 4, purchaseWindowDays: 30, inactiveDays: 7 });
  });
  it.each([
    { template: 'unknown' }, { template: 'approved_without_order', approvalAgeDays: 6 }, { template: 'approved_without_order', historyLimitDays: 366 },
    { template: 'repeat_buyers_inactive', minimumOrders: 2 }, { template: 'repeat_buyers_inactive', minimumOrders: 10001 },
    { template: 'repeat_buyers_inactive', purchaseWindowDays: 7, inactiveDays: 14 }, { template: 'repeat_buyers_inactive', inactiveDays: 0 },
    { template: 'repeat_buyers_inactive', inactiveDays: 1.5 }, { template: 'repeat_buyers_inactive', inactiveDays: Infinity },
    { template: 'repeat_buyers_inactive', inactiveDays: true }, { template: 'repeat_buyers_inactive', inactiveDays: ['7', '14'] },
    { template: 'repeat_buyers_inactive', inactiveDays: '' }, { template: 'repeat_buyers_inactive', inactiveDays: '1e2' },
    { template: 'repeat_buyers_inactive', tenantId: 'other' }, { template: 'repeat_buyers_inactive', branchIds: ['other'] },
    { template: 'repeat_buyers_inactive', evaluatedAt: at }, { template: 'repeat_buyers_inactive', sql: 'SELECT 1' },
  ])('rejects invalid or scope-overriding input %j', raw => expect(() => normalizeGuidedQuery(raw)).toThrow());
  it('default live unavailability never becomes zero, freshness or membership evidence', async () => {
    const service = new GuidedAnalysisService(), r = await service.preview(query, staff);
    expect(r).toMatchObject({ mode: 'live_unavailable', evaluatedAt: null, counts: { matched: null, excluded: null, unknown: null }, branches: [], operationalWrites: false, activationAllowed: false, liveIntegrationComplete: false });
    expect(r.missingContracts).toContain('branch_approval_and_eligibility');
    expect(r.missingContracts).toContain('daily_trends');
    expect(r.missingContracts).toContain('personalization');
    expect(r.source.coverageAssertions).toEqual([]);
  });
  it('catalog cannot silently alter the original template policy', () => {
    const catalog = new GuidedAnalysisService().catalog();
    expect(catalog.templates).toEqual(GUIDED_PREVIEWS);
    const changed = JSON.parse(JSON.stringify(catalog)); changed.templates[1].inputs[0].min = 1;
    expect(() => verifyGuidedCatalog(changed)).toThrow('Template contract mismatch');
  });
  it.each(['included', 'excluded', 'unknown'] as const)('keeps synthetic %s evidence and read time distinct', result => {
    const r = fixtureGuidedPreview(query, fixture(result), readAt);
    expect(r.branches[0].result).toBe(result);
    expect(r.capturedAt).toBe(readAt); expect(r.evaluatedAt).toBe(at);
    expect(r.counts.unknown).toBe(result === 'unknown' ? 1 : 0);
    expect(r.branches[0].reasons[0].observedCount).toBe(result === 'unknown' ? null : 0);
  });
  it('supports a genuinely empty authorized synthetic scope without claiming a live audience', () => {
    const f = fixture(); f.branches = []; f.unknownCount = 0; f.dataFreshness.profileAsOf = [];
    expect(fixtureGuidedPreview(query, f).counts).toEqual({ matched: 0, excluded: 0, unknown: 0 });
  });
  it.each(['count', 'criterion', 'query', 'live-zero', 'freshness', 'activation', 'duplicate'])('rejects inconsistent %s responses', change => {
    const r = JSON.parse(JSON.stringify(change === 'live-zero' ? unavailableGuidedPreview(query) : fixtureGuidedPreview(query, fixture())));
    if (change === 'count') r.counts.unknown = 0;
    if (change === 'criterion') r.criteria[1].minimum = 4;
    if (change === 'query') r.query.inactiveDays = 7;
    if (change === 'live-zero') r.counts.matched = 0;
    if (change === 'freshness') r.source.profileAsOf[0].asOf = readAt;
    if (change === 'activation') r.activationAllowed = true;
    if (change === 'duplicate') { r.branches.push(r.branches[0]); r.counts.unknown++; }
    expect(() => verifyGuidedPreview(r, query)).toThrow();
  });
  it('injects the exact native definition and server actor into an owned test adapter only', async () => {
    const evaluate = jest.fn(async () => fixture()), service = new GuidedAnalysisService({ purpose: 'owned_local_fixture', evaluate });
    await service.preview(query, staff);
    expect(evaluate).toHaveBeenCalledWith(guidedDefinition({ template: query.template }).definition, staff);
    const previous = process.env.NODE_ENV;
    try { process.env.NODE_ENV = 'production'; await expect(service.preview(query, staff)).rejects.toThrow('not configured'); }
    finally { process.env.NODE_ENV = previous; }
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
  it('invalid inputs fail before source evaluation; source failure is retryable read failure', async () => {
    const evaluate = jest.fn(async () => { throw Error('private SQL detail'); }), service = new GuidedAnalysisService({ purpose: 'owned_local_fixture', evaluate });
    await expect(service.preview({ ...query, actor: 'other' }, staff)).rejects.toThrow('supported template');
    expect(evaluate).not.toHaveBeenCalled();
    await expect(service.preview(query, staff)).rejects.toThrow('Synthetic analysis evidence unavailable');
  });
});
