import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { StaffAccountsService } from './staff-accounts.service';

type Row = { id: string; email: string; name: string | null; role: string; status: string; passwordHash: string | null; mustChangePassword?: boolean; createdAt: Date };

describe('StaffAccountsService', () => {
  let rows: Row[];
  const audit = { insert: jest.fn() };
  const users = {
    find: jest.fn(async () => rows.filter((r) => ['admin', 'marketing'].includes(r.role))),
    findOne: jest.fn(async ({ where }: { where: Partial<Row> }) => rows.find((r) => Object.entries(where).every(([k, v]) => r[k as keyof Row] === v)) ?? null),
    count: jest.fn(async ({ where }: { where: Partial<Row> }) => rows.filter((r) => Object.entries(where).every(([k, v]) => r[k as keyof Row] === v)).length),
    create: (r: Partial<Row>) => ({ id: `u-${rows.length + 1}`, createdAt: new Date(), ...r }),
    save: jest.fn(async (r: Row) => { rows = [...rows.filter((x) => x.id !== r.id), r]; return r; }),
  };
  const sessions = {
    revokeAllForUser: jest.fn(async () => undefined),
    issueSession: jest.fn(async () => ({ accessToken: 'a', role: 'admin', mustChangePassword: false, refreshToken: 'r', expiresIn: 900, refreshExpiresIn: 2592000 })),
  };
  const svc = new StaffAccountsService(users as never, audit as never, sessions as never);
  const me = { userId: 'u-admin', email: 'boss@jagota.co.th' };

  beforeEach(() => {
    audit.insert.mockClear();
    sessions.revokeAllForUser.mockClear();
    sessions.issueSession.mockClear();
    rows = [
      { id: 'u-admin', email: 'boss@jagota.co.th', name: 'Boss', role: 'admin', status: 'active', passwordHash: bcrypt.hashSync('old-password-1', 4), createdAt: new Date() },
      { id: 'u-dev', email: 'dev@partner.test', name: null, role: 'developer', status: 'active', passwordHash: null, createdAt: new Date() },
    ];
  });

  it('lists staff only (no portal developers)', async () => {
    expect((await svc.list()).map((a) => a.email)).toEqual(['boss@jagota.co.th']);
  });

  it('creates an account with a one-time temporary password (hashed, never audited); an email in use is a 409', async () => {
    const { account, temporaryPassword } = await svc.create({ email: ' New@Jagota.co.th ', role: 'marketing' }, me);
    expect(account).toMatchObject({ email: 'new@jagota.co.th', role: 'marketing', status: 'active', mustChangePassword: true });
    const saved = rows.find((r) => r.email === 'new@jagota.co.th')!;
    expect(await bcrypt.compare(temporaryPassword, saved.passwordHash!)).toBe(true);
    expect(JSON.stringify(audit.insert.mock.calls)).not.toContain(temporaryPassword);
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'u-admin', action: 'staff.create', entityType: 'staff_account' }));
    await expect(svc.create({ email: 'dev@partner.test', role: 'admin' }, me)).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['sale', 'sale_manager', ' SALES_MANAGER '])('creates and updates canonical roles for %s', async role => {
    const canonical = role === 'sale' ? 'sale' : 'sales_manager';
    const { account } = await svc.create({ email: 'sale@example.test', role }, me);
    expect(account.role).toBe(canonical);
    expect(rows.find(row => row.id === account.id)?.role).toBe(canonical);
    expect(await svc.update(account.id, { role: ' SALE_MANAGER ' }, me)).toMatchObject({ role: 'sales_manager' });
    expect(rows.find(row => row.id === account.id)?.role).toBe('sales_manager');
  });

  it('an admin cannot demote or disable themselves; the last active admin stays', async () => {
    await expect(svc.update('u-admin', { role: 'marketing' }, me)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('u-admin', { status: 'disabled' }, { userId: 'u-other', email: 'x@y' })).rejects.toThrow('last active admin');
    rows.push({ id: 'u-2', email: 'two@jagota.co.th', name: null, role: 'admin', status: 'active', passwordHash: null, createdAt: new Date() });
    await expect(svc.update('u-2', { status: 'disabled' }, me)).resolves.toMatchObject({ status: 'disabled' });
  });

  it('only staff rows can be changed or reset', async () => {
    await expect(svc.update('u-dev', { role: 'admin' }, me)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.resetPassword('u-dev', me)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reset gives a new temporary password; changing your own needs the current one', async () => {
    const { temporaryPassword } = await svc.resetPassword('u-admin', me);
    expect(await bcrypt.compare(temporaryPassword, rows.find((r) => r.id === 'u-admin')!.passwordHash!)).toBe(true);
    expect(rows.find((r) => r.id === 'u-admin')!.mustChangePassword).toBe(true);
    await expect(svc.changeOwnPassword(me, temporaryPassword, temporaryPassword)).rejects.toThrow('must differ');
    await expect(svc.changeOwnPassword(me, 'wrong', 'a-long-new-password')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.changeOwnPassword(me, temporaryPassword, 'short')).rejects.toBeInstanceOf(BadRequestException);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u-admin', 'password_reset');
    await expect(svc.changeOwnPassword(me, temporaryPassword, 'a-long-new-password')).resolves.toMatchObject({ changed: true, accessToken: 'a', refreshToken: 'r' });
    // other sign-ins end; this one continues with the fresh session in the response
    expect(sessions.revokeAllForUser).toHaveBeenLastCalledWith('u-admin', 'password_changed');
    expect(sessions.issueSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-admin' }), 'staff');
    expect(await bcrypt.compare('a-long-new-password', rows.find((r) => r.id === 'u-admin')!.passwordHash!)).toBe(true);
    expect(rows.find((r) => r.id === 'u-admin')!.mustChangePassword).toBe(false);
  });

  it('disabling or a role change ends the account\'s sign-ins; a rename does not', async () => {
    rows.push({ id: 'u-m', email: 'mer@jagota.co.th', name: null, role: 'merchandising', status: 'active', passwordHash: null, createdAt: new Date() });
    await svc.update('u-m', { name: 'Mer' }, me);
    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    await svc.update('u-m', { role: 'graphic' }, me);
    expect(sessions.revokeAllForUser).toHaveBeenLastCalledWith('u-m', 'role_changed');
    await svc.update('u-m', { status: 'disabled' }, me);
    expect(sessions.revokeAllForUser).toHaveBeenLastCalledWith('u-m', 'disabled');
    expect(sessions.revokeAllForUser).toHaveBeenCalledTimes(2);
  });
});
