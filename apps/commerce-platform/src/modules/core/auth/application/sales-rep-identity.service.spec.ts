import { SalesRepIdentity } from './sales-rep-identity.service';

const STAFF = { userId: '11111111-1111-4111-8111-111111111111', email: ' Rep@Example.Test ', role: 'sale' };
const JOSH_ID = '22222222-2222-4222-8222-222222222222';

describe('SalesRepIdentity', () => {
  const db = { query: jest.fn() };
  const identity = new SalesRepIdentity(db as never);
  beforeEach(() => db.query.mockReset());

  it.each(['sale', 'sales_manager', ' SALE_MANAGER '])('maps %s using one unique active internal Josh rep', async role => {
    db.query.mockImplementation(async sql => sql.includes('winback_staff_links WHERE') ? [] : [{ id: JOSH_ID }]);
    expect(await identity.repIdsFor({ ...STAFF, role })).toEqual([STAFF.userId, JOSH_ID]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("user_type = 'internal'"), ['rep@example.test']);
    const sql = db.query.mock.calls[1][0];
    expect(sql).toContain('lower(trim(email)) = $1 AND is_active');
    expect(sql).toContain("role IN ('sale', 'sales', 'manager')");
  });

  it.each([{ rows: [] }, { rows: [{ id: JOSH_ID }, { id: 'third-id' }] }])('does not map missing or ambiguous Josh identities: %j', async ({ rows }) => {
    db.query.mockImplementation(async sql => sql.includes('winback_staff_links WHERE') ? [] : rows);
    expect(await identity.repIdsFor(STAFF)).toEqual([STAFF.userId]);
  });

  it('deduplicates the same id and never caches across requests', async () => {
    db.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: STAFF.userId }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await identity.repIdsFor(STAFF)).toEqual([STAFF.userId]);
    expect(await identity.repIdsFor(STAFF)).toEqual([STAFF.userId]);
    expect(db.query).toHaveBeenCalledTimes(4);
  });

  it('never maps an unrelated role or an empty email', async () => {
    db.query.mockResolvedValue([]);
    expect(await identity.repIdsFor({ ...STAFF, role: 'marketing' })).toEqual([]);
    expect(await identity.repIdsFor({ ...STAFF, email: '' })).toEqual([STAFF.userId]);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

it('linked staff return only the canonical commerce id, without the legacy email bridge', async () => {
  const db = { query: jest.fn().mockResolvedValue([{ josh_user_id: JOSH_ID }]) };
  expect(await new SalesRepIdentity(db as never).repIdsFor(STAFF)).toEqual([STAFF.userId]);
  expect(db.query).toHaveBeenCalledTimes(1);
  expect(db.query.mock.calls[0]).toEqual([expect.stringContaining('winback_staff_links'), [STAFF.userId]]);
});
