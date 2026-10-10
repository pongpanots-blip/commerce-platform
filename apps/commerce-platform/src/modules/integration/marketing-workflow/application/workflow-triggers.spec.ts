import { WorkflowTriggers } from './workflow-triggers.service';

const U = '11111111-1111-4111-8111-111111111111';
const activated = new Date('2026-10-10T03:00:00Z');
/** "Now" for the snapshot-driven tests: shortly after the events below. */
const T = new Date('2026-10-10T06:20:00Z');
const wf = (triggerType: string, triggerConfig: object = {}, over: object = {}) => ({ id: `wf-${triggerType}`, triggerType, triggerConfig, activatedAt: activated, lastScheduledKey: null, ...over });

function setup(workflows: ReturnType<typeof wf>[], times: { first?: Date | null; last?: Date | null } = {}, crossed = false,
  events: object[] = [], waits: object[] = [], goals: object[] = [], device: object | null = null) {
  const store = {
    activeWorkflows: jest.fn(async (types: string[]) => workflows.filter((w) => types.includes(w.triggerType))),
    customerTime: jest.fn(async (_u: string, f: string) => (f === 'first_app_login_at' ? times.first ?? null : times.last ?? null)),
    milestoneCrossed: jest.fn(async () => crossed),
    markConverted: jest.fn(async () => undefined),
    customerIdsAfter: jest.fn(async (after: string | null) => (after ? [] : [U, '22222222-2222-4222-8222-222222222222'])),
    setLastScheduledKey: jest.fn(async () => undefined),
    eventsByIds: jest.fn(async () => events),
    waitingFor: jest.fn(async () => waits),
    eventGoalCandidates: jest.fn(async () => goals),
    markConvertedAt: jest.fn(async () => undefined),
    devicePush: jest.fn(async () => device),
    manager: {},
  };
  const engine = { enroll: jest.fn(async (..._a: unknown[]) => 'e1'), resumeFromEvent: jest.fn(async (..._a: unknown[]) => undefined) };
  const rules = { typesOf: jest.fn(async () => ({ order_id: 'string', price: 'number' })) };
  return { t: new WorkflowTriggers(store as never, engine as never, rules as never), store, engine };
}

