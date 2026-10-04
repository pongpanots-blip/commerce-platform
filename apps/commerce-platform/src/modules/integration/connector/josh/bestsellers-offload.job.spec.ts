import { createHmac } from 'node:crypto';
import { BESTSELLER_TOP, BestsellersOffloadJob, JOSH_BESTSELLER_ORDER_STATUSES } from './bestsellers-offload.job';

describe('BestsellersOffloadJob', () => {
  const OLD = process.env;
  const realFetch = global.fetch;
  beforeEach(() => { process.env = { ...OLD, JOSH_API_URL: 'http://josh/api', JOSH_EVENTS_SECRET: 's3cret' }; });
  afterAll(() => { process.env = OLD; global.fetch = realFetch; });

  it('queries the replica with josh\'s statuses and pushes the ranked SKUs, signed', async () => {
    const query = jest.fn().mockResolvedValue([{ sku: 'A' }, { sku: 'B' }]);
    let sent: { url: string; body: string; sig: string } | undefined;
    global.fetch = jest.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
      sent = { url, body: init.body, sig: init.headers['x-signature'] };
      return { ok: true, json: async () => ({ received: true }) };
    }) as never;
    await expect(new BestsellersOffloadJob({ configured: true, query } as never).run()).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(expect.any(String), [JOSH_BESTSELLER_ORDER_STATUSES, BESTSELLER_TOP]);
    expect(sent!.url).toBe('http://josh/api/internal/bestsellers');
    expect(JSON.parse(sent!.body)).toMatchObject({ statuses: JOSH_BESTSELLER_ORDER_STATUSES, top: BESTSELLER_TOP, skus: ['A', 'B'] });
    expect(sent!.sig).toBe(createHmac('sha256', 's3cret').update(sent!.body).digest('hex'));
  });

  it('josh refusing (409) surfaces as an error', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 409, text: async () => 'statuses differ' })) as never;
    await expect(new BestsellersOffloadJob({ configured: true, query: async () => [] } as never).run()).rejects.toThrow('409');
  });
});
