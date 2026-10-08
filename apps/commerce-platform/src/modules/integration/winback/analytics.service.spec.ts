import { Repository } from 'typeorm';
import { JoshOrder as Order } from './josh-copies.entity';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackSalesTarget } from './entities/winback-sales-target.entity';
import { WinbackStageHistory } from './entities/winback-stage-history.entity';
import { JoshUser as User } from './josh-copies.entity';
import { AnalyticsService } from './analytics.service';
import { ReportService } from './report.service';
import { WinbackService } from './winback.service';

function repo<T>(findResults: T[][] = []): jest.Mocked<Pick<Repository<T>, 'find'>> & { query: jest.Mock } {
  return {
    find: jest.fn().mockImplementation(() => Promise.resolve(findResults.shift() ?? [])),
    query: jest.fn(async () => (findResults.shift() ?? []).map((row: any) => ({ id: row.id, name: [row.first_name, row.last_name].filter(Boolean).join(' '), role: 'sale' }))),
  };
}

describe('AnalyticsService team tracking', () => {
  it('scopes manager locations to the selected rep with visit_n and daily_k', async () => {
    const now = new Date();
    now.setHours(10, 0, 0, 0);
    const earlier = new Date(now);
    earlier.setHours(9, 0, 0, 0);

    const users = repo<User>([
      [
        { id: 'u1', first_name: 'Ada', last_name: 'Sale', email: 'ada@example.com' },
        { id: 'u2', first_name: 'No', last_name: 'GPS', email: 'no@example.com' },
      ] as User[],
    ]);
    const latest = {
      id: 'a2',
      account_id: 'acc1',
      sales_user_id: 'u1',
      type: 'visit',
      activity_at: now,
      checkin_at: now,
      lat: '13.7',
      lng: '100.5',
    } as unknown as WinbackActivity;
    const first = {
      ...latest,
      id: 'a1',
      activity_at: earlier,
      checkin_at: earlier,
    } as WinbackActivity;
    const activities = repo<WinbackActivity>([[latest], [first, latest], [first, latest]]);
    const accounts = repo<WinbackAccount>([
      [{ id: 'acc1', display_name: 'ร้านหนึ่ง' } as WinbackAccount],
    ]);
    const service = new AnalyticsService(
      repo<WinbackSalesTarget>() as unknown as Repository<WinbackSalesTarget>,
      activities as unknown as Repository<WinbackActivity>,
      accounts as unknown as Repository<WinbackAccount>,
      users as unknown as Repository<User>,
      repo<Order>() as unknown as Repository<Order>,
      repo<WinbackStageHistory>() as unknown as Repository<WinbackStageHistory>,
      {} as ReportService,
      {} as WinbackService,
    );

    await expect(
      service.getTeamLocations({ id: 'manager', isManager: true }, 'u1'),
    ).resolves.toEqual({
      locations: [
        expect.objectContaining({
          sales_user_id: 'u1',
          name: 'Ada Sale',
          account_name: 'ร้านหนึ่ง',
          lat: 13.7,
          lng: 100.5,
          visit_n: 2,
          daily_k: 2,
          is_today: true,
        }),
      ],
      repsWithoutLocation: [],
    });
  });

  it('judges each visit against the customer pin and counts the extra checkout rows once', async () => {
    const day = '2026-07-21';
    const checkin = new Date('2026-07-21T03:00:00Z');
    const visit = {
      id: 'v1',
      account_id: 'acc1',
      sales_user_id: 'u1',
      type: 'store_visit',
      status: 'done',
      activity_at: checkin,
      checkin_at: checkin,
      checkout_at: new Date('2026-07-21T03:40:00Z'),
      lat: '13.7470000', // ~111 m from the shop
      lng: '100.5350000',
      checkin_accuracy_m: '10.0',
      checkout_lat: '13.7600000', // ~1.5 km away at checkout
      checkout_lng: '100.5350000',
      checkout_accuracy_m: null,
    } as unknown as WinbackActivity;
    const sibling = { ...visit, id: 'v1-call', type: 'call' } as WinbackActivity; // same check-in, written by checkout()
    const noGps = {
      ...visit,
      id: 'v2',
      account_id: 'acc2',
      checkin_at: new Date('2026-07-21T06:00:00Z'),
      lat: null,
      lng: null,
      checkout_lat: null,
      checkout_lng: null,
    } as unknown as WinbackActivity;
    const users = repo<User>([[{ id: 'u1', first_name: 'Ada', last_name: 'Sale' }] as User[]]);
    const activities = repo<WinbackActivity>([[visit, sibling, noGps]]);
    const accounts = repo<WinbackAccount>([
      [
        { id: 'acc1', display_name: 'ร้านหนึ่ง', lat: '13.7460000', lng: '100.5350000', restaurant_place_id: 'p1' },
        { id: 'acc2', display_name: 'ร้านสอง', lat: null, lng: null, restaurant_place_id: null },
      ] as unknown as WinbackAccount[],
    ]);
    const service = new AnalyticsService(
      repo<WinbackSalesTarget>() as unknown as Repository<WinbackSalesTarget>,
      activities as unknown as Repository<WinbackActivity>,
      accounts as unknown as Repository<WinbackAccount>,
      users as unknown as Repository<User>,
      repo<Order>() as unknown as Repository<Order>,
      repo<WinbackStageHistory>() as unknown as Repository<WinbackStageHistory>,
      {} as ReportService,
      {} as WinbackService,
    );

    const out = await service.getVisitGps({ id: 'manager', isManager: true }, day, day);

    expect(out.radius_m).toBe(200);
    expect(out.visits.map((v) => v.activity_id)).toEqual(['v1', 'v2']);
    expect(out.visits[0]).toMatchObject({
      name: 'Ada Sale',
      account_name: 'ร้านหนึ่ง',
      from_enriched_place: true,
      customer_lat: 13.746,
      checkin: { status: 'on_site', distance_m: 111, accuracy_m: 10 },
      checkout: { status: 'off_site', lat: 13.76 },
    });
    expect(out.visits[1].checkin).toMatchObject({ status: 'no_gps', distance_m: null });
    expect(out.summary).toEqual([
      expect.objectContaining({ sales_user_id: 'u1', name: 'Ada Sale', visits: 2, on_site: 1, no_gps: 1, on_site_rate: 100 }),
    ]);
  });

  it('scopes sales feed to self and computes sequences from full histories', async () => {
    const feedRow = {
      id: 'a2',
      account_id: 'acc1',
      sales_user_id: 'u1',
      type: 'call',
      outcome: null,
      activity_at: new Date('2026-07-21T10:00:00+07:00'),
      stage_after: 'contacted',
    } as unknown as WinbackActivity;
    const accountFirst = {
      ...feedRow,
      id: 'a1',
      activity_at: new Date('2026-07-20T10:00:00+07:00'),
    } as WinbackActivity;
    const dailyFirst = {
      ...feedRow,
      id: 'd1',
      account_id: 'acc2',
      activity_at: new Date('2026-07-21T09:00:00+07:00'),
    } as WinbackActivity;
    const activities = repo<WinbackActivity>([
      [feedRow],
      [accountFirst, feedRow],
      [dailyFirst, feedRow],
    ]);
    const service = new AnalyticsService(
      repo<WinbackSalesTarget>() as unknown as Repository<WinbackSalesTarget>,
      activities as unknown as Repository<WinbackActivity>,
      repo<WinbackAccount>([
        [{ id: 'acc1', display_name: 'ร้านหนึ่ง' } as WinbackAccount],
      ]) as unknown as Repository<WinbackAccount>,
      repo<User>([
        [{ id: 'u1', first_name: 'Ada', last_name: 'Sale', email: 'ada@example.com' } as User],
      ]) as unknown as Repository<User>,
      repo<Order>() as unknown as Repository<Order>,
      repo<WinbackStageHistory>() as unknown as Repository<WinbackStageHistory>,
      {} as ReportService,
      {} as WinbackService,
    );

    const result = await service.getTeamActivityFeed(
      { id: 'u1', isManager: false },
      '2026-07-21',
      '2026-07-21',
      'another-user',
    );

    expect(result).toEqual([
      expect.objectContaining({
        activity_id: 'a2',
        sales_user_id: 'u1',
        visit_n: 2,
        daily_k: 2,
        stage_after: 'contacted',
      }),
    ]);
  });
});
