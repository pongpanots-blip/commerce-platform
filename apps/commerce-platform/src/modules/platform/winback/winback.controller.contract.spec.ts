/**
 * These tests assert controller → service wiring and role scope.
 * HTTP envelope `{ data }` + camelCase is covered by
 * winback-response.interceptor.spec.ts (wrapWinbackResponse).
 */
import { WinbackController } from './winback.controller';

function createController() {
  const winback = {
    findPool: jest.fn(),
  };
  const sync = {};
  const imports = {};
  const leads = {};
  const activityService = {};
  const diary = {
    getMyDay: jest.fn(),
    getDiary: jest.fn(),
    getCalendar: jest.fn(),
  };
  const reports = {
    getDashboard: jest.fn(),
  };
  const analytics = {
    getAnalytics: jest.fn(),
  };
  const contactsService = {};
  const meetingPrep = {
    getLeadSignals: jest.fn(),
    listAcknowledgements: jest.fn(),
    acknowledge: jest.fn(),
  };
  const uploads = {};

  const controller = new WinbackController(
    winback as any,
    sync as any,
    imports as any,
    leads as any,
    activityService as any,
    diary as any,
    reports as any,
    analytics as any,
    contactsService as any,
    meetingPrep as any,
    uploads as any,
  );

  return { controller, winback, diary, reports, analytics, meetingPrep };
}

describe('WinbackController contract snapshots', () => {
  it('matches my-day contract shape', async () => {
    const { controller, diary } = createController();
    diary.getMyDay.mockResolvedValue({
      dueToday: { count: 1, items: [{ id: 'a1', customer_code: 'WB-01' }] },
      overdue: { count: 0, items: [] },
      notVisited: { count: 0, items: [] },
      newLeads: { count: 0, items: [] },
      bought: { count: 0, items: [] },
      worklist: {
        count: 1,
        items: [
          {
            id: 'a2',
            customer_code: 'WB-02',
            display_name: 'ร้าน A',
            signal_type: 'reactivate',
            priority: 96,
            reasons: ['ไม่ได้สั่ง 214 วัน', 'ปกติสั่งทุก 18 วัน (ช้ากว่าปกติ 11.9 เท่า)'],
            recommended_action: 'call',
            last_order_at: '2026-02-13T00:00:00.000Z',
            inactive_days: 214,
            delay_ratio: 11.9,
            median_reorder_interval_days: 18,
            avg_monthly_revenue: 180000,
          },
        ],
      },
      activityByType: { visit: 1 },
    });

    const result = await controller.myDay(
      { user: { sub: 'sales-1', role: 'sale' } } as any,
      {} as any,
    );

    expect(result).toMatchSnapshot();
    expect(diary.getMyDay).toHaveBeenCalledWith('sales-1', undefined);
  });

  it('matches diary contract shape', async () => {
    const { controller, diary } = createController();
    diary.getDiary.mockResolvedValue([
      {
        id: 'act-1',
        account_id: 'acc-1',
        sales_user_id: 'sales-1',
        type: 'visit',
        status: 'done',
        account: { id: 'acc-1', display_name: 'ร้าน A', customer_code: 'WB-01' },
      },
    ]);

    const result = await controller.getDiary(
      { user: { sub: 'sales-1', role: 'sale' } } as any,
      {} as any,
    );

    expect(result).toMatchSnapshot();
  });

  it('matches calendar contract shape', async () => {
    const { controller, diary } = createController();
    diary.getCalendar.mockResolvedValue([
      {
        id: 'act-2',
        account_id: 'acc-1',
        sales_user_id: 'sales-1',
        type: 'meeting',
        status: 'planned',
        scheduled_at: '2026-08-25T06:00:00.000Z',
        account: { id: 'acc-1', display_name: 'ร้าน A', customer_code: 'WB-01' },
      },
    ]);

    const result = await controller.getCalendar(
      { user: { sub: 'sales-1', role: 'sale' } } as any,
      {} as any,
    );

    expect(result).toMatchSnapshot();
  });

  it('matches pool contract shape', async () => {
    const { controller, winback } = createController();
    winback.findPool.mockResolvedValue({
      data: [{ id: 'acc-1', customer_code: 'WB-01', tmp_progress: null }],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    const result = await controller.pool({} as any);

    expect(result).toMatchSnapshot();
  });

  it('forces dashboard scope=me for sale role', async () => {
    const { controller, reports } = createController();
    reports.getDashboard.mockResolvedValue({
      period: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-24T00:00:00.000Z' },
      scope: 'me',
      gmv: 0,
    });

    const result = await controller.dashboard(
      { user: { sub: 'sales-1', role: 'sale' } } as any,
      { scope: 'team' } as any,
    );

    expect(reports.getDashboard).toHaveBeenCalledWith('me', 'sales-1', undefined, undefined);
    expect(result).toMatchSnapshot();
  });

  it('forces analytics scope=me and ignores sales_user_id for sale role', async () => {
    const { controller, analytics } = createController();
    analytics.getAnalytics.mockResolvedValue({
      period: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-24T00:00:00.000Z' },
      kpis: { reactivation: { total: 0, won: 0, rate: 0 } },
    });

    const result = await controller.getAnalytics(
      { user: { sub: 'sales-1', role: 'sale' } } as any,
      { scope: 'team', sales_user_id: 'sales-2' } as any,
    );

    expect(analytics.getAnalytics).toHaveBeenCalledWith(
      'me',
      'sales-1',
      undefined,
      undefined,
      undefined,
    );
    expect(result).toMatchSnapshot();
  });
  it('passes manager scope through to lead-signals', async () => {
    const { controller, meetingPrep } = createController();
    meetingPrep.getLeadSignals.mockResolvedValue({ leads: [], stage_median_days: {} });

    await controller.leadSignals(
      { user: { sub: 'mgr-1', role: 'manager' } } as any,
      { sales_user_id: 'sales-2', limit: 50 } as any,
    );

    expect(meetingPrep.getLeadSignals).toHaveBeenCalledWith(
      { salesUserId: 'mgr-1', isManager: true, requestedSalesUserId: 'sales-2' },
      50,
    );
  });

  it('marks a sales caller as non-manager so the service narrows their scope', async () => {
    const { controller, meetingPrep } = createController();
    meetingPrep.getLeadSignals.mockResolvedValue({ leads: [], stage_median_days: {} });

    await controller.leadSignals(
      { user: { sub: 'sales-1', role: 'sale' } } as any,
      {} as any,
    );

    expect(meetingPrep.getLeadSignals).toHaveBeenCalledWith(
      { salesUserId: 'sales-1', isManager: false, requestedSalesUserId: undefined },
      undefined,
    );
  });

  it('stamps the caller as the acknowledging user', async () => {
    const { controller, meetingPrep } = createController();
    meetingPrep.acknowledge.mockResolvedValue({});
    const dto = {
      account_id: 'acc-1',
      signal: 'appointment_unlogged',
      subject_id: 'act-1',
      discussed_at: '2026-09-08T10:15:00+07:00',
    };

    await controller.acknowledgeMeetingPoint(
      { user: { sub: 'mgr-1', role: 'manager' } } as any,
      dto as any,
    );

    expect(meetingPrep.acknowledge).toHaveBeenCalledWith(dto, 'mgr-1');
  });
});
