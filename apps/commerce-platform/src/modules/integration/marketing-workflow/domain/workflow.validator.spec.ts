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
