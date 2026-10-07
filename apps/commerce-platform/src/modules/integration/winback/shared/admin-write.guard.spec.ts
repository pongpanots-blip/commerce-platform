import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminWriteGuard } from './admin-write.guard';

const SECRET = 'josh-jwt-secret';
const U = '11111111-1111-4111-8111-111111111111';

function guardWith(staff: Array<Record<string, unknown>>, user = true) {
  const db = { query: jest.fn(async (sql: string, _params?: unknown[]) => (sql.includes('josh_staff') ? staff : user ? [{}] : [])) };
  return { guard: new AdminWriteGuard(db as never), db };
}
const ctx = (token: string) => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) }) as never;
const sign = (tokenVersion: number, role = 'sales') => new JwtService({ secret: SECRET }).signAsync({ sub: U, role, tokenVersion });

describe('AdminWriteGuard on the staff copy (stage 2c)', () => {
  beforeAll(() => { process.env.JOSH_JWT_SECRET = SECRET; });
  afterAll(() => { delete process.env.JOSH_JWT_SECRET; });

  it('lets an active internal staff member with the current token version through', async () => {
    const { guard, db } = guardWith([{ token_version: 2, is_active: true, internal: true }]);
    await expect(guard.canActivate(ctx(await sign(2)))).resolves.toBe(true);
    expect(db.query.mock.calls[0][0]).toContain('FROM josh_staff');
    expect(db.query.mock.calls[0][1]).toEqual([U, 'sales']);
  });

  it('refuses a token from before a password reset (token_version bumped)', async () => {
    await expect(guardWith([{ token_version: 3, is_active: true, internal: true }]).guard.canActivate(ctx(await sign(2)))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a suspended account and a non-internal role', async () => {
    await expect(guardWith([{ token_version: 0, is_active: false, internal: true }]).guard.canActivate(ctx(await sign(0)))).rejects.toThrow('ระงับ');
    await expect(guardWith([{ token_version: 0, is_active: true, internal: false }]).guard.canActivate(ctx(await sign(0)))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a customer is a 403, an unknown or deleted user a 401', async () => {
    await expect(guardWith([], true).guard.canActivate(ctx(await sign(0)))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guardWith([], false).guard.canActivate(ctx(await sign(0)))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('stage 6: with COMMERCE_OWNS_STAFF, commerce\'s own access decision is read too (only that switch)', async () => {
    const off = guardWith([{ token_version: 0, is_active: true, internal: true }]);
    await off.guard.canActivate(ctx(await sign(0)));
    expect(off.db.query.mock.calls[0][0]).not.toContain('josh_staff_access');
    process.env.COMMERCE_OWNS_STAFF = 'true';
    try {
      const on = guardWith([{ token_version: 0, is_active: true, internal: true }]);
      await on.guard.canActivate(ctx(await sign(0)));
      expect(on.db.query.mock.calls[0][0]).toContain('LEFT JOIN josh_staff_access');
    } finally { delete process.env.COMMERCE_OWNS_STAFF; }
  });
});
