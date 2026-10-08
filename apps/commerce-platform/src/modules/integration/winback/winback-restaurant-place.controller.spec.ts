/**
 * `GET /winback/restaurant-place[/:id]` — Market Explorer for the saleactivity app under commerce staff sign-in.
 * Same guard chain and envelope as the other winback app routes; responses must parse with the app's
 * `unwrapDataMap` → RestaurantPlacePage / WinbackRestaurantPlace (lib/features/leads/data).
 */
import 'reflect-metadata';
import { BadRequestException, CanActivate, ForbiddenException, NotFoundException, ParseUUIDPipe, RequestMethod, ServiceUnavailableException, Type, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../../../shared-kernel/presentation/auth.decorators';
import { COMMERCE_JWT_ISSUER } from '../../../shared-kernel/presentation/jwt-issuer';
import { RestaurantPlaces } from '../connector/josh/restaurant-places';
import { AdminWriteGuard } from './shared/admin-write.guard';
import { WinbackStaffIdentityService } from './shared/winback-staff-identity.service';
import { WinbackAppController } from './winback-app.controller';
import { WinbackAppRoleGuard } from './winback-app-role.guard';
import { WinbackOwnershipGuard } from './winback-ownership.guard';
import { WinbackResponseInterceptor, wrapWinbackResponse } from './winback-response.interceptor';
import { PLACE_LIMIT_DEFAULT, PLACE_LIMIT_MAX, placePaging, WinbackRestaurantPlaceController } from './winback-restaurant-place.controller';
import { WinbackModule } from './winback.module';

const C = WinbackRestaurantPlaceController;
const UUID = '00000000-0000-4000-8000-000000000001';
const STAFF = '11111111-1111-4111-8111-111111111111';
const JOSH = '22222222-2222-4222-8222-222222222222';
const ctx = (req: unknown) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;

// --- data: the real RestaurantPlaces over a fake commerce copy (RESTAURANTS_SOURCE=copies) ---
const ROW = {
  id: UUID, name: 'ร้านวัฒนา', name_th: 'ร้านวัฒนา', name_en: 'Watthana Kitchen', district: 'วัฒนา', category: 'Japanese Restaurant',
  lat: 13.73, lng: 100.58, rating: 4.6, review_count: 320, price_range: '$$', is_enriched: true,
  dine_in: true, takeaway: false, delivery: null, popular_times_today: [10, 20, 65, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  winback_account_id: null, winback_customer_code: null,
};
const DETAIL_ROW = {
  ...ROW, source: 'fsq_os', popular_times: { monday: Array(24).fill(0) }, opening_hours: { weekday_text: ['Monday: 10:00 – 22:00'], open_now: true },
  enriched_at: new Date('2026-10-01T03:00:00.000Z'), google_place_id: 'g1', fsq_id: 'f1',
};
const SUMMARY = { total_count: 1, top_categories: [{ name: 'Japanese Restaurant', count: 1 }], top_districts: [{ name: 'วัฒนา', count: 1 }] };

function make({ source = 'copies', replicaConfigured = false, detail = DETAIL_ROW as unknown }: { source?: string; replicaConfigured?: boolean; detail?: unknown } = {}) {
  process.env.RESTAURANTS_SOURCE = source;
  const db = { query: jest.fn(async (sql: string) => (sql.includes('WITH f AS') ? [SUMMARY] : sql.includes('WHERE p.id =') ? (detail ? [detail] : []) : [ROW])) };
  const replica = { configured: replicaConfigured, query: jest.fn() };
  const places = new RestaurantPlaces(replica as never, db as never);
  return { controller: new C(places), db, replica };
}
const listCall = (db: { query: jest.Mock }) => db.query.mock.calls.find(([sql]) => !(sql as string).includes('WITH f AS'))!;

// --- auth: the controller's own guard chain, built from its metadata, against a fake users / josh_staff ---
const token = (source: 'commerce' | 'josh', claims: Record<string, unknown> = {}) =>
  new JwtService({ secret: source === 'josh' ? 'josh-test' : 'commerce-test' }).sign(
    source === 'josh' ? { sub: JOSH, role: 'sale', email: 'rep@example.test', companyId: null, tokenVersion: 0, ...claims }
      : { sub: STAFF, role: 'sale', email: 'rep@example.test', ...claims },
    source === 'commerce' ? { issuer: COMMERCE_JWT_ISSUER } : {});

async function runGuards(authorization: string | undefined, rowRole = 'sale') {
  const db = { query: jest.fn(async (sql: string) => {
    if (sql.includes('FROM users')) return [{ id: STAFF, email: 'rep@example.test', role: rowRole, status: 'active', must_change_password: false }];
    if (sql.includes('FROM josh_staff')) return [{ token_version: 0, is_active: true, internal: true }];
    return [];
  }) };
  const req = { method: 'GET', headers: authorization ? { authorization } : {} };
  for (const G of Reflect.getMetadata(GUARDS_METADATA, C) as Type<CanActivate>[]) {
    const guard = G === AdminWriteGuard ? new AdminWriteGuard(db as never, new WinbackStaffIdentityService(db as never)) : new G();
    await guard.canActivate(ctx(req));
  }
  return req;
}

const saved = { ...process.env };
beforeEach(() => { process.env.PORTAL_JWT_SECRET = 'commerce-test'; process.env.JOSH_JWT_SECRET = 'josh-test'; delete process.env.WINBACK_ACCEPT_JOSH_JWT; });
afterEach(() => { process.env = { ...saved }; });

describe('wiring', () => {
  it('exactly two GET routes: winback/restaurant-place and winback/restaurant-place/:id (no export, no geo)', () => {
    const proto = C.prototype as unknown as Record<string, object>;
    const routes = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && Reflect.getMetadata(PATH_METADATA, proto[n]) !== undefined)
      .map((n) => `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[n])]} /${Reflect.getMetadata(PATH_METADATA, C)}/${Reflect.getMetadata(PATH_METADATA, proto[n])} → ${n}`);
    expect(routes).toEqual(['GET /winback/restaurant-place → list', 'GET /winback/restaurant-place/:id → detail']);
  });

  it('same guards, interceptor and @Public as WinbackAppController (module adds the ownership guard)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, C)).toEqual([AdminWriteGuard, WinbackAppRoleGuard, WinbackOwnershipGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, C)).toEqual(Reflect.getMetadata(GUARDS_METADATA, WinbackAppController));
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, C)).toEqual([WinbackResponseInterceptor]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, C)).toBe(true);
  });

  it('registered in WinbackModule; RestaurantPlaces comes from JoshModule, not a second provider', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, WinbackModule)).toContain(C);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WinbackModule)).not.toContain(RestaurantPlaces);
  });

  it(':id goes through ParseUUIDPipe', () => {
    const args = Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, C, 'detail') as Record<string, { data: string; pipes: unknown[] }>);
    expect(args).toEqual([expect.objectContaining({ data: 'id', pipes: [ParseUUIDPipe] })]);
  });
});

