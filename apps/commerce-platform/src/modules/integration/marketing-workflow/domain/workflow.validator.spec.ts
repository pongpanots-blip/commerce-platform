import type { EventDefinition } from '@cp/marketing-workflow';
import type { EventContext } from './workflow.validator';
import type { WorkflowInput, WorkflowStep } from './workflow.types';
import { validateWorkflow } from './workflow.validator';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = (steps: WorkflowStep[], over: Partial<WorkflowInput> = {}): WorkflowInput => ({
  name: 'W', triggerType: 'first_login', triggerConfig: {}, entryStepId: steps[0]?.id ?? null, steps, graphUi: null,
  cooldownDays: 0, holdoutPercent: 0, conversionWindowDays: 7, exitOnGoal: null, schedule: null, ...over,
});
const notify = (n: number, nextId: string | null = null): WorkflowStep =>
  ({ id: id(n), type: 'action', action: { kind: 'notify', channels: ['push'], templateKey: 'custom_a' }, nextId });
const codes = (w: WorkflowInput) => validateWorkflow(w).map((i) => i.code);

describe('validateWorkflow', () => {
  it('accepts a minimal valid flow', () => expect(validateWorkflow(base([notify(1)]))).toEqual([]));
  it('needs an entry and real targets', () => {
    expect(codes(base([notify(1)], { entryStepId: null }))).toContain('no_entry');
    expect(codes(base([notify(1, id(9))]))).toContain('bad_next');
  });
  it('finds cycles', () => expect(codes(base([notify(1, id(2)), notify(2, id(1))]))).toContain('cycle'));
  it('checks split branches', () => {
    const split = (percents: number[]): WorkflowStep => ({ id: id(1), type: 'split', branches: percents.map((p, i) => ({ id: `b${i}`, label: `B${i}`, percent: p, nextId: null })) });
    expect(codes(base([split([50, 50])]))).toEqual([]);
    expect(codes(base([split([60, 50])]))).toContain('split_sum');
    expect(codes(base([split([100])]))).toContain('split_count');
    expect(codes(base([split([50.5, 49.5])]))).toContain('split_percent');
  });
  it('checks webhooks', () => {
    const wh = (over: object): WorkflowStep => ({ id: id(1), type: 'webhook', method: 'POST', url: 'https://h.co', headers: [], nextId: null, ...over } as WorkflowStep);
    expect(codes(base([wh({})]))).toEqual([]);
    expect(codes(base([wh({ url: 'ftp://h.co' })]))).toContain('webhook_url');
    expect(codes(base([wh({ headers: [{ key: 'Bad Key', value: 'x' }] })]))).toContain('webhook_header');
    expect(codes(base([wh({ headers: [{ key: 'A', value: 'x\r\ny' }] })]))).toContain('webhook_header');
    expect(codes(base([wh({ headers: [{ key: 'A', value: 'Bearer {{secret:x}}' }] })]))).toContain('webhook_secret_ref');
    expect(codes(base([wh({ method: 'GET', body: 'x' })]))).toContain('webhook_get_body');
    expect(codes(base([wh({ body: 'x'.repeat(16 * 1024 + 1) })]))).toContain('webhook_body');
  });
  it('limits waits and conditions and rejects phase-2 fields', () => {
    const waits = [1, 2, 3, 4].map((n) => ({ id: id(n), type: 'wait', hours: 1, nextId: n < 4 ? id(n + 1) : null }) as WorkflowStep);
    expect(codes(base(waits))).toContain('too_many_waits');
    const cond: WorkflowStep = { id: id(1), type: 'condition', expression: 'cart.total > 10', yesNextId: null, noNextId: null };
    expect(codes(base([cond]))).toContain('condition_expression');
  });
  it('checks trigger configs', () => {
    expect(codes(base([notify(1)], { triggerType: 'scheduled', triggerConfig: { time: '25:00' } }))).toContain('trigger_config');
    expect(codes(base([notify(1)], { triggerType: 'order_milestone', triggerConfig: { metric: 'lifetime_spend', operator: '>=', value: 1000 } }))).toEqual([]);
  });
});

