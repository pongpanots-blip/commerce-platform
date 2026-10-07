import { createHmac } from 'node:crypto';
import { BESTSELLER_TOP, BESTSELLERS_COPIES_SQL, BESTSELLERS_SQL, BestsellersOffloadJob, JOSH_BESTSELLER_ORDER_STATUSES, rankingDiff } from './bestsellers-offload.job';

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
    await expect(new BestsellersOffloadJob({ configured: true, query } as never, {} as never).run()).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(expect.any(String), [JOSH_BESTSELLER_ORDER_STATUSES, BESTSELLER_TOP]);
    expect(sent!.url).toBe('http://josh/api/internal/bestsellers');
    expect(JSON.parse(sent!.body)).toMatchObject({ statuses: JOSH_BESTSELLER_ORDER_STATUSES, top: BESTSELLER_TOP, skus: ['A', 'B'] });
    expect(sent!.sig).toBe(createHmac('sha256', 's3cret').update(sent!.body).digest('hex'));
  });

  it('josh refusing (409) surfaces as an error', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 409, text: async () => 'statuses differ' })) as never;
    await expect(new BestsellersOffloadJob({ configured: true, query: async () => [] } as never, {} as never).run()).rejects.toThrow('409');
  });

  const okFetch = () => {
    const bodies: { skus: string[] }[] = [];
    global.fetch = jest.fn(async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ received: true }) };
    }) as never;
    return bodies;
  };

  it('BESTSELLERS_SOURCE=copies ranks from the order copies and needs no replica', async () => {
    process.env.BESTSELLERS_SOURCE = 'copies';
    const bodies = okFetch();
    const replica = { configured: false, query: jest.fn() };
    const db = { query: jest.fn().mockResolvedValue([{ sku: 'C' }]) };
    const job = new BestsellersOffloadJob(replica as never, db as never);
    expect(job.configured).toBe(true);
    await expect(job.run()).resolves.toBe(1);
    expect(db.query).toHaveBeenCalledWith(BESTSELLERS_COPIES_SQL, [JOSH_BESTSELLER_ORDER_STATUSES, BESTSELLER_TOP]);
    expect(replica.query).not.toHaveBeenCalled();
    expect(bodies[0].skus).toEqual(['C']);
  });

  it('BESTSELLERS_SOURCE=shadow pushes the replica list even when the copies query fails', async () => {
    process.env.BESTSELLERS_SOURCE = 'shadow';
    const bodies = okFetch();
    const replica = { configured: true, query: jest.fn().mockResolvedValue([{ sku: 'A' }]) };
    const db = { query: jest.fn().mockRejectedValue(new Error('no table')) };
    await expect(new BestsellersOffloadJob(replica as never, db as never).run()).resolves.toBe(1);
    expect(replica.query).toHaveBeenCalledWith(BESTSELLERS_SQL, expect.any(Array));
    expect(db.query).toHaveBeenCalled();
    expect(bodies[0].skus).toEqual(['A']);
  });

  it('default source is the replica; unconfigured without it', () => {
    delete process.env.BESTSELLERS_SOURCE;
    expect(new BestsellersOffloadJob({ configured: false } as never, {} as never).configured).toBe(false);
  });

  it('rankingDiff reports set and order differences', () => {
    expect(rankingDiff(['A', 'B'], ['A', 'B'])).toMatchObject({ onlyReplica: 0, onlyCopies: 0, firstDiffRank: null });
    expect(rankingDiff(['A', 'B', 'C'], ['A', 'C', 'D'])).toMatchObject({ onlyReplica: 1, onlyCopies: 1, firstDiffRank: 2 });
    expect(rankingDiff(['A', 'B'], ['A'])).toMatchObject({ firstDiffRank: 2 });
  });
});
