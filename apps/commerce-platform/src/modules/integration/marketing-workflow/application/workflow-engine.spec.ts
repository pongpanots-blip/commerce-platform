import { WorkflowEngine } from './workflow-engine.service';
import type { EnrollmentRecord } from '../infrastructure/workflow.store';
import type { WorkflowStep } from '../domain/workflow.types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = '11111111-1111-4111-8111-111111111111';
const notify = (n: number, nextId: string | null): WorkflowStep => ({ id: id(n), type: 'action', action: { kind: 'notify', channels: ['push'], templateKey: 'custom_a' }, nextId });
const wait = (n: number, nextId: string | null): WorkflowStep => ({ id: id(n), type: 'wait', hours: 1, nextId });

function setup(steps: WorkflowStep[], over: { status?: string; exitOnGoal?: object | null; ordered?: boolean; cap?: object | null; members?: string[]; holdout?: number } = {}) {
  const wf = { id: 'wf1', name: 'W', status: over.status ?? 'active', entryStepId: steps[0]?.id ?? null, steps, schedule: null, cooldownDays: 0,
    holdoutPercent: over.holdout ?? 0, exitOnGoal: over.exitOnGoal ?? null, triggerType: 'first_login', triggerConfig: {} };
  const enrollments = new Map<string, EnrollmentRecord & { endReason?: string | null }>();
  const logs: { stepId: string; kind: string; status: string; meta: Record<string, unknown> }[] = [];
  const store = {
    insertEnrollment: jest.fn(async (i: { userId: string; occurrenceKey: string; entryStepId: string | null; holdout: boolean; test: boolean; skipWaits: boolean }) => {
      if ([...enrollments.values()].some((e) => e.userId === i.userId && e.occurrenceKey === i.occurrenceKey)) return null;
      const e: EnrollmentRecord = { id: `e${enrollments.size + 1}`, workflowId: 'wf1', userId: i.userId, occurrenceKey: i.occurrenceKey,
        status: i.holdout ? 'completed' : 'pending', currentStepId: i.holdout ? null : i.entryStepId, resumeAt: null, isHoldout: i.holdout,
        isTest: i.test, skipWaits: i.skipWaits, splitAssignments: {}, startedAt: new Date() };
      enrollments.set(e.id, e);
      return e.id;
    }),
    lockDue: jest.fn(async (_m: unknown, eid: string) => {
      const e = enrollments.get(eid);
      return e && ['pending', 'running'].includes(e.status) && (!e.resumeAt || e.resumeAt <= new Date()) ? { ...e } : null;
    }),
    workflow: jest.fn(async () => wf),
    park: jest.fn(async (_m: unknown, eid: string, stepId: string, resumeAt: Date) => { Object.assign(enrollments.get(eid)!, { status: 'running', currentStepId: stepId, resumeAt }); }),
    finish: jest.fn(async (_m: unknown, eid: string, status: string, reason: string | null) => { Object.assign(enrollments.get(eid)!, { status, endReason: reason, currentStepId: null }); }),
    saveSplit: jest.fn(async (_m: unknown, eid: string, a: Record<string, string>) => { Object.assign(enrollments.get(eid)!, { splitAssignments: a }); }),
    log: jest.fn(async (_m: unknown, _e: string, stepId: string, kind: string, status: string, meta: Record<string, unknown>) => { logs.push({ stepId, kind, status, meta }); }),
    hasCountedOrderSince: jest.fn(async () => !!over.ordered),
    countedOrderCount: jest.fn(async () => 2),
    notifiesQueuedToday: jest.fn(async () => 5),
    insertWebhookDelivery: jest.fn(async () => 'd1'),
    customerData: jest.fn(async () => ({ first_name: 'Nok' })),
    inCooldown: jest.fn(async () => false),
  };
  const events = { publish: jest.fn(async () => undefined) };
  const segments = { userMatchesSegment: jest.fn(async (sid: string) => (over.members ?? []).includes(sid)) };
  const queue = { step: jest.fn(), webhook: jest.fn(), trigger: jest.fn() };
  const settings = { get: jest.fn(async () => over.cap ?? null) };
  const db = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn({})), manager: {} };
  const engine = new WorkflowEngine(db as never, store as never, events as never, segments as never, queue as never, settings as never);
  const run = async (occurrence = 'once', opts = {}) => {
    const eid = await engine.enroll(wf as never, U, occurrence, opts);
    if (eid) await engine.process(eid);
    return eid!;
  };
  /** Make a parked enrollment due and run it again. */
  const resume = async (eid: string) => { enrollments.get(eid)!.resumeAt = new Date(0); await engine.process(eid); };
  return { engine, wf, store, events, segments, queue, logs, enrollments, run, resume };
}

