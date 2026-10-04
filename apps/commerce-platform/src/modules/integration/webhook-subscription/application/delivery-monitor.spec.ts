import { DEFAULTS, DeliveryMonitor, detectProblems, OutboxHealth, SubscriptionHealth } from './delivery-monitor';

const sub = (o: Partial<SubscriptionHealth> = {}): SubscriptionHealth => ({ name: 'josh shop', pending: 0, oldest_pending_s: 0, failed: 0, last_error: null, ...o });
const box = (o: Partial<OutboxHealth> = {}): OutboxHealth => ({ pending: 0, oldest_pending_s: 0, failed: 0, ...o });

describe('detectProblems', () => {
  it('healthy → nothing', () => {
    expect(detectProblems([sub({ pending: 3, oldest_pending_s: 1 })], box({ pending: 2, oldest_pending_s: 0 }))).toEqual([]);
  });

  it('queue to a platform waiting ≥ 60s, dead-letters, relay stuck / gave up', () => {
    const kinds = detectProblems(
      [sub({ pending: 40, oldest_pending_s: DEFAULTS.lagSeconds, failed: 2, last_error: 'Target responded 422 (not retried)' })],
      box({ pending: 5, oldest_pending_s: 31, failed: 1 }),
    ).map((p) => [p.kind, p.key]);
    expect(kinds).toEqual([
      ['delivery-lag', 'lag:josh shop'], ['dead-letter', 'dead:josh shop:2'], ['outbox-stuck', 'outbox:stuck'], ['outbox-failed', 'outbox-failed:1'],
    ]);
  });
});

describe('DeliveryMonitor.evaluate (alert policy)', () => {
  const OLD = process.env;
  const realFetch = global.fetch;
  let sent: string[];
  beforeEach(() => {
    process.env = { ...OLD, ALERT_WEBHOOK_URL: 'https://chat.example/hook' };
    sent = [];
    global.fetch = jest.fn(async (_url: string, init: { body: string }) => { sent.push(JSON.parse(init.body).text); return { ok: true }; }) as never;
  });
  afterAll(() => { process.env = OLD; global.fetch = realFetch; });

  const lag = detectProblems([sub({ pending: 9, oldest_pending_s: 120 })], box())[0];

  it('alerts once when it starts, reminds after 30 min, says recovered when it clears', async () => {
    const m = new DeliveryMonitor({} as never);
    await m.evaluate([lag], 0);
    await m.evaluate([lag], 60_000); // still on, too soon to remind
    await m.evaluate([lag], 31 * 60_000);
    await m.evaluate([], 32 * 60_000);
    await m.evaluate([], 33 * 60_000);
    expect(sent).toEqual([
      expect.stringMatching(/^🔴 commerce → platforms: "josh shop" is behind: 9 event/),
      expect.stringMatching(/^🔴 still/),
      '✅ recovered: "josh shop" is behind',
    ]);
  });

  it('dead-letters: a new alert when the count grows, no "recovered" when the window passes', async () => {
    const m = new DeliveryMonitor({} as never);
    const dead = (n: number) => detectProblems([sub({ failed: n, last_error: 'x' })], box());
    await m.evaluate(dead(1), 0);
    await m.evaluate(dead(1), 30_000);
    await m.evaluate(dead(3), 60_000);
    await m.evaluate([], 20 * 60_000);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('dead-lettered 3 event(s)');
  });

  it('no ALERT_WEBHOOK_URL → logs only, never calls out', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    await new DeliveryMonitor({} as never).evaluate([lag], 0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
