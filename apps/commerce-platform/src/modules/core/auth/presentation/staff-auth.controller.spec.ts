import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IS_PUBLIC_KEY } from '../../../../shared-kernel/presentation/auth.decorators';
import { PortalAuthController } from '../../../../portal/auth/portal-auth.controller';
import { StaffAuthController } from './staff-auth.controller';
import { RefreshTokenDto } from './refresh-token.dto';

const reflector = new Reflector();
const isPublic = (cls: abstract new (...args: never[]) => unknown, handler: string) =>
  !!reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [(cls.prototype as Record<string, () => unknown>)[handler], cls]);

function auth() {
  return {
    login: jest.fn(async () => ({ accessToken: 'a', role: 'admin', mustChangePassword: false, refreshToken: 'r', expiresIn: 900, refreshExpiresIn: 1 })),
    refresh: jest.fn(async () => ({ accessToken: 'a2', refreshToken: 'r2' })),
    logout: jest.fn(async () => ({ ok: true as const })),
  };
}
const req = { headers: { 'user-agent': 'jest' }, ip: '127.0.0.1' };

describe('auth controllers (refresh / logout)', () => {
  it('staff login, refresh and logout are public (an expired access token must not block them); me stays guarded', () => {
    for (const h of ['login', 'register', 'refresh', 'logout']) expect(isPublic(StaffAuthController, h)).toBe(true);
    expect(isPublic(StaffAuthController, 'me')).toBe(false);
    expect(isPublic(StaffAuthController, 'changePassword')).toBe(false);
    for (const h of ['login', 'register', 'refresh', 'logout']) expect(isPublic(PortalAuthController, h)).toBe(true);
  });

  it('staff endpoints use the staff audience, portal endpoints the portal audience', async () => {
    const a = auth();
    const staff = new StaffAuthController(a as never, {} as never);
    await staff.login({ email: 'x@jagota.co.th', password: 'p' }, req);
    await staff.refresh({ refreshToken: 'rt' }, req);
    await expect(staff.logout({ refreshToken: 'rt' })).resolves.toEqual({ ok: true });
    expect(a.login).toHaveBeenCalledWith('x@jagota.co.th', 'p', 'staff', { userAgent: 'jest', ip: '127.0.0.1' });
    expect(a.refresh).toHaveBeenCalledWith('rt', 'staff', { userAgent: 'jest', ip: '127.0.0.1' });
    expect(a.logout).toHaveBeenCalledWith('rt', 'staff');

    const p = auth();
    const portal = new PortalAuthController(p as never);
    await portal.login({ email: 'dev@x.co', password: 'p' }, req);
    await portal.refresh({ refreshToken: 'rt' }, req);
    await portal.logout({ refreshToken: 'rt' });
    expect(p.login).toHaveBeenCalledWith('dev@x.co', 'p', 'portal', expect.any(Object));
    expect(p.refresh).toHaveBeenCalledWith('rt', 'portal', expect.any(Object));
    expect(p.logout).toHaveBeenCalledWith('rt', 'portal');
  });

  it('login keeps every old response field and adds the refresh pair', async () => {
    const staff = new StaffAuthController(auth() as never, {} as never);
    const res = await staff.login({ email: 'x@jagota.co.th', password: 'p' }, req);
    expect(Object.keys(res)).toEqual(expect.arrayContaining(['accessToken', 'role', 'mustChangePassword', 'refreshToken', 'expiresIn']));
  });

  it('RefreshTokenDto requires a non-empty string', async () => {
    expect(await validate(plainToInstance(RefreshTokenDto, {}))).not.toHaveLength(0);
    expect(await validate(plainToInstance(RefreshTokenDto, { refreshToken: '' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(RefreshTokenDto, { refreshToken: 123 }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(RefreshTokenDto, { refreshToken: 'x'.repeat(43) }))).toHaveLength(0);
  });
});
