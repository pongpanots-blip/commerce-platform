import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { PortalJwtGuard } from './portal-jwt.guard';

const TEST_SECRET = 'test-portal-secret';

function ctxWithHeader(header?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: header ? { authorization: header } : {} }),
    }),
  } as never;
}

function makeGuard() {
  const jwt = new JwtService({ secret: TEST_SECRET, signOptions: { expiresIn: '12h' } });
  return { guard: new PortalJwtGuard(jwt), jwt };
}

describe('PortalJwtGuard', () => {
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.PORTAL_JWT_SECRET;
    jest.restoreAllMocks();
  });

  it('accepts a valid bearer token and attaches request.portalAccount', async () => {
    const { guard, jwt } = makeGuard();
    const token = await jwt.signAsync({ sub: 'u1', email: 'dev@example.com', role: 'developer' });
    const request: { headers: Record<string, string>; portalAccount?: unknown } = {
      headers: { authorization: `Bearer ${token}` },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.portalAccount).toEqual({ accountId: 'u1', email: 'dev@example.com' });
  });

  it('rejects when the authorization header is missing', async () => {
    const { guard } = makeGuard();
    await expect(guard.canActivate(ctxWithHeader(undefined))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid or expired token', async () => {
    const { guard } = makeGuard();
    await expect(guard.canActivate(ctxWithHeader('Bearer not-a-real-token'))).rejects.toThrow(UnauthorizedException);
  });

  it('production without PORTAL_JWT_SECRET fails closed and never verifies the token', async () => {
    const { guard, jwt } = makeGuard();
    const token = await jwt.signAsync({ sub: 'u1', email: 'dev@example.com', role: 'developer' });
    process.env.NODE_ENV = 'production';
    delete process.env.PORTAL_JWT_SECRET;
    const verifySpy = jest.spyOn(jwt, 'verifyAsync');

    await expect(guard.canActivate(ctxWithHeader(`Bearer ${token}`))).rejects.toThrow('portal auth unavailable');
    expect(verifySpy).not.toHaveBeenCalled();
  });
});
