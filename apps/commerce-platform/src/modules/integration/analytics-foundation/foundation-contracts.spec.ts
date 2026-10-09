import { DataSource } from 'typeorm';
import { deduplicateFixtureEvents, parseFoundationEvent } from './event-contracts';
import { compileFixtureSegment } from './segment-compiler';
import { FixtureScope, validateSegment } from './segment-contracts';
import { FixtureSegmentExecutor } from './fixture-executor';
import { guidedDefinition, GUIDED_PREVIEWS } from './guided-previews';
import { FIXTURE_EVALUATED_AT, fixtureEvent, FIXTURE_GRANTS, syntheticDataset, validateFixtureDataset } from './synthetic-fixtures';

const profile = { kind: 'profile', field: 'eligible', operator: 'eq', value: true };
const definition = (rule: unknown = profile) => ({ schemaVersion: 1, ruleVersion: 4, rule });
const scope = () => FixtureScope.authorize('analyst_a', FIXTURE_GRANTS);
describe('versioned occurrence contracts and immutable synthetic identity', () => {
  it.each(['branch_selected', 'checkout_started', 'order_accepted'] as const)('validates %s without free-form payload or personal fields', name => {
    const e = fixtureEvent(1, 'repeat_inactive', 20, { name, acceptanceBasis: name === 'order_accepted' ? 'synthetic_confirmation' : null });
    expect(parseFoundationEvent(e)).toEqual(e);
    expect(() => parseFoundationEvent({ ...e, email: 'private@example.invalid' })).toThrow();
    expect(() => parseFoundationEvent({ ...e, context: { ...e.context, deviceId: 'shared-device' } })).toThrow();
  });
  it.each([
    { schemaVersion: 2 }, { name: 'account_application_approved' }, { source: 'shop_browser' },
    { source: 'synthetic_fixture', environment: 'production' }, { acceptanceBasis: null },
    { receivedAt: '2026-01-01T00:00:00Z' }, { occurredAt: '2026-10-09' },
  ])('rejects unsupported or unverified acceptance input %j', change => expect(() => parseFoundationEvent({ ...fixtureEvent(1, null, 20), ...change })).toThrow());
  it('requires a canonical order ID and distinguishes confirmed server evidence from attempts', () => {
    const e = fixtureEvent(1, null, 20);
    expect(() => parseFoundationEvent({ ...e, context: { ...e.context, orderId: null } })).toThrow();
    expect(parseFoundationEvent({ ...e, source: 'commerce_server', environment: 'development', acceptanceBasis: 'committed_confirmation' }).context.branchId).toBeNull();
    expect(() => parseFoundationEvent({ ...e, name: 'checkout_started' })).toThrow();
  });
  it('keeps event-time customer and staff identities separate and chooses first receipt on replay', () => {
    const e = fixtureEvent(1, 'repeat_inactive', 20);
    e.context = { ...e.context, actorKind: 'staff', actorUserId: 'staff_one', subjectUserId: 'customer_two' };
    const replay = { ...e, receivedAt: FIXTURE_EVALUATED_AT };
    expect(deduplicateFixtureEvents([replay, e])).toEqual([e]);
    expect(() => deduplicateFixtureEvents([e, { ...replay, context: { ...e.context, subjectUserId: 'customer_three' } }])).toThrow('Conflicting event ID');
  });
  it('normalizes equivalent timezone instants and rejects conflicting order context', () => {
    const e = fixtureEvent(1, 'repeat_inactive', 20);
    expect(parseFoundationEvent({ ...e, occurredAt: e.occurredAt.replace('00:00:00.000Z', '07:00:00+07:00') }).occurredAt).toBe(e.occurredAt);
    expect(() => deduplicateFixtureEvents([e, { ...e, eventId: fixtureEvent(2, null, 0).eventId, context: { ...e.context, branchId: 'recent_buyer' } }])).toThrow('Conflicting accepted-order');
  });
  it('rejects conflicting branch/company mapping, duplicates and nonsynthetic fixture data', () => {
    const d = syntheticDataset();
    expect(() => validateFixtureDataset({ ...d, branches: [...d.branches, d.branches[0]] })).toThrow('Duplicate fixture');
    expect(() => validateFixtureDataset({ ...d, events: [{ ...d.events[0], context: { ...d.events[0].context, companyId: 'other_company' } }] })).toThrow('identity conflict');
    expect(() => deduplicateFixtureEvents([{ ...d.events[0], source: 'commerce_server', environment: 'production', acceptanceBasis: 'committed_confirmation' }])).toThrow('must be synthetic');
  });
});
describe('bounded typed validation and parameterized compilation', () => {
  it('compiles allowed AND/OR/NOT rules while scope comes from separate authority', () => {
    const raw = definition({ kind: 'and', children: [profile, { kind: 'not', child: { kind: 'or', children: [{ kind: 'profile', field: 'region', operator: 'ne', value: 'bangkok' }] } }] });
    const p = compileFixtureSegment(raw, scope(), FIXTURE_EVALUATED_AT);
    expect(p.definition.ruleVersion).toBe(4); expect(p.values.slice(0, 3)).toEqual(['tenant_a', [...scope().branchIds], FIXTURE_EVALUATED_AT]);
    expect(p.text).toContain('b.tenant_id=$1::text AND b.branch_id=ANY($2::text[])');
    expect(p.text).not.toContain('bangkok'); expect(p.values).toContain('bangkok'); expect(p.text).toContain('NOT');
  });
  it.each([
    { kind: 'profile', field: 'email', operator: 'eq', value: 'x' },
    { ...profile, operator: 'sql', value: 'true' }, { ...profile, value: 'true' },
    { kind: 'event_count', event: 'purchase', window: { kind: 'last_days', days: 90 }, operator: 'gte', value: 3 },
    { kind: 'event_count', event: 'order_accepted', window: { kind: 'last_days', days: 366 }, operator: 'eq', value: 0 },
    { kind: 'event_count', event: 'order_accepted', window: { kind: 'last_days', days: 0 }, operator: 'eq', value: 0 },
    { kind: 'event_count', event: 'order_accepted', window: { kind: 'last_days', days: 90 }, operator: 'eq', value: -1 },
    { kind: 'event_count', event: 'order_accepted', window: { kind: 'last_days', days: 90 }, operator: 'eq', value: 0.5 },
    { kind: 'not', child: profile, tenantId: 'other' }, { kind: 'and', children: [] },
  ])('rejects invalid rule %j', rule => expect(() => validateSegment(definition(rule))).toThrow());
  it.each([{ ...definition(), tenantId: 'tenant_b' }, { ...definition(), branchIds: ['other'] }, { ...definition(), schemaVersion: 2 }, { ...definition(), ruleVersion: 0 }])('rejects definition override %j', d => expect(() => validateSegment(d)).toThrow());
  it('rejects depth/width/node explosions and invalid evaluation time before any query', () => {
    let deep: unknown = profile; for (let i = 0; i < 7; i++) deep = { kind: 'not', child: deep };
    expect(() => validateSegment(definition(deep))).toThrow('complexity');
    expect(() => validateSegment(definition({ kind: 'or', children: Array(9).fill(profile) }))).toThrow();
    expect(() => validateSegment(definition({ kind: 'and', children: Array(8).fill({ kind: 'and', children: Array(8).fill(profile) }) }))).toThrow('complexity');
    expect(() => compileFixtureSegment(definition(), scope(), 'now')).toThrow();
  });
  it('cannot accept JSON as authorized scope, modify a scope, or resolve an unknown principal', () => {
    expect(() => compileFixtureSegment(definition(), { tenantId: 'tenant_a', branchIds: ['other'] } as unknown as FixtureScope, FIXTURE_EVALUATED_AT)).toThrow('separately authorized');
    expect(() => FixtureScope.authorize('untrusted', FIXTURE_GRANTS)).toThrow('not authorized');
    expect(Object.isFrozen(scope())).toBe(true); expect(Object.isFrozen(scope().branchIds)).toBe(true);
    const many = new Map([['x', { tenantId: 't', branchIds: Array.from({ length: 101 }, (_, i) => `b_${i}`) }]]);
    expect(() => FixtureScope.authorize('x', many)).toThrow('Invalid fixture branch');
  });
  it('parameterizes injection payloads and counts canonical accepted orders, never checkout IDs', () => {
    const payload = "x' OR TRUE; DROP TABLE ba_fixture_events; --";
    const p = compileFixtureSegment(definition({ kind: 'profile', field: 'region', operator: 'eq', value: payload }), scope(), FIXTURE_EVALUATED_AT);
    expect(p.text).not.toContain(payload); expect(p.values).toContain(payload);
    const q = compileFixtureSegment(guidedDefinition({ template: 'repeat_buyers_inactive' }).definition, scope(), FIXTURE_EVALUATED_AT);
    expect(q.text).toContain('count(DISTINCT e.order_id)'); expect(q.text).toContain('e.company_id=b.company_id'); expect(q.text).not.toContain('subject_user');
  });
  it.each(['postgres://u:p@production.invalid/commerce_analytics_foundation_test', 'postgres://u:p@127.0.0.1/commerce_preview_test', 'postgres://u:p@127.0.0.1/commerce_analytics_foundation_test?host=remote'])('refuses connection %s without connecting', url => {
    expect(() => new FixtureSegmentExecutor(new DataSource({ type: 'postgres', url }))).toThrow();
  });
  it('rejects driver connection overrides', () => {
    const url = 'postgres://u:p@127.0.0.1/commerce_analytics_foundation_test';
    expect(() => new FixtureSegmentExecutor(new DataSource({ type: 'postgres', url, host: 'remote' }))).toThrow();
    expect(() => new FixtureSegmentExecutor(new DataSource({ type: 'postgres', url, extra: { connectionString: 'remote' } }))).toThrow();
  });
});
describe('guided inputs', () => {
  it('uses two and three plain-language inputs with safe defaults', () => {
    expect(GUIDED_PREVIEWS.map(t => t.inputs.length)).toEqual([2, 3]);
    expect(guidedDefinition({ template: 'approved_without_order' }).inputs).toEqual({ approvalAgeDays: 7, historyLimitDays: 365 });
    expect(guidedDefinition({ template: 'repeat_buyers_inactive' }).inputs).toEqual({ minimumOrders: 3, purchaseWindowDays: 90, inactiveDays: 14 });
  });
  it.each([
    { template: 'repeat_buyers_inactive', inputs: { purchaseWindowDays: 7, inactiveDays: 14 } },
    { template: 'repeat_buyers_inactive', inputs: { minimumOrders: 0 } },
    { template: 'repeat_buyers_inactive', inputs: { minimumOrders: 2 } },
    { template: 'approved_without_order', inputs: { approvalAgeDays: 0 } },
    { template: 'approved_without_order', inputs: { approvalAgeDays: 6 } },
    { template: 'approved_without_order', inputs: { sql: 'SELECT 1' } },
    { template: 'approved_without_order', tenantId: 'tenant_b' },
  ])('rejects invalid or scope-overriding input %j', raw => expect(() => guidedDefinition(raw)).toThrow());
});
