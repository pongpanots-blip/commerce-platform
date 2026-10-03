import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { StaffAuthGuard } from './staff-auth.guard';
import { IS_PUBLIC_KEY, STAFF_ROLES_KEY } from '../../../../shared-kernel/presentation/auth.decorators';

const jwt = new JwtService({ secret: 'test-secret' });

function ctx(opts: { token?: string; meta?: Record<string, unknown>; type?: string } = {}) {
  const request: Record<string, unknown> = {
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
  };
  const handler = () => undefined;
  Reflect.defineMetadata(IS_PUBLIC_KEY, opts.meta?.[IS_PUBLIC_KEY], handler);
  Reflect.defineMetadata(STAFF_ROLES_KEY, opts.meta?.[STAFF_ROLES_KEY], handler);
  const context = {
    getType: () => opts.type ?? 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

const sign = (role: string) => jwt.signAsync({ sub: 'u-1', email: 'a@b.c', role });

describe('StaffAuthGuard (global default-deny)', () => {
  const guard = new StaffAuthGuard(jwt, new Reflector());

  it('lets @Public() routes through without a token', async () => {
    await expect(guard.canActivate(ctx({ meta: { [IS_PUBLIC_KEY]: true } }).context)).resolves.toBe(true);
  });

  it('401 without a token on an unmarked route', async () => {
    await expect(guard.canActivate(ctx().context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 on a forged token', async () => {
    const forged = await new JwtService({ secret: 'other' }).signAsync({ sub: 'x', role: 'admin' });
    await expect(guard.canActivate(ctx({ token: forged }).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('403 for a portal developer token — same secret, wrong role', async () => {
    await expect(guard.canActivate(ctx({ token: await sign('developer') }).context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admin passes and is attached to the request', async () => {
    const { context, request } = ctx({ token: await sign('admin') });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.staff).toEqual({ userId: 'u-1', email: 'a@b.c', role: 'admin' });
  });

  it('marketing only where @StaffRoles("marketing") allows it', async () => {
    const token = await sign('marketing');
    await expect(guard.canActivate(ctx({ token }).context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx({ token, meta: { [STAFF_ROLES_KEY]: ['marketing'] } }).context)).resolves.toBe(true);
  });

  it('ignores non-HTTP contexts (workers, schedulers)', async () => {
    await expect(guard.canActivate(ctx({ type: 'rpc' }).context)).resolves.toBe(true);
  });
});
