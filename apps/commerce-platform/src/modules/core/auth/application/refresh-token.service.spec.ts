import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { FindOperator } from 'typeorm';
import { AuthRefreshToken } from '../infrastructure/auth-refresh-token.entity';
import { RefreshTokenService } from './refresh-token.service';
import { StaffAccountsService } from './staff-accounts.service';

type UserRow = { id: string; email: string; role: string; status: string; mustChangePassword?: boolean; passwordHash?: string | null; name?: string | null; createdAt?: Date };

/** `where` match for the fake repos: plain values and IsNull(). */
const matches = (row: object, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
  const value = (row as Record<string, unknown>)[k];
  return v instanceof FindOperator && v.type === 'isNull' ? value === null || value === undefined : value === v;
});

function setup(initialUsers: UserRow[] = [{ id: 'u-1', email: 'mer@jagota.co.th', role: 'merchandising', status: 'active' }]) {
  let rows: AuthRefreshToken[] = [];
  let users = initialUsers.map((u) => ({ ...u }));
  let seq = 0;
  const tokens = {
    create: (r: Partial<AuthRefreshToken>) => ({ ...r }) as AuthRefreshToken,
    save: jest.fn(async (r: AuthRefreshToken) => {
      const saved = { ...r, id: r.id ?? `t-${++seq}`, createdAt: new Date() };
      rows = [...rows.filter((x) => x.id !== saved.id), saved];
      return saved;
    }),
    findOneBy: jest.fn(async (where: Record<string, unknown>) => rows.find((r) => matches(r, where)) ?? null),
    update: jest.fn(async (where: Record<string, unknown>, changes: Partial<AuthRefreshToken>) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, changes));
      return { affected: hit.length };
    }),
  };
  const usersRepo = {
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => users.find((u) => matches(u, where)) ?? null),
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => users.filter((u) => matches(u, where)).length),
    save: jest.fn(async (u: UserRow) => { users = [...users.filter((x) => x.id !== u.id), u]; return u; }),
  };
  const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '12h' } });
  const service = new RefreshTokenService(tokens as never, usersRepo as never, jwt);
  const user = (id = 'u-1') => users.find((u) => u.id === id)! as never;
  return { service, jwt, tokens, usersRepo, rows: () => rows, users: () => users, user };
}

const rejected401 = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(UnauthorizedException);