describe('WorkflowEngine', () => {
  it('walks steps, publishes notify in the transaction, queues the webhook after commit', async () => {
    const steps: WorkflowStep[] = [notify(1, id(2)), { id: id(2), type: 'webhook', method: 'POST', url: 'https://h.co/{{user_first_name}}', headers: [], body: '{"n":"{{user_name}}"}', nextId: null }];
    const s = setup(steps);
    const eid = await s.run();
    expect(s.events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'marketing.notify', payload: expect.objectContaining({ dedupeKey: `cmw:wf1:${eid}:${id(1)}` }) }), {});
    expect(s.store.insertWebhookDelivery).toHaveBeenCalledWith({}, expect.objectContaining({ url: 'https://h.co/Nok', idempotencyKey: `cmw:${eid}:${id(2)}` }));
    expect(s.queue.webhook).toHaveBeenCalledWith('d1');
    expect(s.enrollments.get(eid)!.status).toBe('completed');
  });

  it('parks at a wait, then resumes from the next step', async () => {
    const s = setup([wait(1, id(2)), notify(2, null)]);
    const eid = await s.run();
    expect(s.enrollments.get(eid)).toMatchObject({ status: 'running', currentStepId: id(2) });
    expect(s.queue.step).toHaveBeenLastCalledWith(eid, 3_600_000);
    expect(s.events.publish).not.toHaveBeenCalled();
    await s.resume(eid);
    expect(s.events.publish).toHaveBeenCalledTimes(1);
    expect(s.enrollments.get(eid)!.status).toBe('completed');
  });

  it('skips waits on a test run that asks for it', async () => {
    const s = setup([wait(1, id(2)), notify(2, null)]);
    await s.run('test:1', { test: true, skipWaits: true });
    expect(s.events.publish).toHaveBeenCalledTimes(1);
  });

  it('follows condition yes / no', async () => {
    const cond = (expr: string): WorkflowStep[] => [{ id: id(1), type: 'condition', expression: expr, yesNextId: id(2), noNextId: id(3) }, notify(2, null), notify(3, null)];
    const yes = setup(cond('user.order_count >= 2'));
    await yes.run();
    expect(yes.logs.find((l) => l.kind === 'notify')!.stepId).toBe(id(2));
    const no = setup(cond('user.order_count > 5'));
    await no.run();
    expect(no.logs.find((l) => l.kind === 'notify')!.stepId).toBe(id(3));
  });

  it('keeps the A/B branch it picked across a wait', async () => {
    const steps: WorkflowStep[] = [{ id: id(1), type: 'split', branches: [{ id: 'a', label: 'A', percent: 50, nextId: id(2) }, { id: 'b', label: 'B', percent: 50, nextId: id(2) }] },
      wait(2, id(3)), notify(3, null)];
    const s = setup(steps);
    const eid = await s.run();
    const picked = s.enrollments.get(eid)!.splitAssignments[id(1)];
    expect(['a', 'b']).toContain(picked);
    expect(s.logs.find((l) => l.kind === 'split')!.meta).toMatchObject({ branchId: picked });
  });

  it('ends a cycle as failed', async () => {
    const s = setup([notify(1, id(2)), notify(2, id(1))]);
    const eid = await s.run();
    expect(s.enrollments.get(eid)).toMatchObject({ status: 'failed', endReason: 'cycle_detected' });
  });

  it('ends safely when the waited-for step was removed', async () => {
    const s = setup([wait(1, id(2)), notify(2, null)]);
    const eid = await s.run();
    s.wf.steps = s.wf.steps.slice(0, 1);
    await s.resume(eid);
    expect(s.enrollments.get(eid)).toMatchObject({ status: 'skipped', endReason: 'step_removed' });
  });

  it('ends a waiting enrollment when the workflow was paused', async () => {
    const s = setup([wait(1, id(2)), notify(2, null)]);
    const eid = await s.run();
    s.wf.status = 'paused';
    await s.resume(eid);
    expect(s.enrollments.get(eid)).toMatchObject({ status: 'skipped', endReason: 'workflow_paused' });
    expect(s.events.publish).not.toHaveBeenCalled();
  });

  it('stops when the goal is reached', async () => {
    const s = setup([notify(1, null)], { exitOnGoal: { kind: 'order_placed' }, ordered: true });
    const eid = await s.run();
    expect(s.enrollments.get(eid)).toMatchObject({ status: 'skipped', endReason: 'goal_reached' });
    expect(s.events.publish).not.toHaveBeenCalled();
  });

  it('stops before sending when the customer left the audience', async () => {
    const s = setup([{ id: id(1), type: 'audience', segmentIds: [id(9)], nextId: id(2) }, notify(2, null)], { members: [id(9)] });
    const eid = await s.engine.enroll(s.wf as never, U, 'once');
    s.segments.userMatchesSegment.mockResolvedValue(false);
    await s.engine.process(eid!);
    expect(s.enrollments.get(eid!)).toMatchObject({ status: 'skipped', endReason: 'audience_changed' });
  });

  it('frequency cap skips the notify but the flow goes on', async () => {
    const s = setup([notify(1, id(2)), { id: id(2), type: 'action', action: { kind: 'grant_coupon', couponId: U }, nextId: null }], { cap: { enabled: true, maxPerUserPerDay: 3 } });
    await s.run();
    expect(s.logs.map((l) => `${l.kind}:${l.status}`)).toEqual(['notify:skipped', 'grant_coupon:queued']);
    expect(s.events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'marketing.grant_coupon' }), {});
  });

  it('enroll: inactive, outside audience or duplicate → nothing', async () => {
    const paused = setup([notify(1, null)], { status: 'paused' });
    expect(await paused.engine.enroll(paused.wf as never, U, 'x')).toBeNull();
    const aud = setup([{ id: id(1), type: 'audience', segmentIds: [id(9)], nextId: null }]);
    expect(await aud.engine.enroll(aud.wf as never, U, 'once')).toBeNull();
    const dup = setup([notify(1, null)]);
    expect(await dup.engine.enroll(dup.wf as never, U, 'once')).not.toBeNull();
    expect(await dup.engine.enroll(dup.wf as never, U, 'once')).toBeNull();
  });

  it('enroll: holdout is recorded as completed and never queued', async () => {
    const s = setup([notify(1, null)], { holdout: 100 });
    const eid = await s.engine.enroll(s.wf as never, U, 'once');
    expect(s.enrollments.get(eid!)).toMatchObject({ status: 'completed', isHoldout: true });
    expect(s.queue.step).not.toHaveBeenCalled();
  });
});
