import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { WinbackIntakeKeyGuard } from './winback-intake-key.guard';

function ctx(headers: Record<string, string | string[] | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/winback/intake/leads', headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('WinbackIntakeKeyGuard', () => {
  const originalKey = process.env.WINBACK_INTAKE_KEY;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.WINBACK_INTAKE_KEY = originalKey;
    process.env.NODE_ENV = originalEnv;
    if (originalKey === undefined) delete process.env.WINBACK_INTAKE_KEY;
  });

  it('allows a request whose key matches', () => {
    process.env.WINBACK_INTAKE_KEY = 'secret';
    expect(new WinbackIntakeKeyGuard().canActivate(ctx({ 'x-winback-key': 'secret' }))).toBe(true);
  });

  it('rejects a wrong key', () => {
    process.env.WINBACK_INTAKE_KEY = 'secret';
    expect(() => new WinbackIntakeKeyGuard().canActivate(ctx({ 'x-winback-key': 'nope' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing key', () => {
    process.env.WINBACK_INTAKE_KEY = 'secret';
    expect(() => new WinbackIntakeKeyGuard().canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it('fails closed in production when the env var is unset', () => {
    delete process.env.WINBACK_INTAKE_KEY;
    process.env.NODE_ENV = 'production';
    expect(() => new WinbackIntakeKeyGuard().canActivate(ctx({ 'x-winback-key': 'anything' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('allows in development when the env var is unset', () => {
    delete process.env.WINBACK_INTAKE_KEY;
    process.env.NODE_ENV = 'development';
    expect(new WinbackIntakeKeyGuard().canActivate(ctx({}))).toBe(true);
  });
});
