import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WinbackService } from './winback.service';
import { WinbackAccount } from './entities/winback-account.entity';
import { JoshRestaurantPlace as RestaurantPlace } from './josh-copies.entity';
import { MatchingService } from './matching.service';
import { PoolQueryDto } from './dto/pool-query.dto';
import { WinbackAppRecord } from './entities/winback-app-record.entity';
import { OPPORTUNITY_OWNER_SQL, opportunityVisibility } from './opportunity-meta.helpers';

const POOL_QUERY = { page: 1, limit: 20 } as PoolQueryDto;

const NOW = new Date('2026-08-19T12:00:00Z');

function account(overrides: Partial<WinbackAccount> = {}): WinbackAccount {
  return {
    id: 'acc-1',
    customer_code: 'TMP-001',
    display_name: 'ครัวทดสอบ',
    restaurant_place_id: 'place-1',
    lifecycle: 'tmp',
    stage: 'prospect',
    visit_count: 0,
    activity_count: 0,
    create_date: NOW,
    ...overrides,
  } as WinbackAccount;
}

function place(overrides: Partial<RestaurantPlace> = {}): RestaurantPlace {
  return {
    id: 'place-1',
    name_th: 'ครัวทดสอบ',
    name_en: 'Test Kitchen',
    lat: 13.7563,
    lng: 100.5018,
    district: 'Watthana',
    raw_category: 'Thai',
    fsq_id: 'fsq-1',
    osm_id: null,
    google_place_id: 'gpid-1',
    source: 'fsq_os',
    rating: 4.5,
    review_count: 120,
    price_range: '$$',
    popular_times: { monday: Array.from({ length: 24 }, (_, i) => i * 4) },
    opening_hours: { weekday_text: ['Mon 10:00-22:00'] },
    dine_in: true,
    takeaway: true,
    delivery: false,
    enriched_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as RestaurantPlace;
}

describe('WinbackService.getAccount', () => {
  it('includes linked restaurant_place GMap enrichment when present', async () => {
    const accounts = {
      findOne: jest.fn(async () => account()),
      save: jest.fn(async (row: WinbackAccount) => row),
    } as unknown as Repository<WinbackAccount>;

    const contacts = {
      find: jest.fn(async () => []),
    } as unknown as Repository<unknown>;

    const activities = {
      findOne: jest.fn(async () => null),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn(async () => 0),
      })),
    } as unknown as Repository<unknown>;

    const orders = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => []),
        getCount: jest.fn(async () => 0),
      })),
    } as unknown as Repository<unknown>;

    const restaurantPlaces = {
      find: jest.fn(async () => [place()]),
    } as unknown as Repository<RestaurantPlace>;

    const matching = {
      matchByCode: jest.fn(async () => ({ josh_user_id: null, josh_company_id: null })),
    } as unknown as MatchingService;

    const service = new WinbackService(
      accounts,
      contacts as never,
      activities as never,
      {} as never,
      {} as never,
      orders as never,
      restaurantPlaces,
      matching,
    );

    const result = await service.getAccount('acc-1');
    expect(result.restaurant_place).toMatchObject({
      id: 'place-1',
      rating: 4.5,
      reviewCount: 120,
      priceRange: '$$',
      isEnriched: true,
    });
    expect(result.restaurant_place?.popularTimes).toEqual(place().popular_times);
    expect(result.restaurant_place?.serviceOptions).toEqual({
      dineIn: true,
      takeaway: true,
      delivery: false,
    });
  });

  it('returns null restaurant_place when account has no link', async () => {
    const accounts = {
      findOne: jest.fn(async () => account({ restaurant_place_id: null })),
      save: jest.fn(async (row: WinbackAccount) => row),
    } as unknown as Repository<WinbackAccount>;

    const contacts = { find: jest.fn(async () => []) } as unknown as Repository<unknown>;
    const activities = {
      findOne: jest.fn(async () => null),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn(async () => 0),
      })),
    } as unknown as Repository<unknown>;
    const orders = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => []),
        getCount: jest.fn(async () => 0),
      })),
    } as unknown as Repository<unknown>;
    const restaurantPlaces = {
      find: jest.fn(async () => [place()]),
    } as unknown as Repository<RestaurantPlace>;
    const matching = {
      matchByCode: jest.fn(async () => ({ josh_user_id: null, josh_company_id: null })),
    } as unknown as MatchingService;

    const service = new WinbackService(
      accounts,
      contacts as never,
      activities as never,
      {} as never,
      {} as never,
      orders as never,
      restaurantPlaces,
      matching,
    );

    const result = await service.getAccount('acc-1');
    expect(result.restaurant_place).toBeNull();
    expect(restaurantPlaces.find).not.toHaveBeenCalled();
  });

  it('throws when account is missing', async () => {
    const accounts = {
      findOne: jest.fn(async () => null),
    } as unknown as Repository<WinbackAccount>;

    const service = new WinbackService(
      accounts,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as MatchingService,
    );

    await expect(service.getAccount('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('masks the account phone/email, user name/email and contact fields', async () => {
    const acc = account({
      customer_code: 'C1',
      phone: '0985496936',
      email: 'somchai@gmail.com',
      restaurant_place_id: null,
      josh_user_id: 'u-1',
    } as Partial<WinbackAccount>);
    const accounts = {
      findOne: jest.fn(async () => acc),
      save: jest.fn(async (row: WinbackAccount) => row),
    } as unknown as Repository<WinbackAccount>;
    const contacts = {
      find: jest.fn(async () => [
        { id: 'c-1', name: 'สมหญิง รักดี', mobile: '0985496937', email: 'somying@gmail.com' },
      ]),
    } as unknown as Repository<unknown>;
    const activities = {
      findOne: jest.fn(async () => null),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn(async () => 0),
      })),
    } as unknown as Repository<unknown>;
    const users = {
      findOne: jest.fn(async () => ({
        id: 'u-1',
        email: 'user@gmail.com',
        first_name: 'สมชาย',
        last_name: 'ใจดี',
        is_active: true,
        onboarding_completed: true,
        created_at: NOW,
        last_app_login_at: null,
      })),
    } as unknown as Repository<unknown>;
    const companies = { findOne: jest.fn(async () => null) } as unknown as Repository<unknown>;
    const orders = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => []),
        getCount: jest.fn(async () => 0),
      })),
    } as unknown as Repository<unknown>;
    const restaurantPlaces = { find: jest.fn(async () => []) } as unknown as Repository<RestaurantPlace>;
    const matching = {
      matchByCode: jest.fn(async () => ({ josh_user_id: null, josh_company_id: null })),
      matchByRegisterNumber: jest.fn(async () => ({ josh_user_id: null, josh_company_id: null })),
    } as unknown as MatchingService;

    const service = new WinbackService(
      accounts,
      contacts as never,
      activities as never,
      users as never,
      companies as never,
      orders as never,
      restaurantPlaces,
      matching,
    );

    const result = await service.getAccount('acc-1');

    expect(result.account.phone).toBe('098-***6936');
    expect(result.account.email).toBe('so***@gmail.com');
    expect(result.user!.email).toBe('us***@gmail.com');
    expect(result.user!.last_name).toBe('ใ.');
    expect(result.contacts[0].mobile).toBe('098-***6937');
    expect(result.contacts[0].email).toBe('so***@gmail.com');
    expect(result.contacts[0].name).toBe('สมหญิง ร.');
  });

});

