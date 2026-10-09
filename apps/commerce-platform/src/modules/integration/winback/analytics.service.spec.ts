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

/** Records every builder call; getMany resolves to the rows the SQL would return. */
function queryBuilder<T>(rows: T[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const qb: Record<string, jest.Mock> = {};
  for (const method of ['distinctOn', 'where', 'andWhere', 'orderBy', 'addOrderBy']) {
    qb[method] = jest.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return qb;
    });
  }
  qb.getMany = jest.fn(async () => rows);
  return { qb, calls };
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
    const activities = Object.assign(repo<WinbackActivity>([[first, latest], [first, latest]]), {
      createQueryBuilder: jest.fn(() => queryBuilder([latest]).qb),
    });
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

  it('fetches only the latest GPS location per rep in SQL and lists reps without one', async () => {
    const users = repo<User>([
      [
        { id: 'u1', first_name: 'Ada', last_name: 'Sale' },
        { id: 'u2', first_name: 'Bo', last_name: 'Sale' },
        { id: 'u3', first_name: 'No', last_name: 'GPS' },
      ] as User[],
    ]);
    const older = {
      id: 'a1',
      account_id: 'acc1',
      sales_user_id: 'u1',
      type: 'visit',
      activity_at: new Date('2026-07-20T03:00:00Z'),
      checkin_at: null,
      lat: '13.7',
      lng: '100.5',
    } as unknown as WinbackActivity;
    const newer = {
      ...older,
      id: 'b1',
      account_id: 'acc2',
      sales_user_id: 'u2',
      activity_at: new Date('2026-07-21T03:00:00Z'),
      lat: '13.8',
      lng: '100.6',
    } as unknown as WinbackActivity;
    // DISTINCT ON returns rows ordered by sales_user_id: u1 first.
    const { qb, calls } = queryBuilder([older, newer]);
    const activities = Object.assign(repo<WinbackActivity>(), {
      createQueryBuilder: jest.fn(() => qb),
    });
    const service = new AnalyticsService(
      repo<WinbackSalesTarget>() as unknown as Repository<WinbackSalesTarget>,
      activities as unknown as Repository<WinbackActivity>,
      repo<WinbackAccount>() as unknown as Repository<WinbackAccount>,
      users as unknown as Repository<User>,
      repo<Order>() as unknown as Repository<Order>,
      repo<WinbackStageHistory>() as unknown as Repository<WinbackStageHistory>,
      {} as ReportService,
      {} as WinbackService,
    );

    const out = await service.getTeamLocations({ id: 'manager', isManager: true });

    expect(calls).toEqual([
      ['distinctOn', ['act.sales_user_id']],
      ['where', 'act.sales_user_id IN (:...ids)', { ids: ['u1', 'u2', 'u3'] }],
      ['andWhere', 'act.status = :status', { status: 'done' }],
      ['andWhere', 'act.lat IS NOT NULL'],
      ['andWhere', 'act.lng IS NOT NULL'],
      ['orderBy', 'act.sales_user_id'],
      ['addOrderBy', 'act.activity_at', 'DESC'],
      ['addOrderBy', 'act.id', 'DESC'],
    ]);
    // The unbounded "all GPS activities" find is gone; the remaining finds are
    // the sequence lookups for the returned rows only.
    for (const [options] of activities.find.mock.calls as any[]) {
      expect(options.where).not.toHaveProperty('lat');
    }
    // Same contract shape, most recent location first.
    expect(out.locations.map((l) => [l.sales_user_id, l.activity_id, l.lat, l.lng])).toEqual([
      ['u2', 'b1', 13.8, 100.6],
      ['u1', 'a1', 13.7, 100.5],
    ]);
    expect(Object.keys(out.locations[0]).sort()).toEqual([
      'account_id', 'account_name', 'activity_at', 'activity_id', 'activity_type', 'checkin_at',
      'daily_k', 'email', 'is_today', 'lat', 'lng', 'name', 'sales_user_id', 'visit_n',
    ]);
    expect(out.repsWithoutLocation).toEqual([
      { sales_user_id: 'u3', name: 'No GPS', email: null },
    ]);
  });

  it('scopes a sale to their own locations and skips the query when no rep is visible', async () => {
    const { qb, calls } = queryBuilder<WinbackActivity>([]);
    const activities = Object.assign(repo<WinbackActivity>(), {
      createQueryBuilder: jest.fn(() => qb),
    });
    const build = () =>
      new AnalyticsService(
        repo<WinbackSalesTarget>() as unknown as Repository<WinbackSalesTarget>,
        activities as unknown as Repository<WinbackActivity>,
        repo<WinbackAccount>() as unknown as Repository<WinbackAccount>,
        repo<User>([
          [
            { id: 'u1', first_name: 'Ada', last_name: 'Sale' },
            { id: 'u2', first_name: 'Bo', last_name: 'Sale' },
          ] as User[],
        ]) as unknown as Repository<User>,
        repo<Order>() as unknown as Repository<Order>,
        repo<WinbackStageHistory>() as unknown as Repository<WinbackStageHistory>,
        {} as ReportService,
        {} as WinbackService,
      );

    await expect(build().getTeamLocations({ id: 'u2', isManager: false }, 'u1')).resolves.toEqual({
      locations: [],
      repsWithoutLocation: [{ sales_user_id: 'u2', name: 'Bo Sale', email: null }],
    });
    expect(calls[1]).toEqual(['where', 'act.sales_user_id IN (:...ids)', { ids: ['u2'] }]);

    activities.createQueryBuilder.mockClear();
    await expect(build().getTeamLocations({ id: 'manager', isManager: true }, 'unknown')).resolves.toEqual({
      locations: [],
      repsWithoutLocation: [],
    });
    expect(activities.createQueryBuilder).not.toHaveBeenCalled();
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
