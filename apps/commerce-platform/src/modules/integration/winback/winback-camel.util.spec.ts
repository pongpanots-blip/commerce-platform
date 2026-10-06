import { toCamelCaseDeep } from './winback-camel.util';

describe('toCamelCaseDeep', () => {
  it('converts snake_case keys recursively', () => {
    expect(
      toCamelCaseDeep({
        sales_user_id: 'u1',
        nested: { last_seen_at: null },
        rows: [{ account_name: 'A' }],
      }),
    ).toEqual({
      salesUserId: 'u1',
      nested: { lastSeenAt: null },
      rows: [{ accountName: 'A' }],
    });
  });

  it('leaves already-camel keys and enum values alone', () => {
    expect(
      toCamelCaseDeep({ salesUserId: 'u1', type: 'store_visit' }),
    ).toEqual({ salesUserId: 'u1', type: 'store_visit' });
  });

  it('passes through primitives, null, and arrays of primitives', () => {
    expect(toCamelCaseDeep(null)).toBeNull();
    expect(toCamelCaseDeep(3)).toBe(3);
    expect(toCamelCaseDeep(['a', 'b'])).toEqual(['a', 'b']);
  });
});
