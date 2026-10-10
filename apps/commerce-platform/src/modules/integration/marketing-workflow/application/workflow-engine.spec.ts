import { WorkflowEngine } from './workflow-engine.service';
import type { EnrollmentRecord } from '../infrastructure/workflow.store';
import type { WorkflowStep } from '../domain/workflow.types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = '11111111-1111-4111-8111-111111111111';
const notify = (n: number, nextId: string | null): WorkflowStep => ({ id: id(n), type: 'action', action: { kind: 'notify', channels: ['push'], templateKey: 'custom_a' }, nextId });
const wait = (n: number, nextId: string | null): WorkflowStep => ({ id: id(n), type: 'wait', hours: 1, nextId });

function setup(steps: WorkflowStep[], over: { status?: string; exitOnGoal?: object | null; ordered?: boolean; cap?: object | null; members?: string[]; holdout?: number;
  triggerType?: string; triggerConfig?: object; events?: { attributes: Record<string, unknown> }[]; device?: object | null; guestPushes?: number; ruleMatches?: boolean } = {}) {
  const wf = { id: 'wf1', name: 'W', status: over.status ?? 'active', entryStepId: steps[0]?.id ?? null, steps, schedule: null, cooldownDays: 0,
    holdoutPercent: over.holdout ?? 0, exitOnGoal: over.exitOnGoal ?? null, triggerType: over.triggerType ?? 'first_login', triggerConfig: over.triggerConfig ?? {} };
  const enrollments = new Map<string, EnrollmentRecord & { endReason?: string | null }>();
  const logs: { stepId: string; kind: string; status: string; meta: Record<string, unknown> }[] = [];
  const store = {
    insertEnrollment: jest.fn(async (i: { userId: string | null; deviceId: string | null; occurrenceKey: string; entryStepId: string | null; holdout: boolean; test: boolean; skipWaits: boolean; triggerEvent?: EnrollmentRecord['triggerEvent'] }) => {
      if ([...enrollments.values()].some((e) => (e.userId ?? e.deviceId) === (i.userId ?? i.deviceId) && e.occurrenceKey === i.occurrenceKey)) return null;
      const e: EnrollmentRecord = { id: `e${enrollments.size + 1}`, workflowId: 'wf1', userId: i.userId, deviceId: i.deviceId, waitingFor: null, triggerEvent: i.triggerEvent ?? null, occurrenceKey: i.occurrenceKey,
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
    parkForEvent: jest.fn(async (_m: unknown, eid: string, stepId: string, waitingFor: unknown, resumeAt: Date) => {
      Object.assign(enrollments.get(eid)!, { status: 'running', currentStepId: stepId, resumeAt, waitingFor }); }),
    clearWait: jest.fn(async (_m: unknown, eid: string) => { Object.assign(enrollments.get(eid)!, { waitingFor: null }); }),
    lockWaiting: jest.fn(async (_m: unknown, eid: string, stepId: string) => {
      const e = enrollments.get(eid);
      return e && e.status === 'running' && e.currentStepId === stepId && e.waitingFor?.stepId === stepId ? { ...e } : null; }),
    moveAfterEvent: jest.fn(async (_m: unknown, eid: string, nextId: string | null) => {
      Object.assign(enrollments.get(eid)!, { currentStepId: nextId, waitingFor: null, resumeAt: null }); }),
    eventsSince: jest.fn(async () => over.events ?? []),
    devicePush: jest.fn(async () => over.device ?? null),
    guestPushesLast24h: jest.fn(async () => over.guestPushes ?? 0),
    logGuestPush: jest.fn(async () => undefined),
  };
  const events = { publish: jest.fn(async () => undefined) };
  const segments = { userMatchesSegment: jest.fn(async (sid: string) => (over.members ?? []).includes(sid)) };
  const queue = { step: jest.fn(), webhook: jest.fn(), trigger: jest.fn() };
  const settings = { get: jest.fn(async () => over.cap ?? null) };
  const db = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn({})), manager: {} };
  const rules = { matches: jest.fn(async () => !!over.ruleMatches), segmentMatches: jest.fn(async () => false), typesOf: jest.fn(async () => ({ order_id: 'string' })) };
  const engine = new WorkflowEngine(db as never, store as never, events as never, segments as never, queue as never, settings as never, rules as never);
  const run = async (occurrence = 'once', opts = {}, target: string | { userId: string | null; deviceId: string | null } = U) => {
    const eid = await engine.enroll(wf as never, target, occurrence, opts);
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
  describe('event layer', () => {
    const D = 'd'.repeat(32);
    const waitEvent = (n: number, matched: string | null, timeout: string | null): WorkflowStep =>
      ({ id: id(n), type: 'wait_event', eventName: 'purchase', filters: [], timeoutHours: 2, matchedNextId: matched, timeoutNextId: timeout } as WorkflowStep);

    it('Wait for event: parks on the step, an event moves it to the matched branch', async () => {
      const s = setup([waitEvent(1, id(2), id(3)), notify(2, null), notify(3, null)]);
      const eid = await s.run();
      expect(s.enrollments.get(eid)).toMatchObject({ status: 'running', currentStepId: id(1), waitingFor: { stepId: id(1), eventName: 'purchase' } });
      await s.engine.resumeFromEvent(eid, id(1), 'ev1');
      expect(s.queue.step).toHaveBeenLastCalledWith(eid);
      await s.engine.process(eid);
      expect(s.logs.map((l) => [l.stepId, l.kind, l.meta.matched ?? l.meta.templateKey])).toEqual([[id(1), 'wait_event', true], [id(2), 'notify', 'custom_a']]);
    });

    it('Wait for event: a timeout takes the timeout branch; an event after the timeout is ignored', async () => {
      const s = setup([waitEvent(1, id(2), id(3)), notify(2, null), notify(3, null)]);
      const eid = await s.run();
      await s.resume(eid);
      await s.engine.resumeFromEvent(eid, id(1), 'late');
      expect(s.logs.map((l) => [l.stepId, l.kind])).toEqual([[id(1), 'wait_event'], [id(3), 'notify']]);
      expect(s.logs[0].meta).toEqual({ matched: false });
    });

    it('event goal: a matching event since the start ends the journey', async () => {
      const s = setup([notify(1, null)], { exitOnGoal: { kind: 'event', eventName: 'purchase', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }] },
        events: [{ attributes: { order_id: 'O1' } }] });
      const eid = await s.run('ev-1', { triggerEvent: { eventId: 'ev-1', name: 'add_to_cart', attributes: { order_id: 'O1' } } });
      expect(s.enrollments.get(eid)?.endReason).toBe('goal_reached');
      const other = setup([notify(1, null)], { exitOnGoal: { kind: 'event', eventName: 'purchase', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }] },
        events: [{ attributes: { order_id: 'O2' } }] });
      const eid2 = await other.run('ev-1', { triggerEvent: { eventId: 'ev-1', name: 'add_to_cart', attributes: { order_id: 'O1' } } });
      expect(other.enrollments.get(eid2)?.status).toBe('completed');
    });

    it('event_split goes Yes when the rule matches', async () => {
      const split: WorkflowStep = { id: id(1), type: 'event_split', rule: { kind: 'segment', segmentId: id(9) }, yesNextId: id(2), noNextId: null } as WorkflowStep;
      const s = setup([split, notify(2, null)], { ruleMatches: true });
      await s.run();
      expect(s.logs.map((l) => l.kind)).toEqual(['event_split', 'notify']);
    });

    it('guest: push to the device with the event data, once per 24 h; coupon and email are skipped', async () => {
      const coupon: WorkflowStep = { id: id(2), type: 'action', action: { kind: 'grant_coupon', couponId: id(70) }, nextId: id(3) };
      const email: WorkflowStep = { id: id(3), type: 'action', action: { kind: 'notify', channels: ['email'], templateKey: 'custom_b' }, nextId: null };
      const s = setup([notify(1, id(2)), coupon, email], { triggerType: 'event', device: { pushSubscriptionId: '5b000000-0000-4000-8000-000000000001', platform: 'web' } });
      const trig = { eventId: 'ev-1', name: 'add_to_cart', attributes: { item_id: 'SKU-1' } };
      await s.run('ev-1', { triggerEvent: trig }, { userId: null, deviceId: D });
      expect(s.events.publish).toHaveBeenCalledTimes(1);
      const [event] = (s.events.publish.mock.calls[0] as unknown[]) as [{ aggregateId: string; payload: Record<string, unknown> }];
      expect(event.aggregateId).toBe(D);
      expect(event.payload).toMatchObject({ userId: null, channels: ['push'], target: { kind: 'device', subscriptionId: '5b000000-0000-4000-8000-000000000001', platform: 'web' },
        data: { event: { item_id: 'SKU-1' } } });
      expect(s.logs.map((l) => [l.kind, l.status, l.meta.reason ?? null])).toEqual([['notify', 'queued', null], ['grant_coupon', 'skipped', 'guest_no_user'], ['notify', 'skipped', 'guest_channel']]);
      const capped = setup([notify(1, null)], { triggerType: 'event', device: { pushSubscriptionId: '5b000000-0000-4000-8000-000000000001', platform: 'web' }, guestPushes: 1 });
      await capped.run('ev-2', { triggerEvent: trig }, { userId: null, deviceId: D });
      expect(capped.logs[0]).toMatchObject({ status: 'skipped', meta: { reason: 'guest_cap' } });
    });
  });
});