describe('WinbackService.findPool', () => {
  function poolDeps(
    rows: WinbackAccount[],
    places: RestaurantPlace[] = [],
    photos: { account_id: string; photo_url: string | null }[] = [],
  ) {
    const qb = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [rows, rows.length] as const),
    };
    const accounts = {
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<WinbackAccount>;
    const restaurantPlaces = {
      find: jest.fn(async () => places),
    } as unknown as Repository<RestaurantPlace>;
    const photoQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () => photos),
    };
    const activities = { createQueryBuilder: jest.fn(() => photoQb) };
    const service = new WinbackService(
      accounts,
      {} as never,
      activities as never,
      {} as never,
      {} as never,
      {} as never,
      restaurantPlaces,
      {} as MatchingService,
    );
    return { service, restaurantPlaces, photoQb };
  }

  it('adds photo_url from the latest activity photo (null when none)', async () => {
    const rows = [account({ id: 'acc-1' }), account({ id: 'acc-2', customer_code: 'TMP-002' })];
    const { service, photoQb } = poolDeps(rows, [place()], [{ account_id: 'acc-1', photo_url: 'https://cdn/x.jpg' }]);
    const result = await service.findPool(POOL_QUERY);
    expect(result.data.map((r) => (r as { photo_url: string | null }).photo_url)).toEqual(['https://cdn/x.jpg', null]);
    expect(photoQb.where).toHaveBeenCalledWith('act.account_id IN (:...ids)', { ids: ['acc-1', 'acc-2'] });
  });

  it('includes restaurant_place on each pool row when linked', async () => {
    const { service } = poolDeps([account()], [place()]);
    const result = await service.findPool(POOL_QUERY);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].restaurant_place).toMatchObject({
      id: 'place-1',
      rating: 4.5,
      isEnriched: true,
      winbackAccountId: 'acc-1',
      winbackCustomerCode: 'TMP-001',
    });
  });

  it('sets restaurant_place null when account has no link', async () => {
    const { service, restaurantPlaces } = poolDeps([account({ restaurant_place_id: null })]);
    const result = await service.findPool(POOL_QUERY);
    expect(result.data[0].restaurant_place).toBeNull();
    expect(restaurantPlaces.find).not.toHaveBeenCalled();
  });

  it('batch-loads places once for the page', async () => {
    const rows = [
      account({ id: 'acc-1', restaurant_place_id: 'place-1' }),
      account({ id: 'acc-2', customer_code: 'TMP-002', restaurant_place_id: 'place-2' }),
      account({ id: 'acc-3', customer_code: 'TMP-003', restaurant_place_id: null }),
    ];
    const { service, restaurantPlaces } = poolDeps(rows, [
      place({ id: 'place-1' }),
      place({ id: 'place-2', name_th: 'ร้านสอง' }),
    ]);
    await service.findPool(POOL_QUERY);
    expect(restaurantPlaces.find).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('lists visible place candidates with restaurantPlace (manager=%s)', async (isManager) => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getCount: jest.fn(async () => 1),
      getMany: jest.fn(async () => [place()]),
    };
    const accounts = {
      createQueryBuilder: jest.fn(),
    } as unknown as Repository<WinbackAccount>;
    const restaurantPlaces = {
      createQueryBuilder: jest.fn(() => qb),
      find: jest.fn(),
    } as unknown as Repository<RestaurantPlace>;
    const service = new WinbackService(
      accounts,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      restaurantPlaces,
      {} as MatchingService,
    );

    const result = await service.findPool({
      ...POOL_QUERY,
      assigned: 'unassigned',
      include_places: true,
    } as PoolQueryDto, { id: ' REP-1 ', isManager });

    const visibility = opportunityVisibility({ id: 'rep-1', isManager: false });
    if (isManager) {
      // Managers keep the same joins but have no visibility filter.
      expect(qb.leftJoin).toHaveBeenCalledTimes(2);
      expect(qb.andWhere).not.toHaveBeenCalled();
    } else {
      expect(qb.leftJoin).toHaveBeenCalledWith(WinbackAccount, 'a', 'a.restaurant_place_id = p.id');
      expect(qb.leftJoin).toHaveBeenCalledWith(WinbackAppRecord, 'm', 'm.kind = :metaKind AND m.record_key = CAST(p.id AS text)', { metaKind: 'opportunity_meta' });
      expect(qb.andWhere).toHaveBeenCalledWith(visibility.sql, { visibleOwner: 'rep-1' });
    }
    expect(qb.andWhere.mock.invocationCallOrder[0] ?? 0).toBeLessThan(qb.getCount.mock.invocationCallOrder[0]);

    expect(result.meta.total).toBe(1);
    expect(result.data[0]).toMatchObject({
      id: null,
      restaurant_place_id: 'place-1',
      place_candidate: true,
      assigned_sales_user_id: null,
      restaurant_place: { id: 'place-1', isEnriched: true, rating: 4.5 },
    });
  });

  it('rejects include_places without assigned=unassigned', async () => {
    const service = new WinbackService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as MatchingService,
    );
    await expect(
      service.findPool({ ...POOL_QUERY, include_places: true } as PoolQueryDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('masks the lead phone and email in the pool response', async () => {
    const { service } = poolDeps([
      account({ lifecycle: 'lead', phone: '0985496936', email: 'somchai@gmail.com' } as Partial<WinbackAccount>),
    ]);

    const result = await service.findPool(POOL_QUERY);
    const row = result.data[0] as { phone: string | null; email: string | null };

    expect(row.phone).toBe('098-***6936');
    expect(row.email).toBe('so***@gmail.com');
  });

});

describe('WinbackService.getCounts', () => {
  it('sums total / unassigned / mine from the grouped rows, mine keyed to the caller', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () => [
        { health: 'dormant', stage: 'prospect', source: 'manual', lifecycle: 'tmp', unassigned: true, mine: null, count: '4' },
        { health: 'dormant', stage: 'prospect', source: 'manual', lifecycle: 'lead', unassigned: false, mine: true, count: '2' },
        { health: 'dormant', stage: 'contacted', source: 'manual', lifecycle: 'lead', unassigned: false, mine: false, count: '3' },
      ]),
    };
    const accounts = { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<WinbackAccount>;
    const placesQb = { leftJoin: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getCount: jest.fn(async () => 7) };
    const restaurantPlaces = {
      createQueryBuilder: jest.fn(() => placesQb),
    } as unknown as Repository<RestaurantPlace>;
    const service = new WinbackService(
      accounts,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      restaurantPlaces,
      {} as MatchingService,
    );

    const counts = await service.getCounts({ id: 'sale-1', isManager: false });

    expect(qb.setParameter).toHaveBeenCalledWith('me', 'sale-1');
    expect(placesQb.where).toHaveBeenCalledWith('a.id IS NULL');
    expect(placesQb.andWhere).toHaveBeenCalledWith(opportunityVisibility({ id: 'sale-1', isManager: false }).sql, { visibleOwner: 'sale-1' });
    expect(counts).toMatchObject({
      total: 9,
      unassigned: 4,
      placeCandidates: 7,
      unassignedIncludingPlaces: 11,
      mine: 2,
    });
    expect(counts.byStage).toEqual({ prospect: 6, contacted: 3 });
  });
});

