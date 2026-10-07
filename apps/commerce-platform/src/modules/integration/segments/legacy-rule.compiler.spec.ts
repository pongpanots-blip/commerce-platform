import { compileLegacyRule } from './legacy-rule.compiler';
import { UserSegmentRuleType } from './rule-type.enum';

describe('compileLegacyRule', () => {
  it('guest and first_visit compile to FALSE (no per-user bulk signal)', () => {
    expect(compileLegacyRule(UserSegmentRuleType.GUEST, {})).toEqual({
      where: 'FALSE',
      params: [],
    });
    expect(compileLegacyRule(UserSegmentRuleType.FIRST_VISIT, {})).toEqual({
      where: 'FALSE',
      params: [],
    });
  });

  it('member compiles to TRUE', () => {
    expect(compileLegacyRule(UserSegmentRuleType.MEMBER, {})).toEqual({
      where: 'TRUE',
      params: [],
    });
  });

  it('staff compares u.role to a bound param', () => {
    const { where, params } = compileLegacyRule(UserSegmentRuleType.STAFF, {});
    expect(where).toBe('u.role = $1');
    expect(params).toEqual(['staff']);
  });

  it('role: ANY(roles::text[]), empty list -> nobody', () => {
    const { where, params } = compileLegacyRule(UserSegmentRuleType.ROLE, {
      roles: ['admin', 'staff'],
    });
    expect(where).toBe('u.role = ANY($1::text[])');
    expect(params).toEqual([['admin', 'staff']]);

    expect(compileLegacyRule(UserSegmentRuleType.ROLE, { roles: [] })).toEqual(
      { where: 'FALSE', params: [] },
    );
    expect(compileLegacyRule(UserSegmentRuleType.ROLE, {})).toEqual({
      where: 'FALSE',
      params: [],
    });
  });

  it('custype: ANY(custypes::text[]), empty list -> nobody', () => {
    const { where, params } = compileLegacyRule(UserSegmentRuleType.CUSTYPE, {
      custypes: ['RESTAURANT'],
    });
    expect(where).toBe('u.custype = ANY($1::text[])');
    expect(params).toEqual([['RESTAURANT']]);
    expect(
      compileLegacyRule(UserSegmentRuleType.CUSTYPE, { custypes: [] }),
    ).toEqual({ where: 'FALSE', params: [] });
  });

  it('has_company checks u.company_id IS NOT NULL with no params', () => {
    expect(compileLegacyRule(UserSegmentRuleType.HAS_COMPANY, {})).toEqual({
      where: '(u.company_id IS NOT NULL)',
      params: [],
    });
  });

  it('min_order_count defaults min to 1, binds within_days as a param, casts the bound min to float8', () => {
    const noWindow = compileLegacyRule(UserSegmentRuleType.MIN_ORDER_COUNT, {});
    expect(noWindow.where).toContain('>= $1::float8');
    expect(noWindow.params).toEqual([1]);
    expect(noWindow.where).not.toContain('create_date');

    const withWindow = compileLegacyRule(UserSegmentRuleType.MIN_ORDER_COUNT, {
      min: 3,
      within_days: 90,
    });
    expect(withWindow.where).toContain('o.create_date >=');
    expect(withWindow.where).toContain('>= $2::float8');
    expect(withWindow.params).toEqual([90, 3]);
  });

  it('min_order_count: a fractional or astronomically large min binds fine under ::float8 (was: bigint bind error)', () => {
    const fractional = compileLegacyRule(UserSegmentRuleType.MIN_ORDER_COUNT, {
      min: 1.5,
    });
    expect(fractional.params).toEqual([1.5]);
    expect(fractional.where).toContain('::float8');

    const huge = compileLegacyRule(UserSegmentRuleType.MIN_ORDER_COUNT, {
      min: 1e21,
    });
    expect(huge.params).toEqual([1e21]);
    expect(huge.where).toContain('::float8');
  });

  it('no_order_days defaults days to 30 and uses NOT EXISTS', () => {
    const { where, params } = compileLegacyRule(
      UserSegmentRuleType.NO_ORDER_DAYS,
      {},
    );
    expect(where).toContain('NOT EXISTS');
    expect(params).toEqual([30]);
  });

  it('no_order_days / within_days: an extreme day count is clamped to +/-100y so the timestamp math never overflows', () => {
    const hugePositive = compileLegacyRule(UserSegmentRuleType.NO_ORDER_DAYS, {
      days: 3_000_000,
    });
    expect(hugePositive.params).toEqual([36500]);

    const hugeNegative = compileLegacyRule(UserSegmentRuleType.NO_ORDER_DAYS, {
      days: -3_000_000,
    });
    expect(hugeNegative.params).toEqual([-36500]);

    const withinDaysHuge = compileLegacyRule(
      UserSegmentRuleType.MIN_ORDER_COUNT,
      { min: 1, within_days: 3_000_000 },
    );
    expect(withinDaysHuge.params).toEqual([36500, 1]);

    // A normal day count passes through unclamped.
    const normal = compileLegacyRule(UserSegmentRuleType.NO_ORDER_DAYS, {
      days: 45,
    });
    expect(normal.params).toEqual([45]);
  });

  it('min_order_value / max_order_value default to 0, bind within_days, cast the bound value to float8', () => {
    const min = compileLegacyRule(UserSegmentRuleType.MIN_ORDER_VALUE, {});
    expect(min.where).toContain('>= $1::float8');
    expect(min.params).toEqual([0]);

    const max = compileLegacyRule(UserSegmentRuleType.MAX_ORDER_VALUE, {
      max_value: 5000,
      within_days: 30,
    });
    expect(max.where).toContain('< $2::float8');
    expect(max.params).toEqual([30, 5000]);
  });

  it('cuisine: matches cuisine_ids OR parent_ids compared as text, both empty -> nobody', () => {
    const { where, params } = compileLegacyRule(UserSegmentRuleType.CUISINE, {
      cuisine_ids: ['c1'],
      parent_ids: ['p1'],
    });
    expect(where).toBe(
      '(cy.id::text = ANY($1::text[]) OR cy.parent_id::text = ANY($2::text[]))',
    );
    expect(params).toEqual([['c1'], ['p1']]);

    expect(compileLegacyRule(UserSegmentRuleType.CUISINE, {})).toEqual({
      where: 'FALSE',
      params: [],
    });
  });

  it('cuisine: a non-uuid-shaped id stays a plain text comparison instead of throwing (was: uuid cast error -> 500)', () => {
    const { where, params } = compileLegacyRule(UserSegmentRuleType.CUISINE, {
      cuisine_ids: ['not-a-uuid', 123 as unknown as string],
    });
    expect(where).toBe(
      '(cy.id::text = ANY($1::text[]) OR FALSE)',
    );
    expect(params).toEqual([['not-a-uuid', '123']]);
  });

  it('cuisine_parent: ANY(parent_ids::text[]), empty -> nobody', () => {
    const { where, params } = compileLegacyRule(
      UserSegmentRuleType.CUISINE_PARENT,
      { parent_ids: ['p1'] },
    );
    expect(where).toBe('cy.parent_id::text = ANY($1::text[])');
    expect(params).toEqual([['p1']]);
    expect(
      compileLegacyRule(UserSegmentRuleType.CUISINE_PARENT, {}),
    ).toEqual({ where: 'FALSE', params: [] });
  });

  it('registered_between: each bound optional; an unparseable date is ignored, not excluding', () => {
    const both = compileLegacyRule(UserSegmentRuleType.REGISTERED_BETWEEN, {
      from: '2026-01-01',
      to: '2026-06-01',
    });
    expect(both.where).toBe('(u.created_at >= $1 AND u.created_at <= $2)');
    expect(both.params).toHaveLength(2);

    const garbageFrom = compileLegacyRule(
      UserSegmentRuleType.REGISTERED_BETWEEN,
      { from: 'not-a-date', to: '2026-06-01' },
    );
    expect(garbageFrom.where).toBe('(u.created_at <= $1)');
    expect(garbageFrom.params).toHaveLength(1);

    expect(
      compileLegacyRule(UserSegmentRuleType.REGISTERED_BETWEEN, {}),
    ).toEqual({ where: 'TRUE', params: [] });
  });

  it('registered_between: a falsy from/to (e.g. 0) is treated as no bound, mirroring matchesRule\'s `config.from ? ... : null`', () => {
    const { where, params } = compileLegacyRule(
      UserSegmentRuleType.REGISTERED_BETWEEN,
      { from: 0, to: '2026-06-01' },
    );
    expect(where).toBe('(u.created_at <= $1)');
    expect(params).toHaveLength(1);
  });

  it('unknown rule_type compiles to FALSE', () => {
    expect(
      compileLegacyRule('not-a-real-rule' as UserSegmentRuleType, {}),
    ).toEqual({ where: 'FALSE', params: [] });
  });

  it('a malicious string value stays a bound param, never concatenated into the WHERE text', () => {
    const injection = "x'; DROP TABLE users;--";
    const { where, params } = compileLegacyRule(UserSegmentRuleType.ROLE, {
      roles: [injection],
    });
    expect(where).not.toContain('DROP TABLE');
    expect(params).toEqual([[injection]]);
  });
});
