import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { COMMERCE_SERVICE_ACCOUNT, JoshStaffAccessService } from './josh-staff-access.service';

const ID = '00000000-0000-4000-8000-000000000601';
const actor = { userId: 'u-1', email: 'admin@jagota.co.th' };
const staffRow = (over: Record<string, unknown> = {}) => ({
  id: ID, email: 'mer@jagota.co.th', first_name: 'Mer', last_name: 'One', josh_role: 'merchandising', josh_active: true,
  token_version: 3, last_app_login_at: null, role: null, is_active: null, min_token_version: null, updated_at: null, updated_by: null, ...over,
});

/** A transaction whose queries answer in order: lock, select, then the writes. */
function setup(row: Record<string, unknown> | undefined) {
  const queries: [string, unknown[]][] = [];
  const m = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      queries.push([sql, params]);
      if (sql.includes('FROM josh_staff s')) return row ? [row] : [];
      if (sql.includes('INSERT INTO josh_staff_access')) return [{ updated_at: new Date('2026-10-08T01:00:00Z') }];
      return [];
    }),
  };
  const db = { transaction: jest.fn(async (fn: (x: typeof m) => unknown) => fn(m)), query: jest.fn(async () => (row ? [row] : [])) };
  const events = { publish: jest.fn(async () => undefined) };
  return { svc: new JoshStaffAccessService(db as never, events as never), events, queries };
}

describe('JoshStaffAccessService', () => {
  const OLD = process.env.COMMERCE_OWNS_STAFF;
  beforeEach(() => { process.env.COMMERCE_OWNS_STAFF = 'true'; });
  afterAll(() => { process.env.COMMERCE_OWNS_STAFF = OLD; });

  it('switch off: 409, nothing written', async () => {
    process.env.COMMERCE_OWNS_STAFF = 'false';
    const { svc, events } = setup(staffRow());
    await expect(svc.set(ID, { isActive: false }, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('refuses a role josh does not give from here (platform_admin), the commerce service account and unknown staff', async () => {
    await expect(setup(staffRow()).svc.set(ID, { role: 'platform_admin' }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup(staffRow({ email: COMMERCE_SERVICE_ACCOUNT })).svc.set(ID, { isActive: false }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup(undefined).svc.set(ID, { isActive: false }, actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('disable + sign out: saves, audits and publishes staff.access in the same transaction', async () => {
    const { svc, events, queries } = setup(staffRow());
    await svc.set(ID, { isActive: false, revokeSessions: true }, actor);
    const insert = queries.find(([sql]) => sql.includes('INSERT INTO josh_staff_access'))!;
    expect(insert[1]).toEqual([ID, 'mer@jagota.co.th', 'merchandising', false, 4, 'admin@jagota.co.th']);
    expect(queries.some(([sql]) => sql.includes('INSERT INTO audit_logs'))).toBe(true);
    const [event, manager] = (events.publish.mock.calls[0] as unknown) as [{ type: string; aggregateId: string; payload: unknown }, unknown];
    expect(manager).toBeDefined();
    expect(event.type).toBe('staff.access');
    expect(event.aggregateId).toBe(ID);
    expect(event.payload).toEqual({ id: ID, email: 'mer@jagota.co.th', role: 'merchandising', isActive: false, minTokenVersion: 4, version: '2026-10-08T01:00:00.000Z' });
  });

  it('nothing changed since commerce last decided: no event', async () => {
    const { svc, events } = setup(staffRow({ role: 'merchandising', is_active: true, min_token_version: 0 }));
    await svc.set(ID, { role: 'merchandising' }, actor);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('list hides the service account and shows pending until josh echoes the change', async () => {
    const rows = [staffRow({ role: 'cs', is_active: true, min_token_version: 0 }), staffRow({ id: 'x', email: COMMERCE_SERVICE_ACCOUNT })];
    const db = { query: jest.fn(async () => rows) };
    const list = await new JoshStaffAccessService(db as never, {} as never).list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ role: 'cs', pending: true, name: 'Mer One' });
  });
});
