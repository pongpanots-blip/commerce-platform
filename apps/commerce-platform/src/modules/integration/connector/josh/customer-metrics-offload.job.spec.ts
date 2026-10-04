import { createHmac } from 'node:crypto';
import { CustomerMetricsOffloadJob, JOSH_ACTIVE_ORDER_STATUSES } from './customer-metrics-offload.job';

const env = { JOSH_DATABASE_URL: 'postgres://replica', JOSH_API_URL: 'http://josh/api/', JOSH_EVENTS_SECRET: 's3cret' };

describe('CustomerMetricsOffloadJob', () => {
  const OLD = process.env;
  const realFetch = global.fetch;
  let calls: { url: string; body: { rows: unknown[]; done?: boolean; statuses: string[] }; sig: string }[];
  beforeEach(() => {
    process.env = { ...OLD, ...env };
    calls = [];
  });
  afterAll(() => { process.env = OLD; global.fetch = realFetch; });

  const job = (rows: number) => new CustomerMetricsOffloadJob({
    configured: true, query: jest.fn().mockResolvedValue(Array.from({ length: rows }, (_, i) => ({ user_id: `u${i}` }))),
  } as never);
  const fakeJosh = (failOnCall?: number) => {
    global.fetch = jest.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: JSON.parse(init.body), sig: init.headers['x-signature'] });
      const ok = calls.length !== failOnCall;
      return { ok, status: ok ? 200 : 500, json: async () => ({ written: JSON.parse(init.body).rows.length }), text: async () => 'boom' };
    }) as never;
  };

  it('sends changed rows in batches of 1000, signed, then a final done', async () => {
    fakeJosh();
    await expect(job(2500).run()).resolves.toEqual({ changed: 2500, written: 2500 });
    expect(calls.map((c) => [c.body.rows.length, !!c.body.done])).toEqual([[1000, false], [1000, false], [500, false], [0, true]]);
    expect(calls[0].url).toBe('http://josh/api/internal/customer-metrics');
    expect(calls[0].body.statuses).toEqual(JOSH_ACTIVE_ORDER_STATUSES);
    expect(calls[0].sig).toBe(createHmac('sha256', 's3cret').update(JSON.stringify(calls[0].body)).digest('hex'));
  });

  it('a failed batch stops the run WITHOUT sending done, so josh keeps its own reconcile', async () => {
    fakeJosh(2);
    await expect(job(2500).run()).rejects.toThrow('500');
    expect(calls.some((c) => c.body.done)).toBe(false);
  });

  it('nothing changed → only the done call (josh still records a fresh heartbeat)', async () => {
    fakeJosh();
    await job(0).run();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.done).toBe(true);
  });
});
