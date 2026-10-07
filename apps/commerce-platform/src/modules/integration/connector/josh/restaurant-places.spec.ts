import { BadRequestException } from '@nestjs/common';
import { bangkokDayKey, estimateTables, toListItem, parseBusyWindow, parseRestaurantFilters, RestaurantPlaces, restaurantsSource, restaurantWhere } from './restaurant-places';

describe('restaurant places (Market Explorer)', () => {
  it('parses busy windows like josh', () => {
    expect(parseBusyWindow('17-20')).toEqual({ startHour: 17, endHour: 20 });
    expect(parseBusyWindow('20-17')).toBeNull();
    expect(parseBusyWindow('0-25')).toBeNull();
    expect(parseBusyWindow('x')).toBeNull();
  });

  it('uses the Bangkok weekday, not UTC', () => {
    // Monday 2026-10-05 02:00 Bangkok = Sunday 19:00 UTC
    expect(bangkokDayKey(Date.parse('2026-10-04T19:00:00Z'))).toBe('monday');
  });

  it('rejects bad input at the boundary', () => {
    expect(() => parseRestaurantFilters({ busyWindow: '9-3' })).toThrow(BadRequestException);
    expect(() => parseRestaurantFilters({ minRating: '7' })).toThrow(BadRequestException);
    expect(parseRestaurantFilters({ delivery: 'true', search: '  ' })).toMatchObject({ delivery: true, search: undefined });
  });

  it('binds every value as a parameter — nothing user-typed lands in the SQL text', () => {
    const { where, params } = restaurantWhere({ search: "x'; drop", district: 'วัฒนา', busyWindow: '17-20', excludeHasTmpLead: true }, 'monday', ['monday']);
    expect(where).not.toContain('drop');
    expect(params).toEqual(['monday', "%x'; drop%", 'วัฒนา', 'monday', 17, 20]);
    expect(where).toContain('NOT EXISTS (SELECT 1 FROM winback_account');
    // no filters → no placeholders, so a query without the day column binds nothing
    expect(restaurantWhere({}, 'monday')).toEqual({ where: '', params: [] });
  });

  it('answers with josh\'s RestaurantPlaceListItemDto field names', () => {
    const item = toListItem({ id: 'x', name: 'a', name_th: 'a', name_en: null, district: null, category: null, lat: null, lng: 1, rating: 4.5,
      review_count: 100, price_range: '฿', is_enriched: false, popular_times_today: null, winback_account_id: null, winback_customer_code: null });
    expect(Object.keys(item)).toEqual(['id', 'name', 'nameTh', 'nameEn', 'district', 'category', 'lat', 'lng', 'rating', 'reviewCount', 'priceRange',
      'isEnriched', 'popularTimesToday', 'estimatedTables', 'winbackAccountId', 'winbackCustomerCode']);
    expect(item.lat).toBe(0); // josh: null coords → 0
    expect(estimateTables(100)).toBe(20);
    expect(estimateTables(0)).toBeNull();
  });

  describe('RESTAURANTS_SOURCE', () => {
    const env = process.env.RESTAURANTS_SOURCE;
    afterEach(() => { if (env === undefined) delete process.env.RESTAURANTS_SOURCE; else process.env.RESTAURANTS_SOURCE = env; });
    const summary = { total_count: 1, top_categories: [], top_districts: [] };
    const make = (configured: boolean) => {
      const replica = { configured, query: jest.fn(async (sql: string) => (sql.includes('total_count') ? [summary] : [])) };
      const db = { query: jest.fn(async (sql: string) => (sql.includes('total_count') ? [summary] : [])) };
      return { places: new RestaurantPlaces(replica as never, db as never), replica, db };
    };

    it('defaults to the replica (josh table names), unavailable without it', async () => {
      delete process.env.RESTAURANTS_SOURCE;
      expect(restaurantsSource()).toBe('replica');
      expect(make(false).places.available).toBe(false);
      const { places, replica, db } = make(true);
      await places.list({ excludeHasTmpLead: true });
      expect(db.query).not.toHaveBeenCalled();
      expect(replica.query.mock.calls[0][0]).toContain('FROM restaurant_place p');
    });

    it('copies: commerce tables only, works without the replica', async () => {
      process.env.RESTAURANTS_SOURCE = 'copies';
      const { places, replica, db } = make(false);
      expect(places.available).toBe(true);
      const out = await places.list({ excludeHasTmpLead: true, search: 'x' });
      expect(out.summary.totalCount).toBe(1);
      expect(replica.query).not.toHaveBeenCalled();
      for (const [sql] of db.query.mock.calls) {
        expect(sql).toContain('FROM josh_restaurant_places p');
        expect(sql).not.toMatch(/\brestaurant_place p\b/);
      }
      // the winback link and the "no lead yet" filter read commerce's own winback_account
      expect(db.query.mock.calls[0][0]).toContain('FROM winback_account WHERE restaurant_place_id = p.id');
      await places.detail('11111111-1111-4111-8111-111111111111');
      await places.csv({});
      expect(db.query).toHaveBeenCalledTimes(4);
    });
  });
});
