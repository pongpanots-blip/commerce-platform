import { JoshPushCampaigns } from './josh-push-campaigns';

describe('JoshPushCampaigns PUSH_CAMPAIGNS_SOURCE (stage 5, S5-12)', () => {
  const env = process.env.PUSH_CAMPAIGNS_SOURCE;
  afterEach(() => { if (env === undefined) delete process.env.PUSH_CAMPAIGNS_SOURCE; else process.env.PUSH_CAMPAIGNS_SOURCE = env; });
  const make = (rows: unknown[] = []) => {
    const replica = { configured: false, query: jest.fn(async () => rows) };
    const db = { query: jest.fn(async () => rows) };
    const logs = { configured: false };
    return { replica, db, push: new JoshPushCampaigns(replica as never, logs as never, db as never) };
  };

  it('copies: list, overview and one campaign read josh_push_campaigns, without the replica', async () => {
    process.env.PUSH_CAMPAIGNS_SOURCE = 'copies';
    const { replica, db, push } = make([{ id: 'p1', status: 'scheduled', stats: { queued: 3, sent: 2 }, created_at: '2026-10-01' }]);
    expect(push.available).toBe(true);
    await push.list();
    expect(await push.overview()).toMatchObject({ campaigns: 1, scheduled: 1, totalQueued: 3, totalSent: 2 });
    expect(await push.delivery('p1')).toMatchObject({ campaign: { id: 'p1' }, deliveryStats: null });
    expect(replica.query).not.toHaveBeenCalled();
    for (const [sql] of db.query.mock.calls as unknown as Array<[string]>) expect(sql).toContain('FROM josh_push_campaigns');
  });

  it('replica stays the default', async () => {
    const { replica, db, push } = make();
    expect(push.available).toBe(false);
    await push.list();
    expect((replica.query.mock.calls[0] as unknown as [string])[0]).toContain('FROM push_campaigns ORDER BY');
    expect(db.query).not.toHaveBeenCalled();
  });
  it('reports counter coverage without changing legacy totals or executing writes', async () => {
    process.env.PUSH_CAMPAIGNS_SOURCE = 'copies';
    const { db, push } = make([{ stats: { sent: 0 } }, { stats: { sent: 3 } }, { stats: null }, { stats: { sent: -1 } }]);
    const overview = await push.overview();
    expect(overview).toMatchObject({ campaigns: 4, totalSent: 2, sendCounterCoverage: { scope: 'latest_200_campaigns', observed: 2, records: 4 } });
    expect((db.query.mock.calls[0] as unknown as [string])[0]).toMatch(/^SELECT [\s\S]* LIMIT 200$/);
  });
  it('distinguishes a verified empty selection from absent or malformed counters', async () => {
    process.env.PUSH_CAMPAIGNS_SOURCE = 'copies';
    expect((await make().push.overview()).sendCounterCoverage).toEqual({ scope: 'latest_200_campaigns', observed: 0, records: 0 });
    expect((await make([{ stats: {} }, { stats: { sent: '1' } }, { stats: { sent: 0.5 } }]).push.overview()).sendCounterCoverage).toEqual({ scope: 'latest_200_campaigns', observed: 0, records: 3 });
  });
});
