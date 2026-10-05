import { BadRequestException } from '@nestjs/common';
import { bangkokDayKey, parseBusyWindow, parseRestaurantFilters, restaurantWhere } from './restaurant-places';

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
});