describe('RefreshTokenService', () => {
  afterEach(() => {
    delete process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS;
    delete process.env.AUTH_REFRESH_TOKEN_TTL_DAYS;
  });

  it('a sign-in gets a 15-minute access JWT and an opaque refresh token stored only as its sha256', async () => {
    const { service, jwt, rows, user } = setup();
    const session = await service.issueSession(user(), 'staff');
    expect(session).toMatchObject({ role: 'merchandising', mustChangePassword: false, expiresIn: 900, refreshExpiresIn: 30 * 86400 });
    const claims = await jwt.verifyAsync(session.accessToken);
    expect(claims).toMatchObject({ sub: 'u-1', email: 'mer@jagota.co.th', role: 'merchandising' });
    expect(claims.exp - claims.iat).toBe(900);
    expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ userId: 'u-1', audience: 'staff', roleAtIssue: 'merchandising', usedAt: null, revokedAt: null });
    expect(rows()[0].tokenHash).toBe(createHash('sha256').update(session.refreshToken).digest('hex'));
    expect(JSON.stringify(rows())).not.toContain(session.refreshToken);
    const ttlDays = (rows()[0].expiresAt.getTime() - Date.now()) / 86400000;
    expect(ttlDays).toBeGreaterThan(29.9);
  });

  it('TTLs come from AUTH_ACCESS_TOKEN_TTL_SECONDS / AUTH_REFRESH_TOKEN_TTL_DAYS; junk values fall back to the defaults', async () => {
    const { service, jwt, user } = setup();
    process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS = '120';
    process.env.AUTH_REFRESH_TOKEN_TTL_DAYS = '7';
    const s = await service.issueSession(user(), 'portal');
    const claims = await jwt.verifyAsync(s.accessToken);
    expect([claims.exp - claims.iat, s.expiresIn, s.refreshExpiresIn]).toEqual([120, 120, 7 * 86400]);
    process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS = 'abc';
    process.env.AUTH_REFRESH_TOKEN_TTL_DAYS = '-1';
    expect(await service.issueSession(user(), 'portal')).toMatchObject({ expiresIn: 900, refreshExpiresIn: 30 * 86400 });
  });

  it('rotation: refresh returns a new pair in the same family; the old token is spent', async () => {
    const { service, jwt, rows, user } = setup();
    const first = await service.issueSession(user(), 'staff');
    const second = await service.refresh(first.refreshToken, 'staff');
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second).toMatchObject({ role: 'merchandising', mustChangePassword: false, expiresIn: 900 });
    expect((await jwt.verifyAsync(second.accessToken)).sub).toBe('u-1');
    const [old, next] = rows();
    expect(next.familyId).toBe(old.familyId);
    expect(old.usedAt).toBeInstanceOf(Date);
    expect(old.replacedById).toBe(next.id);
    await rejected401(service.refresh(first.refreshToken, 'staff'));
  });

  it('reuse: a rotated token shown again revokes the whole family, the newest token too', async () => {
    const { service, rows, user } = setup();
    const a = await service.issueSession(user(), 'staff');
    const b = await service.refresh(a.refreshToken, 'staff');
    const c = await service.refresh(b.refreshToken, 'staff');
    await rejected401(service.refresh(a.refreshToken, 'staff'));
    await rejected401(service.refresh(c.refreshToken, 'staff'));
    expect(rows().every((r) => r.revokedAt && r.revokedReason === 'reuse')).toBe(true);
  });

  it('other sign-ins of the same account are not touched by reuse in one family', async () => {
    const { service, user } = setup();
    const laptop = await service.issueSession(user(), 'staff');
    const phone = await service.issueSession(user(), 'staff');
    await service.refresh(laptop.refreshToken, 'staff');
    await rejected401(service.refresh(laptop.refreshToken, 'staff'));
    await expect(service.refresh(phone.refreshToken, 'staff')).resolves.toMatchObject({ role: 'merchandising' });
  });

  it('two concurrent refreshes of one token: only one wins', async () => {
    const { service, user } = setup();
    const s = await service.issueSession(user(), 'staff');
    const results = await Promise.allSettled([service.refresh(s.refreshToken, 'staff'), service.refresh(s.refreshToken, 'staff')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('an expired, unknown or empty token is a 401 with one generic message', async () => {
    const { service, rows, user } = setup();
    const s = await service.issueSession(user(), 'staff');
    rows()[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.refresh(s.refreshToken, 'staff')).rejects.toThrow('invalid refresh token');
    await expect(service.refresh('nope', 'staff')).rejects.toThrow('invalid refresh token');
    await expect(service.refresh('', 'staff')).rejects.toThrow('invalid refresh token');
  });

  it('audience: a portal token is refused on the staff refresh and the other way round', async () => {
    const { service, user } = setup();
    const portal = await service.issueSession(user(), 'portal');
    const staff = await service.issueSession(user(), 'staff');
    await rejected401(service.refresh(portal.refreshToken, 'staff'));
    await rejected401(service.refresh(staff.refreshToken, 'portal'));
    // refused, not spent: each still works where it belongs
    await expect(service.refresh(portal.refreshToken, 'portal')).resolves.toBeDefined();
    await expect(service.refresh(staff.refreshToken, 'staff')).resolves.toBeDefined();
  });

  it('logout revokes the family, is idempotent, and is ok for unknown or foreign tokens', async () => {
    const { service, rows, user } = setup();
    const a = await service.issueSession(user(), 'staff');
    const b = await service.refresh(a.refreshToken, 'staff');
    await expect(service.logout(b.refreshToken, 'staff')).resolves.toEqual({ ok: true });
    expect(rows().every((r) => r.revokedReason === 'logout')).toBe(true);
    await rejected401(service.refresh(b.refreshToken, 'staff'));
    await expect(service.logout(b.refreshToken, 'staff')).resolves.toEqual({ ok: true });
    await expect(service.logout('unknown', 'staff')).resolves.toEqual({ ok: true });
    const portal = await service.issueSession(user(), 'portal');
    await expect(service.logout(portal.refreshToken, 'staff')).resolves.toEqual({ ok: true });
    await expect(service.refresh(portal.refreshToken, 'portal')).resolves.toBeDefined();
  });

  it('refresh re-checks the account: disabled, removed, role changed or no longer staff → 401 and the family is revoked', async () => {
    const { service, rows, users, user } = setup([
      { id: 'u-1', email: 'a@x', role: 'merchandising', status: 'active' },
      { id: 'u-2', email: 'b@x', role: 'marketing', status: 'active' },
      { id: 'u-3', email: 'c@x', role: 'cs', status: 'active' },
    ]);
    const disabled = await service.issueSession(user('u-1'), 'staff');
    const moved = await service.issueSession(user('u-2'), 'staff');
    const demoted = await service.issueSession(user('u-3'), 'staff');
    users().find((u) => u.id === 'u-1')!.status = 'disabled';
    users().find((u) => u.id === 'u-2')!.role = 'graphic';
    users().find((u) => u.id === 'u-3')!.role = 'developer';
    await rejected401(service.refresh(disabled.refreshToken, 'staff'));
    await rejected401(service.refresh(moved.refreshToken, 'staff'));
    await rejected401(service.refresh(demoted.refreshToken, 'staff'));
    expect(rows().every((r) => r.revokedReason === 'account_changed')).toBe(true);
    // re-activating does not bring the old sign-in back
    users().find((u) => u.id === 'u-1')!.status = 'active';
    await rejected401(service.refresh(disabled.refreshToken, 'staff'));
  });

  it('the new access token carries the current account claims', async () => {
    const { service, jwt, users, user } = setup();
    const s = await service.issueSession(user(), 'staff');
    Object.assign(users()[0], { email: 'renamed@jagota.co.th', mustChangePassword: true });
    const next = await service.refresh(s.refreshToken, 'staff');
    expect(next.mustChangePassword).toBe(true);
    expect((await jwt.verifyAsync(next.accessToken)).email).toBe('renamed@jagota.co.th');
  });

  it('a stored sale_manager signs in and refreshes as sales_manager — the alias is not a role change', async () => {
    const { service, jwt, rows, users, user } = setup([{ id: 'u-1', email: 'mgr@jagota.co.th', role: 'sale_manager', status: 'active' }]);
    const s = await service.issueSession(user(), 'staff');
    expect(s.role).toBe('sales_manager');
    expect((await jwt.verifyAsync(s.accessToken)).role).toBe('sales_manager');
    expect(rows()[0].roleAtIssue).toBe('sales_manager');
    const next = await service.refresh(s.refreshToken, 'staff');
    expect(next.role).toBe('sales_manager');
    users()[0].role = 'sales_manager'; // the account row migrated to the canonical spelling
    await expect(service.refresh(next.refreshToken, 'staff')).resolves.toMatchObject({ role: 'sales_manager' });
  });

  it('a sale account signs in and refreshes; sale → sales_manager is a real role change', async () => {
    const { service, users, user } = setup([{ id: 'u-1', email: 'rep@jagota.co.th', role: 'sale', status: 'active' }]);
    const s = await service.issueSession(user(), 'staff');
    const next = await service.refresh(s.refreshToken, 'staff');
    expect(next.role).toBe('sale');
    users()[0].role = 'sale_manager';
    await rejected401(service.refresh(next.refreshToken, 'staff'));
  });

  it('revokeAllForUser ends every sign-in of that account only', async () => {
    const { service, user } = setup([
      { id: 'u-1', email: 'a@x', role: 'merchandising', status: 'active' },
      { id: 'u-2', email: 'b@x', role: 'marketing', status: 'active' },
    ]);
    const a1 = await service.issueSession(user('u-1'), 'staff');
    const a2 = await service.issueSession(user('u-1'), 'portal');
    const b = await service.issueSession(user('u-2'), 'staff');
    await service.revokeAllForUser('u-1', 'disabled');
    await rejected401(service.refresh(a1.refreshToken, 'staff'));
    await rejected401(service.refresh(a2.refreshToken, 'portal'));
    await expect(service.refresh(b.refreshToken, 'staff')).resolves.toBeDefined();
  });

  describe('through the StaffAccountsService hooks (real service, shared fake tables)', () => {
    const admin = { userId: 'u-admin', email: 'boss@jagota.co.th' };
    const accounts = () => {
      const ctx = setup([
        { id: 'u-admin', email: 'boss@jagota.co.th', role: 'admin', status: 'active', passwordHash: null, createdAt: new Date() },
        { id: 'u-1', email: 'mer@jagota.co.th', role: 'merchandising', status: 'active', passwordHash: null, createdAt: new Date() },
      ]);
      const staff = new StaffAccountsService(ctx.usersRepo as never, { insert: jest.fn() } as never, ctx.service);
      return { ...ctx, staff };
    };

    it('disabling an account revokes its refresh tokens', async () => {
      const { service, staff, rows, user } = accounts();
      const s = await service.issueSession(user('u-1'), 'staff');
      await staff.update('u-1', { status: 'disabled' }, admin);
      expect(rows()[0]).toMatchObject({ revokedReason: 'disabled' });
      await rejected401(service.refresh(s.refreshToken, 'staff'));
    });

    it('a role change revokes its refresh tokens', async () => {
      const { service, staff, rows, user } = accounts();
      const s = await service.issueSession(user('u-1'), 'staff');
      await staff.update('u-1', { role: 'graphic' }, admin);
      expect(rows()[0]).toMatchObject({ revokedReason: 'role_changed' });
      await rejected401(service.refresh(s.refreshToken, 'staff'));
    });

    it('a rename alone keeps the sign-in', async () => {
      const { service, staff, user } = accounts();
      const s = await service.issueSession(user('u-1'), 'staff');
      await staff.update('u-1', { name: 'Mer' }, admin);
      await expect(service.refresh(s.refreshToken, 'staff')).resolves.toBeDefined();
    });

    it('a password reset revokes its refresh tokens', async () => {
      const { service, staff, user } = accounts();
      const s = await service.issueSession(user('u-1'), 'staff');
      await staff.resetPassword('u-1', admin);
      await rejected401(service.refresh(s.refreshToken, 'staff'));
    });
  });
});
