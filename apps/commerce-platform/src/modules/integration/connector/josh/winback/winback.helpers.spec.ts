import {
  normalizeCustomerCode,
  computeInactiveDays,
  classifyImportRow,
  parseImportCsv,
  poolOrderBy,
  buildUserIndex,
  UserCodeRow,
} from './winback.helpers';

describe('normalizeCustomerCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeCustomerCode('  ab 123 ')).toBe('AB 123');
    expect(normalizeCustomerCode('cust-01')).toBe('CUST-01');
  });
  it('preserves internal whitespace runs, matching SQL UPPER(TRIM())', () => {
    expect(normalizeCustomerCode('  ab  12 ')).toBe('AB  12');
  });
  it('returns empty string for nullish', () => {
    expect(normalizeCustomerCode(null)).toBe('');
    expect(normalizeCustomerCode(undefined)).toBe('');
  });
});

describe('computeInactiveDays', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  it('counts whole days since last order', () => {
    expect(computeInactiveDays(new Date('2026-01-16T00:00:00Z'), now)).toBe(180);
  });
  it('returns 0 for null or future dates', () => {
    expect(computeInactiveDays(null, now)).toBe(0);
    expect(computeInactiveDays(new Date('2026-08-01T00:00:00Z'), now)).toBe(0);
  });
});

describe('classifyImportRow', () => {
  it('marks unique code match as matched', () => {
    expect(
      classifyImportRow({ josh_user_id: 'u1', josh_company_id: 'c1', matchCount: 1 }, false),
    ).toBe('matched');
  });
  it('marks multi-match as ambiguous', () => {
    expect(
      classifyImportRow({ josh_user_id: null, josh_company_id: null, matchCount: 2 }, false),
    ).toBe('ambiguous');
  });
  it('marks unique tax / register-number match as matched', () => {
    expect(
      classifyImportRow({ josh_user_id: 'u1', josh_company_id: 'c1', matchCount: 1 }, true),
    ).toBe('matched');
  });
  it('marks no match as new', () => {
    expect(
      classifyImportRow({ josh_user_id: null, josh_company_id: null, matchCount: 0 }, false),
    ).toBe('new');
  });
});

describe('parseImportCsv', () => {
  it('parses header + rows and reports missing customer_code', () => {
    const csv =
      'customer_code,display_name,phone\nAB01,Acme,0812345678\n,NoCode,099';
    const { rows, errors } = parseImportCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer_code: 'AB01', display_name: 'Acme', phone: '0812345678' });
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(3);
  });

  it('parses a quoted field with an embedded comma without corrupting later columns', () => {
    const csv = 'customer_code,display_name,phone\nAB02,"Acme, Inc.",099';
    const { rows, errors } = parseImportCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customer_code: 'AB02',
      display_name: 'Acme, Inc.',
      phone: '099',
    });
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const csv = 'customer_code,display_name\nAB03,"a""b"';
    const { rows, errors } = parseImportCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe('a"b');
  });

  it('does not let a blank separator line shift later error line numbers', () => {
    const csv = 'customer_code,display_name\nAB01,Acme\n\n,NoCode';
    const { rows, errors } = parseImportCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(4);
  });
});

describe('poolOrderBy', () => {
  const pin = "(a.lifecycle = 'tmp' AND a.assigned_sales_user_id IS NULL)";

  it('pins unclaimed intake leads above the dormant-first list by default', () => {
    expect(poolOrderBy(undefined, undefined)).toEqual([
      [pin, 'DESC'],
      ['a.inactive_days', 'DESC'],
      ['a.create_date', 'DESC'],
    ]);
  });

  it('breaks the inactive_days = 0 tie by newest first', () => {
    const [, , tiebreak] = poolOrderBy(undefined, undefined);
    expect(tiebreak).toEqual(['a.create_date', 'DESC']);
  });

  it('honours an explicit sortKey with no pin, but keeps paging deterministic', () => {
    // The pin is what an explicit sort must drop. The create_date tiebreak stays:
    // without it, two rows sharing a sort value can swap between pages, so a
    // manager working down thousands of unassigned accounts sees one twice and
    // another never.
    expect(poolOrderBy('display_name', 'ASC')).toEqual([
      ['a.display_name', 'ASC'],
      ['a.create_date', 'DESC'],
    ]);
  });

  it('sorts nullable signal columns with NULLS LAST', () => {
    // delay_ratio is NULL when we cannot compute it. Postgres sorts NULLs first
    // on DESC, which would open "most overdue" on a page of unknowns.
    // Third slot, not glued to the expression: TypeORM appends the direction
    // after whatever expression it is handed.
    expect(poolOrderBy('delay_ratio', 'DESC')[0]).toEqual([
      'a.delay_ratio',
      'DESC',
      'NULLS LAST',
    ]);
  });

  it('still applies an explicit sortOrder to the default key', () => {
    expect(poolOrderBy(undefined, 'ASC')[1]).toEqual(['a.inactive_days', 'ASC']);
  });
});

describe('buildUserIndex', () => {
  const row = (over: Partial<UserCodeRow> = {}): UserCodeRow => ({
    id: 'u1',
    company_id: 'c1',
    custcode: 'GNA47789',
    legacy_custcode: null,
    ...over,
  });

  it('matches on either code column', () => {
    const index = buildUserIndex([row({ custcode: null, legacy_custcode: 'GNA47789' })]);
    expect(index.matchByCode('GNA47789').josh_user_id).toBe('u1');
  });

  it('counts one user holding the code in both columns once, not as ambiguous', () => {
    const index = buildUserIndex([row({ custcode: 'GNA47789', legacy_custcode: 'gna47789 ' })]);
    const match = index.matchByCode('GNA47789');
    expect(match.matchCount).toBe(1);
    expect(match.josh_user_id).toBe('u1');
  });

  it('links neither user when two different users share a code', () => {
    const index = buildUserIndex([row(), row({ id: 'u2', company_id: 'c2' })]);
    const match = index.matchByCode('GNA47789');
    expect(match.matchCount).toBe(2);
    expect(match.josh_user_id).toBeNull();
    expect(match.josh_company_id).toBeNull();
  });

  it('normalizes the lookup the same way the SQL side does', () => {
    const index = buildUserIndex([row()]);
    expect(index.matchByCode('  gna47789 ').josh_user_id).toBe('u1');
  });

  it('returns an empty match for an unknown or blank code', () => {
    const index = buildUserIndex([row()]);
    expect(index.matchByCode('NOPE').matchCount).toBe(0);
    expect(index.matchByCode('').matchCount).toBe(0);
  });

  it('ignores users with no code at all', () => {
    const index = buildUserIndex([row({ custcode: null, legacy_custcode: '   ' })]);
    expect(index.matchByCode('').matchCount).toBe(0);
  });

  it('reads the app login date back by user id', () => {
    const index = buildUserIndex([row({ last_app_login_at: '2026-09-01T00:00:00Z' })]);
    expect(index.lastAppLoginAt('u1')).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(index.lastAppLoginAt('u404')).toBeNull();
  });
});
