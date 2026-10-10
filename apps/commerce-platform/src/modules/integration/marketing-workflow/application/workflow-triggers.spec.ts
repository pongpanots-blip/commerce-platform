import { WorkflowTriggers } from './workflow-triggers.service';

const U = '11111111-1111-4111-8111-111111111111';
const activated = new Date('2026-10-10T03:00:00Z');
/** "Now" for the snapshot-driven tests: shortly after the events below. */
const T = new Date('2026-10-10T06:20:00Z');
const wf = (triggerType: string, triggerConfig: object = {}, over: object = {}) => ({ id: `wf-${triggerType}`, triggerType, triggerConfig, activatedAt: activated, lastScheduledKey: null, ...over });

function setup(workflows: ReturnType<typeof wf>[], times: { first?: Date | null; last?: Date | null } = {}, crossed = false) {
  const store = {
    activeWorkflows: jest.fn(async (types: string[]) => workflows.filter((w) => types.includes(w.triggerType))),
    customerTime: jest.fn(async (_u: string, f: string) => (f === 'first_app_login_at' ? times.first ?? null : times.last ?? null)),
    milestoneCrossed: jest.fn(async () => crossed),
    markConverted: jest.fn(async () => undefined),
    customerIdsAfter: jest.fn(async (after: string | null) => (after ? [] : [U, '22222222-2222-4222-8222-222222222222'])),
    setLastScheduledKey: jest.fn(async () => undefined),
  };
  const engine = { enroll: jest.fn(async (..._args: unknown[]) => 'e1') };
  return { t: new WorkflowTriggers(store as never, engine as never), store, engine };
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
});