describe('WorkflowTriggers', () => {
  it('first_login: only logins at/after activation, always the same occurrence', async () => {
    const before = setup([wf('first_login')], { first: new Date('2026-10-01T00:00:00Z') });
    await before.t.handle('customer', U, T);
    expect(before.engine.enroll).not.toHaveBeenCalled();
    const after = setup([wf('first_login')], { first: new Date('2026-10-10T06:00:00Z') });
    await after.t.handle('customer', U, T);
    await after.t.handle('customer', U, T);
    expect(after.engine.enroll.mock.calls.map((c: unknown[]) => c[2])).toEqual(['once', 'once']);
  });

  it('app_login: one occurrence per login timestamp', async () => {
    const s = setup([wf('app_login')], { last: new Date('2026-10-10T06:00:00Z') });
    await s.t.handle('customer', U, T);
    expect(s.engine.enroll).toHaveBeenCalledWith(expect.anything(), U, '2026-10-10T06:00:00.000Z');
    const old = setup([wf('app_login')], { last: new Date('2026-10-09T06:00:00Z') });
    await old.t.handle('customer', U, T);
    expect(old.engine.enroll).not.toHaveBeenCalled();
  });

  it('a workflow never activated enrolls nobody', async () => {
    const s = setup([wf('first_login', {}, { activatedAt: null })], { first: new Date('2026-10-10T05:00:00Z') });
    await s.t.handle('customer', U, T);
    expect(s.engine.enroll).not.toHaveBeenCalled();
  });

  it('order: marks conversions, then enrolls milestone workflows that crossed after activation', async () => {
    const cfg = { metric: 'lifetime_spend', operator: '>=', value: 1000 };
    const s = setup([wf('order_milestone', cfg)], {}, true);
    await s.t.handle('order', U, T);
    expect(s.store.markConverted).toHaveBeenCalledWith(U);
    expect(s.store.milestoneCrossed).toHaveBeenCalledWith(U, cfg, new Date('2026-10-10T05:20:00Z')); // max(activated_at, now - 60 min)
    expect(s.engine.enroll).toHaveBeenCalledWith(expect.anything(), U, 'once');
    const no = setup([wf('order_milestone', cfg)], {}, false);
    await no.t.handle('order', U, T);
    expect(no.engine.enroll).not.toHaveBeenCalled();
  });

  it('only a recent event counts: a login or order the trigger could not enroll back then never enrolls days later', async () => {
    const now = new Date('2026-10-12T09:00:00Z');
    const login = setup([wf('first_login'), wf('app_login')], { first: new Date('2026-10-10T05:00:00Z'), last: new Date('2026-10-10T06:00:00Z') });
    await login.t.handle('customer', U, now); // a profile edit two days after the login
    expect(login.engine.enroll).not.toHaveBeenCalled();
    const fresh = setup([wf('app_login')], { last: new Date('2026-10-12T08:50:00Z') });
    await fresh.t.handle('customer', U, now);
    expect(fresh.engine.enroll).toHaveBeenCalledWith(expect.anything(), U, '2026-10-12T08:50:00.000Z');
    const cfg = { metric: 'lifetime_spend', operator: '>=', value: 1000 };
    const order = setup([wf('order_milestone', cfg)], {}, true);
    await order.t.handle('order', U, now);
    expect(order.store.milestoneCrossed).toHaveBeenCalledWith(U, cfg, new Date('2026-10-12T08:00:00Z')); // crossed within the last hour
  });

  it('scheduled: when due, enrolls every customer once for the local day and records it', async () => {
    const now = new Date('2026-10-10T11:05:00Z'); // 18:05 Bangkok
    const s = setup([wf('scheduled', { time: '18:00' })]);
    await s.t.runScheduled(now);
    expect(s.engine.enroll).toHaveBeenCalledTimes(2);
    expect(s.engine.enroll.mock.calls[0][2]).toBe('2026-10-10');
    expect(s.store.setLastScheduledKey).toHaveBeenCalledWith('wf-scheduled', '2026-10-10');
  });

  it('scheduled: not due, or already done today → nothing', async () => {
    const early = setup([wf('scheduled', { time: '20:00' })]);
    await early.t.runScheduled(new Date('2026-10-10T11:05:00Z'));
    const done = setup([wf('scheduled', { time: '18:00' }, { lastScheduledKey: '2026-10-10' })]);
    await done.t.runScheduled(new Date('2026-10-10T11:05:00Z'));
    expect(early.engine.enroll).not.toHaveBeenCalled();
    expect(done.engine.enroll).not.toHaveBeenCalled();
  });
  describe('event triggers (spec §7)', () => {
    const D = 'd'.repeat(32);
    const ev = (over: object = {}) => ({ eventId: 'ev-1', deviceId: D, name: 'add_to_cart', attributes: { price: 600, order_id: 'O1' },
      occurredAt: '2026-10-10T06:10:00.000Z', attributedUserId: U, attribution: 'device_link', actorKind: 'customer', ...over });
    const eventWf = (cfg: object = {}) => wf('event', { eventName: 'add_to_cart', filters: [{ key: 'price', op: 'gte', value: 500 }], includeGuests: false, ...cfg });

    it('enrolls once per event id with the trigger event, only for matching recent events after activation', async () => {
      const s = setup([eventWf()], {}, false, [ev()]);
      await s.t.handleEvents(['ev-1'], T);
      expect(s.engine.enroll).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-event' }), { userId: U, deviceId: null }, 'ev-1',
        { triggerEvent: { eventId: 'ev-1', name: 'add_to_cart', attributes: { price: 600, order_id: 'O1' } } });
      for (const over of [{ attributes: { price: 100 } }, { occurredAt: '2026-10-10T05:00:00.000Z' }, { occurredAt: '2026-10-10T02:59:00.000Z' }, { name: 'view_item' }]) {
        const n = setup([eventWf()], {}, false, [ev(over)]);
        await n.t.handleEvents(['ev-1'], T);
        expect(n.engine.enroll).not.toHaveBeenCalled();
      }
    });

    it('skips staff and no-consent events entirely; guests only when the workflow includes guests and the device takes push', async () => {
      for (const over of [{ attribution: 'staff', attributedUserId: null }, { attribution: 'no_consent', attributedUserId: null }]) {
        const s = setup([eventWf({ includeGuests: true })], {}, false, [ev(over)], [{ id: 'e9', waitingFor: { stepId: 's', eventName: 'add_to_cart', filters: [], since: '' }, triggerEvent: null }]);
        await s.t.handleEvents(['ev-1'], T);
        expect(s.engine.enroll).not.toHaveBeenCalled();
        expect(s.engine.resumeFromEvent).not.toHaveBeenCalled();
      }
      const guest = ev({ attributedUserId: null, attribution: null });
      const noGuests = setup([eventWf()], {}, false, [guest], [], [], { pushSubscriptionId: 'x', platform: 'web' });
      await noGuests.t.handleEvents(['ev-1'], T);
      expect(noGuests.engine.enroll).not.toHaveBeenCalled();
      const noPush = setup([eventWf({ includeGuests: true })], {}, false, [guest], [], [], { pushSubscriptionId: null, platform: 'web' });
      await noPush.t.handleEvents(['ev-1'], T);
      expect(noPush.engine.enroll).not.toHaveBeenCalled();
      const ok = setup([eventWf({ includeGuests: true })], {}, false, [guest], [], [], { pushSubscriptionId: 'x', platform: 'web' });
      await ok.t.handleEvents(['ev-1'], T);
      expect(ok.engine.enroll).toHaveBeenCalledWith(expect.anything(), { userId: null, deviceId: D }, 'ev-1', expect.anything());
    });

    it('wakes waiting enrollments whose filters match (fromTrigger) and marks event-goal conversions', async () => {
      const waits = [
        { id: 'w1', waitingFor: { stepId: 's1', eventName: 'add_to_cart', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }], since: '' }, triggerEvent: { eventId: 'x', name: 'begin_checkout', attributes: { order_id: 'O1' } } },
        { id: 'w2', waitingFor: { stepId: 's1', eventName: 'add_to_cart', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }], since: '' }, triggerEvent: { eventId: 'y', name: 'begin_checkout', attributes: { order_id: 'O2' } } },
      ];
      const goals = [{ id: 'g1', goal: { kind: 'event', eventName: 'add_to_cart', filters: [] }, triggerEvent: null }];
      const s = setup([], {}, false, [ev()], waits, goals);
      await s.t.handleEvents(['ev-1'], T);
      expect(s.engine.resumeFromEvent).toHaveBeenCalledTimes(1);
      expect(s.engine.resumeFromEvent).toHaveBeenCalledWith('w1', 's1', 'ev-1');
      expect(s.store.markConvertedAt).toHaveBeenCalledWith('g1', new Date('2026-10-10T06:10:00.000Z'));
    });
  });
});
