import { WinbackReports, winbackReportsSource } from './winback-reports';

const env = process.env.WINBACK_REPORTS_SOURCE;
afterEach(() => { if (env === undefined) delete process.env.WINBACK_REPORTS_SOURCE; else process.env.WINBACK_REPORTS_SOURCE = env; });

function make(replicaConfigured: boolean) {
  const josh = {
    available: replicaConfigured,
    overview: jest.fn().mockResolvedValue('josh-overview'),
    pool: jest.fn(), aging: jest.fn(), scorecard: jest.fn().mockResolvedValue('josh-scorecard'),
    dashboard: jest.fn(), teamStats: jest.fn(), leadSignals: jest.fn(),
  };
  const winback = {
    getCounts: jest.fn().mockResolvedValue({ total: 3 }),
    listProvinces: jest.fn().mockResolvedValue([{ province: 'กรุงเทพฯ', count: 3 }]),
    findPool: jest.fn(), getAging: jest.fn().mockResolvedValue([]),
  };
  const reports = { getScorecard: jest.fn().mockResolvedValue('scorecard'), getDashboard: jest.fn(), getTeamStats: jest.fn() };
  const meetingPrep = { getLeadSignals: jest.fn().mockResolvedValue({ leads: [] }) };
  const qb = { select: jest.fn().mockReturnThis(), getRawMany: jest.fn().mockResolvedValue([
    { health: 'watch', avg_monthly_revenue: '100' }, { health: 'dormant', avg_monthly_revenue: '200' },
  ]) };
  const accounts = { createQueryBuilder: jest.fn(() => qb) };
  const r = new WinbackReports(josh as never, winback as never, reports as never, meetingPrep as never, accounts as never);
  return { r, josh, winback, reports, meetingPrep };
}

describe('WinbackReports', () => {
  it('defaults to the replica; unavailable without it', async () => {
    delete process.env.WINBACK_REPORTS_SOURCE;
    expect(winbackReportsSource()).toBe('replica');
    const { r, josh, winback } = make(false);
    expect(r.available).toBe(false);
    expect(await make(true).r.overview()).toBe('josh-overview');
    expect(josh.overview).not.toHaveBeenCalled();
    expect(winback.getCounts).not.toHaveBeenCalled();
  });

  it('copies: answers from commerce tables without the replica', async () => {
    process.env.WINBACK_REPORTS_SOURCE = 'copies';
    const { r, josh, winback, reports, meetingPrep } = make(false);
    expect(r.available).toBe(true);
    const o = await r.overview();
    expect(o.counts).toEqual({ total: 3 });
    expect(winback.getCounts).toHaveBeenCalledWith({ id: '', isManager: true });
    expect(o.revenueRisk).toMatchObject({ revenue_at_risk: 100, dormant_monthly_revenue: 200 });
    expect(await r.scorecard('2026-10-01', '2026-10-31')).toBe('scorecard');
    expect(reports.getScorecard).toHaveBeenCalledWith('team', '', '2026-10-01', '2026-10-31');
    await r.leadSignals('u1', 50);
    expect(meetingPrep.getLeadSignals).toHaveBeenCalledWith({ salesUserId: '', isManager: true, requestedSalesUserId: 'u1' }, 50);
    expect(josh.overview).not.toHaveBeenCalled();
    expect(josh.scorecard).not.toHaveBeenCalled();
  });

  it('ignores unknown values', () => {
    process.env.WINBACK_REPORTS_SOURCE = 'shadow';
    expect(winbackReportsSource()).toBe('replica');
  });
});
