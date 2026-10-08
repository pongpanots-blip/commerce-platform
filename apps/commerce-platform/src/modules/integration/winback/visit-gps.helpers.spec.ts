import { distanceM, judgeVisitGps, summarizeVisitGps, toPoint, visitRadiusM } from './visit-gps.helpers';

// Siam Paragon and a point ~111 m north of it (0.001° latitude).
const SHOP = { lat: 13.746, lng: 100.535 };
const NEAR = { lat: 13.747, lng: 100.535 };

describe('distanceM', () => {
  it('measures 0.001° of latitude as ~111 m', () => {
    expect(distanceM(SHOP, NEAR)).toBeGreaterThanOrEqual(110);
    expect(distanceM(SHOP, NEAR)).toBeLessThanOrEqual(112);
  });
  it('is 0 for the same point', () => {
    expect(distanceM(SHOP, SHOP)).toBe(0);
  });
});

describe('toPoint', () => {
  it('reads numeric strings (TypeORM numeric columns)', () => {
    expect(toPoint({ lat: '13.7460000', lng: '100.5350000' })).toEqual(SHOP);
  });
  it('rejects missing, out-of-range and (0,0) placeholders', () => {
    expect(toPoint({ lat: null, lng: 100 })).toBeNull();
    expect(toPoint({ lat: 91, lng: 100 })).toBeNull();
    expect(toPoint({ lat: 0, lng: 0 })).toBeNull();
    expect(toPoint(null)).toBeNull();
  });
});

describe('judgeVisitGps', () => {
  it('is on_site inside the radius', () => {
    expect(judgeVisitGps(NEAR, SHOP, { radiusM: 200 })).toEqual({ status: 'on_site', distance_m: 111 });
  });
  it('is off_site outside the radius', () => {
    expect(judgeVisitGps({ lat: 13.76, lng: 100.535 }, SHOP, { radiusM: 200 }).status).toBe('off_site');
  });
  it('lets GPS accuracy widen the radius, capped at the radius itself', () => {
    const far = { lat: 13.7485, lng: 100.535 }; // ~278 m
    expect(judgeVisitGps(far, SHOP, { radiusM: 200, accuracyM: 100 }).status).toBe('on_site');
    expect(judgeVisitGps({ lat: 13.751, lng: 100.535 }, SHOP, { radiusM: 200, accuracyM: 5000 }).status).toBe('off_site');
  });
  it('says no_gps / no_customer_location instead of guessing', () => {
    expect(judgeVisitGps({ lat: null, lng: null }, SHOP)).toEqual({ status: 'no_gps', distance_m: null });
    expect(judgeVisitGps(NEAR, { lat: null, lng: null })).toEqual({ status: 'no_customer_location', distance_m: null });
  });
});

describe('visitRadiusM', () => {
  const saved = process.env.WINBACK_VISIT_RADIUS_M;
  afterEach(() => {
    if (saved === undefined) delete process.env.WINBACK_VISIT_RADIUS_M;
    else process.env.WINBACK_VISIT_RADIUS_M = saved;
  });
  it('defaults to 200 m and reads the env', () => {
    delete process.env.WINBACK_VISIT_RADIUS_M;
    expect(visitRadiusM()).toBe(200);
    process.env.WINBACK_VISIT_RADIUS_M = '350';
    expect(visitRadiusM()).toBe(350);
    process.env.WINBACK_VISIT_RADIUS_M = 'abc';
    expect(visitRadiusM()).toBe(200);
  });
});

describe('summarizeVisitGps', () => {
  it('counts per rep and rates only judged visits', () => {
    const rows = [
      { sales_user_id: 'a', checkin: { status: 'on_site' as const } },
      { sales_user_id: 'a', checkin: { status: 'off_site' as const } },
      { sales_user_id: 'a', checkin: { status: 'no_gps' as const } },
      { sales_user_id: 'b', checkin: { status: 'no_customer_location' as const } },
    ];
    expect(summarizeVisitGps(rows)).toEqual([
      { sales_user_id: 'a', visits: 3, on_site: 1, off_site: 1, no_gps: 1, no_customer_location: 0, on_site_rate: 50 },
      { sales_user_id: 'b', visits: 1, on_site: 0, off_site: 0, no_gps: 0, no_customer_location: 1, on_site_rate: null },
    ]);
  });
});