describe('pool place candidate coordination owners', () => {
  it.each([
    ['sale excludes other coordination owners', { id: 'rep-1', isManager: false }, ['own', 'unowned']],
    ['manager counts all coordination owners', { id: 'mgr-1', isManager: true }, ['own', 'unowned', 'other']],
    ['default actor fails closed', undefined, ['unowned']],
  ] as const)('%s with identical list and count visibility', async (_label, actor, expected) => {
    const candidates = [
      { row: place({ id: 'own' }), metaOwner: 'rep-1', accountId: null },
      { row: place({ id: 'unowned' }), metaOwner: null, accountId: null },
      { row: place({ id: 'other' }), metaOwner: 'rep-2', accountId: null },
      { row: place({ id: 'converted' }), metaOwner: null, accountId: 'acc-1' },
    ];
    const builders: Array<{ leftJoin: jest.Mock; andWhere: jest.Mock; where: jest.Mock }> = [];
    const places = {
      createQueryBuilder: jest.fn(() => {
        let openOnly = false;
        let visibleOwner: string | null | undefined;
        const rows = () => candidates.filter((c) =>
          (!openOnly || c.accountId === null)
          && (visibleOwner === undefined || c.metaOwner === null || c.metaOwner === visibleOwner),
        ).map((c) => c.row);
        const qb = {
          leftJoin: jest.fn().mockReturnThis(),
          where: jest.fn((sql) => { openOnly = sql === 'a.id IS NULL'; return qb; }),
          andWhere: jest.fn((sql, params) => {
            if (sql === `${OPPORTUNITY_OWNER_SQL} IS NULL`) visibleOwner = null;
            else if (sql === `(${OPPORTUNITY_OWNER_SQL} IS NULL OR ${OPPORTUNITY_OWNER_SQL} = :visibleOwner)`) visibleOwner = params.visibleOwner;
            else throw new Error(`Unexpected visibility SQL: ${sql}`);
            return qb;
          }),
          orderBy: jest.fn().mockReturnThis(), addOrderBy: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(), take: jest.fn().mockReturnThis(),
          getMany: jest.fn(async () => rows()), getCount: jest.fn(async () => rows().length),
        };
        builders.push(qb);
        return qb;
      }),
    };
    const accountQb = {
      select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(), groupBy: jest.fn().mockReturnThis(), addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () => [{ health: 'dormant', stage: 'prospect', source: 'manual', lifecycle: 'tmp', unassigned: true, mine: false, count: '4' }]),
    };
    const service = new WinbackService({ createQueryBuilder: () => accountQb } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, places as never, {} as never);
    const list = await service.findPool({ ...POOL_QUERY, assigned: 'unassigned', include_places: true }, actor);
    const counts = await service.getCounts(actor);
    expect(list.data.map((r) => r.restaurant_place_id)).toEqual(expected);
    expect(list.meta.total).toBe(expected.length);
    expect(counts).toMatchObject({ total: 4, unassigned: 4, placeCandidates: expected.length, unassignedIncludingPlaces: 4 + expected.length });
    expect(accountQb.setParameter).toHaveBeenCalledWith('me', actor?.id || null);
    expect(builders).toHaveLength(2);
    expect(builders[0].andWhere.mock.calls).toEqual(builders[1].andWhere.mock.calls);
    const visibility = opportunityVisibility(actor ?? { id: '', isManager: false });
    for (const qb of builders) {
      expect(qb.leftJoin).toHaveBeenCalledWith(WinbackAccount, 'a', 'a.restaurant_place_id = p.id');
      expect(qb.leftJoin).toHaveBeenCalledWith(WinbackAppRecord, 'm', 'm.kind = :metaKind AND m.record_key = CAST(p.id AS text)', { metaKind: 'opportunity_meta' });
      expect(qb.where).toHaveBeenCalledWith('a.id IS NULL');
      if (actor?.isManager) expect(qb.andWhere).not.toHaveBeenCalled();
      else expect(qb.andWhere).toHaveBeenCalledWith(visibility.sql, visibility.params);
    }
  });
});