const cart: EventDefinition = { name: 'add_to_cart', label: '', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [{ key: 'order_id', type: 'string', label: '' }, { key: 'price', type: 'number', label: '' }] };
const buy: EventDefinition = { ...cart, name: 'purchase' };
const ctx: EventContext = { catalog: new Map([[cart.name, cart], [buy.name, buy]]), coverageStart: new Date('2026-08-01T00:00:00Z'),
  segmentIds: new Set([id(50)]), segmentProblems: new Map([[id(50), []]]), now: new Date('2026-10-10T00:00:00Z') };
const eventTrigger = (over: object = {}): Partial<WorkflowInput> => ({ triggerType: 'event', triggerConfig: { eventName: 'add_to_cart', filters: [], includeGuests: false, ...over } as never });
const waitEvent = (n: number, over: object = {}): WorkflowStep => ({ id: id(n), type: 'wait_event', eventName: 'purchase', filters: [], timeoutHours: 2, matchedNextId: null, timeoutNextId: null, ...over } as WorkflowStep);
const ecodes = (w: WorkflowInput) => validateWorkflow(w, ctx).map((i) => i.code);

describe('validateWorkflow — event layer', () => {
  it('accepts add_to_cart → wait purchase (same order_id) → push', () => {
    const w = base([waitEvent(1, { filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }], timeoutNextId: id(2) }), notify(2)], eventTrigger());
    expect(validateWorkflow(w, ctx)).toEqual([]);
  });

  it('fromTrigger needs an event trigger and a matching attribute type', () => {
    expect(ecodes(base([waitEvent(1, { filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }] })]))).toContain('wait_event_filter');
    expect(ecodes(base([waitEvent(1, { filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'price' } }] })], eventTrigger()))).toContain('wait_event_filter');
  });

  it('checks the trigger, timeouts, unknown events and the combined wait / condition limits', () => {
    expect(codes(base([notify(1)], { triggerType: 'event', triggerConfig: {} as never }))).toContain('trigger_config');
    expect(codes(base([waitEvent(1, { timeoutHours: 0 })], eventTrigger()))).toContain('wait_event_timeout');
    expect(ecodes(base([waitEvent(1, { eventName: 'nope' })], eventTrigger()))).toContain('event_unknown');
    const chain = [1, 2, 3, 4].map((n) => (n % 2 ? waitEvent(n, { timeoutNextId: id(n + 1) }) : ({ id: id(n), type: 'wait', hours: 1, nextId: n < 4 ? id(n + 1) : null } as WorkflowStep)));
    expect(codes(base(chain, eventTrigger()))).toContain('too_many_waits');
  });

  it('guests: no audience, event condition or customer conditions', () => {
    const guests = eventTrigger({ includeGuests: true });
    expect(codes(base([{ id: id(1), type: 'audience', nextId: null }], guests))).toContain('guest_audience');
    expect(codes(base([{ id: id(1), type: 'condition', expression: 'still_no_order == true', yesNextId: null, noNextId: null }], guests))).toContain('guest_condition');
    expect(codes(base([{ id: id(1), type: 'condition', expression: 'time.hour >= 9', yesNextId: null, noNextId: null }], guests))).toEqual([]);
  });

  it('a coupon on an event trigger needs a cooldown', () => {
    const coupon: WorkflowStep = { id: id(1), type: 'action', action: { kind: 'grant_coupon', couponId: id(70) }, nextId: null };
    expect(codes(base([coupon], eventTrigger()))).toContain('event_coupon_cooldown');
    expect(codes(base([coupon], { ...eventTrigger(), cooldownDays: 1 }))).toEqual([]);
  });

  it('event rules in audience / event_split use the rule checks and dynamic segments must be clean', () => {
    const rule = { kind: 'event', name: 'add_to_cart', measure: 'count', op: 'eq', value: 0, window: { lastDays: 90 }, filters: [] } as never;
    expect(ecodes(base([{ id: id(1), type: 'event_split', rule, yesNextId: null, noNextId: null }]))).toEqual(['event_rule']); // 90 days > coverage
    const dirty: EventContext = { ...ctx, segmentProblems: new Map([[id(50), ['x']]]) };
    expect(validateWorkflow(base([{ id: id(1), type: 'audience', dynamicSegmentIds: [id(50)], nextId: null }]), dirty).map((i) => i.code)).toEqual(['dynamic_segment']);
  });
});