describe('roles (AdminWriteGuard → WinbackAppRoleGuard → WinbackOwnershipGuard)', () => {
  it.each([['sale', 'sale'], ['sales_manager', 'sales_manager'], ['sale_manager', 'sales_manager'], ['admin', 'admin']])(
    'commerce %s is allowed', async (rowRole, role) => {
      const req = await runGuards(`Bearer ${token('commerce')}`, rowRole);
      expect(req).toMatchObject({ user: { sub: STAFF, role, source: 'commerce' } });
    });

  it.each(['cs', 'marketing', 'developer', 'merchandising', 'business_analyst'])('commerce %s gets the winback 403', async (rowRole) => {
    await expect(runGuards(`Bearer ${token('commerce')}`, rowRole)).rejects.toThrow(new ForbiddenException('เฉพาะทีมขายที่ใช้งานส่วนนี้ได้'));
  });

  it('a developer token is 403 even if the row says admin', async () => {
    await expect(runGuards(`Bearer ${token('commerce', { role: 'developer' })}`, 'admin')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no token / garbage token is 401', async () => {
    await expect(runGuards(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(runGuards('Bearer not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('josh sales JWT is allowed while WINBACK_ACCEPT_JOSH_JWT is on, 401 once it is off', async () => {
    expect(await runGuards(`Bearer ${token('josh')}`)).toMatchObject({ user: { role: 'sale', source: 'josh' } });
    process.env.WINBACK_ACCEPT_JOSH_JWT = 'false';
    await expect(runGuards(`Bearer ${token('josh')}`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('josh non-sales JWT (marketing) gets the winback 403', async () => {
    await expect(runGuards(`Bearer ${token('josh', { role: 'marketing' })}`)).rejects.toThrow('เฉพาะทีมขายที่ใช้งานส่วนนี้ได้');
  });
});

describe('query parsing', () => {
  it.each([
    [{}, 1, PLACE_LIMIT_DEFAULT],
    [{ page: '3', limit: '50' }, 3, 50],
    [{ page: '0', limit: '0' }, 1, 1],
    [{ page: '-4', limit: '-1' }, 1, 1],
    [{ limit: '500' }, 1, PLACE_LIMIT_MAX],
    [{ page: 'abc', limit: 'x' }, 1, PLACE_LIMIT_DEFAULT],
    [{ page: '2.7', limit: '20.9' }, 2, 20],
    [{ page: '', limit: '' }, 1, PLACE_LIMIT_DEFAULT],
    [{ page: ['2', '3'], limit: ['10'] }, 1, PLACE_LIMIT_DEFAULT],
  ])('%j → page %i, limit %i', (q, page, limit) => {
    expect(placePaging(q)).toEqual({ page, limit });
  });

  it('passes the app filters and clamped paging to RestaurantPlaces (LIMIT / OFFSET)', async () => {
    const { controller, db } = make();
    await controller.list({ district: 'วัฒนา', category: 'Japanese', minRating: '4', minReviewCount: '100', isEnriched: 'true', search: 'ซูชิ', page: '2', limit: '500' });
    const [sql, params] = listCall(db);
    expect(sql).toContain('p.district = ');
    expect(sql).toContain('p.raw_category ILIKE');
    expect(sql).toContain('p.rating >=');
    expect(sql).toContain('p.review_count >=');
    expect(sql).toContain('p.enriched_at IS NOT NULL');
    expect(sql).toContain('p.name_th ILIKE');
    expect(params).toEqual(expect.arrayContaining(['วัฒนา', '%Japanese%', 4, 100, '%ซูชิ%']));
    expect(params.slice(-2)).toEqual([PLACE_LIMIT_MAX, PLACE_LIMIT_MAX]); // LIMIT 100 OFFSET (2-1)*100
  });

  it('defaults to page 1, limit 50', async () => {
    const { controller, db } = make();
    const res = await controller.list({});
    expect(listCall(db)[1].slice(-2)).toEqual([50, 0]);
    expect(res).toMatchObject({ page: 1, limit: 50 });
  });

  it('a bad filter value is a 400 before any query', async () => {
    const { controller, db } = make();
    await expect(controller.list({ minRating: '9' })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('errors', () => {
  it('404 with the winback wording when the place does not exist', async () => {
    const { controller } = make({ detail: null });
    await expect(controller.detail(UUID)).rejects.toThrow(new NotFoundException('ไม่พบร้านใน Market Explorer'));
  });

  it('503 (shop-reports wording) when neither the replica nor RESTAURANTS_SOURCE=copies is available', async () => {
    const { controller, replica } = make({ source: 'replica', replicaConfigured: false });
    await expect(controller.list({})).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(controller.detail(UUID)).rejects.toThrow("Set RESTAURANTS_SOURCE=copies to read commerce's copy.");
    expect(replica.query).not.toHaveBeenCalled();
  });

  it('replica source answers once JOSH_DATABASE_URL is configured', async () => {
    const { controller, replica } = make({ source: 'replica', replicaConfigured: true });
    replica.query.mockImplementation(async (sql: string) => (sql.includes('WITH f AS') ? [SUMMARY] : [ROW]));
    await expect(controller.list({})).resolves.toMatchObject({ summary: { totalCount: 1 } });
  });
});

describe('response shape (what the app parses after unwrapDataMap)', () => {
  const ITEM_KEYS = ['id', 'name', 'nameTh', 'nameEn', 'district', 'provinceCode', 'provinceName', 'category', 'lat', 'lng', 'rating',
    'reviewCount', 'priceRange', 'isEnriched', 'popularTimesToday', 'estimatedTables', 'winbackAccountId', 'winbackCustomerCode'];

  it('list → { data: { items, summary { totalCount, topCategories, topDistricts }, page, limit } }', async () => {
    const { controller } = make();
    const body = wrapWinbackResponse(await controller.list({ limit: '50' })) as { data: Record<string, any> };
    expect(Object.keys(body)).toEqual(['data']);
    expect(Object.keys(body.data).sort()).toEqual(['items', 'limit', 'page', 'summary']);
    expect(body.data.summary).toEqual({
      totalCount: 1, topCategories: [{ name: 'Japanese Restaurant', count: 1 }], topDistricts: [{ name: 'วัฒนา', count: 1 }],
    });
    expect(body.data).toMatchObject({ page: 1, limit: 50 });
    const [item] = body.data.items;
    expect(Object.keys(item).sort()).toEqual([...ITEM_KEYS].sort());
    expect(item).toEqual({
      id: UUID, name: 'ร้านวัฒนา', nameTh: 'ร้านวัฒนา', nameEn: 'Watthana Kitchen', district: 'วัฒนา', provinceCode: 10, provinceName: 'กรุงเทพมหานคร',
      category: 'Japanese Restaurant', lat: 13.73, lng: 100.58, rating: 4.6, reviewCount: 320, priceRange: '$$', isEnriched: true,
      popularTimesToday: ROW.popular_times_today, estimatedTables: 36, winbackAccountId: null, winbackCustomerCode: null,
    });
  });

  it('detail → { data: WinbackRestaurantPlace } with popularTimes, openingHours, serviceOptions, enrichedAt (ISO string)', async () => {
    const { controller } = make();
    const body = wrapWinbackResponse(await controller.detail(UUID)) as { data: Record<string, any> };
    expect(Object.keys(body.data).sort()).toEqual([...ITEM_KEYS, 'source', 'popularTimes', 'openingHours', 'serviceOptions', 'enrichedAt'].sort());
    expect(body.data).toMatchObject({
      id: UUID, provinceCode: 10, provinceName: 'กรุงเทพมหานคร', source: 'fsq_os',
      popularTimes: { monday: Array(24).fill(0) },
      // camelCased by the winback interceptor — the app reads `weekdayText ?? weekday_text`
      openingHours: { weekdayText: ['Monday: 10:00 – 22:00'], openNow: true },
      serviceOptions: { dineIn: true, takeaway: false, delivery: null },
      enrichedAt: '2026-10-01T03:00:00.000Z',
    });
  });

  it('an unknown district has no province (null, as josh)', async () => {
    const { controller, db } = make();
    db.query.mockImplementation(async (sql: string) => (sql.includes('WITH f AS') ? [SUMMARY] : [{ ...ROW, district: null }]));
    const res = await controller.list({});
    expect(res.items[0]).toMatchObject({ provinceCode: null, provinceName: null });
  });
});
