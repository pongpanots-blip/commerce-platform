import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminWriteGuard } from './admin-write.guard';
import { WinbackStaffIdentityService } from './winback-staff-identity.service';
import { WinbackRequest, winbackActorOf } from './winback-actor';
import { WinbackAppRoleGuard } from '../winback-app-role.guard';
import { acceptsJoshJwt } from './winback.config';
import { WinbackController } from '../winback.controller';
import { COMMERCE_JWT_ISSUER } from '../../../../shared-kernel/presentation/jwt-issuer';
import { winbackTokenKind } from './admin-write.guard';

const COMMERCE = '11111111-1111-4111-8111-111111111111';
const JOSH = '22222222-2222-4222-8222-222222222222';
const context = (req: unknown) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;
const saved = { ...process.env };
// Real shapes: commerce signs { sub, email, role } with iss (AuthModule signOptions); josh signs { sub, email, role,
// companyId, tokenVersion } with no iss. `legacy` = a commerce token signed before iss was added.
const token = (source: 'commerce' | 'josh' | 'legacy', extra: Record<string, unknown> = {}, secret?: string) =>
  new JwtService({ secret: secret ?? (source === 'josh' ? 'josh-test' : 'commerce-test') }).sign(
    source === 'josh' ? { sub: JOSH, role: 'sale', email: 'test@example.test', companyId: null, tokenVersion: 0, ...extra }
      : { sub: COMMERCE, role: 'sale', email: 'test@example.test', ...extra },
    source === 'commerce' ? { issuer: COMMERCE_JWT_ISSUER } : {});
function setup(row: Record<string, unknown> | null = {}, linked = false) {
  const db = { query: jest.fn(async (sql: string) => {
    if (sql.includes('FROM winback_staff_links')) return linked ? [{ josh_user_id: JOSH, commerce_user_id: COMMERCE }] : [];
    if (sql.includes('FROM users')) return row ? [{ id: COMMERCE, email: 'test@example.test', role: 'sale', status: 'active', must_change_password: false, ...row }] : [];
    if (sql.includes('FROM josh_staff')) return [{ token_version: 0, is_active: true, internal: true }];
    return [];
  }) };
  const guard = new AdminWriteGuard(db as never, new WinbackStaffIdentityService(db as never));
  const authenticate = async (value: string) => {
    const req: WinbackRequest & { headers: { authorization: string } } = { headers: { authorization: `Bearer ${value}` } };
    await guard.canActivate(context(req));
    return req;
  };
  return { guard, db, authenticate };
}

beforeEach(() => { process.env.PORTAL_JWT_SECRET = 'commerce-test'; process.env.JOSH_JWT_SECRET = 'josh-test'; delete process.env.WINBACK_ACCEPT_JOSH_JWT; });
afterEach(() => { process.env = { ...saved }; jest.restoreAllMocks(); });

it.each([
  ['sale', 'sale', false], ['sales_manager', 'sales_manager', true], ['sale_manager', 'sales_manager', true], ['admin', 'admin', true],
])('commerce row role %s decides the canonical actor', async (rowRole, role, isManager) => {
  const req = await setup({ role: rowRole }).authenticate(token('commerce', { role: 'admin' }));
  expect(req.user).toEqual({ sub: COMMERCE, email: 'test@example.test', role, source: 'commerce' });
  expect(winbackActorOf(req)).toEqual({ id: COMMERCE, email: 'test@example.test', role, source: 'commerce', isManager });
  expect(new WinbackAppRoleGuard().canActivate(context(req))).toBe(true);
  const controller = new WinbackController(...Array(14).fill({}) as ConstructorParameters<typeof WinbackController>);
  expect(controller.me(req)).toMatchObject({ id: COMMERCE, salesUserId: COMMERCE, role, isManager, source: 'commerce' });
});

it.each(['marketing', 'cs', 'developer', 'merchandising', 'graphic', 'business_analyst'])('forbids commerce row role %s', async role => {
  await expect(setup({ role }).authenticate(token('commerce'))).rejects.toThrow('เฉพาะทีมขายที่ใช้งานส่วนนี้ได้');
});
it('forbids a developer JWT even when the row became admin', async () => {
  await expect(setup({ role: 'admin' }).authenticate(token('commerce', { role: 'developer' }))).rejects.toBeInstanceOf(ForbiddenException);
});
it.each([{ status: 'disabled' }, null])('disabled or removed commerce account is a 401: %j', async row => {
  await expect(setup(row).authenticate(token('commerce'))).rejects.toBeInstanceOf(UnauthorizedException);
});
it('password-change requirement has the same code as the staff guard', async () => {
  await expect(setup({ must_change_password: true }).authenticate(token('commerce'))).rejects.toMatchObject({ response: { code: 'PASSWORD_CHANGE_REQUIRED' } });
});
it('reads commerce account status on every request', async () => {
  const account = { status: 'active' };
  const svc = setup(account);
  await svc.authenticate(token('commerce'));
  account.status = 'disabled';
  await expect(svc.authenticate(token('commerce'))).rejects.toBeInstanceOf(UnauthorizedException);
  expect(svc.db.query.mock.calls.filter(([sql]) => sql.includes('FROM users'))).toHaveLength(2);
});
it.each(['purpose', 'typ'])('rejects commerce %s claims without falling back', async claim => {
  const svc = setup();
  await expect(svc.authenticate(token('commerce', { [claim]: 'refresh' }))).rejects.toBeInstanceOf(UnauthorizedException);
  expect(svc.db.query).not.toHaveBeenCalled();
});
it('expired commerce tokens never reach Josh verification or DB queries', async () => {
  const spy = jest.spyOn(JwtService.prototype, 'verifyAsync');
  const svc = setup();
  await expect(svc.authenticate(token('commerce', { exp: 1 }))).rejects.toBeInstanceOf(UnauthorizedException);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(svc.db.query).not.toHaveBeenCalled();
});
it('refuses production verification with a missing portal secret', async () => {
  process.env.NODE_ENV = 'production'; delete process.env.PORTAL_JWT_SECRET;
  await expect(setup().authenticate(token('josh'))).rejects.toThrow('staff auth unavailable');
});
it.each([true, false])('legacy Josh uses the same actor shape, linked=%s', async linked => {
  const req = await setup({}, linked).authenticate(token('josh'));
  expect(req.winbackActor).toEqual({ id: linked ? COMMERCE : JOSH, joshId: JOSH, email: 'test@example.test', role: 'sale', isManager: false, source: 'josh' });
  expect(req.user).toEqual({ sub: linked ? COMMERCE : JOSH, email: 'test@example.test', role: 'sale', source: 'josh' });
});
it('commerce carries its linked Josh id while keeping its canonical id', async () => {
  expect((await setup({}, true).authenticate(token('commerce'))).winbackActor).toMatchObject({ id: COMMERCE, joshId: JOSH });
});
it.each(['false', '0', 'off', ' OFF ', ' FaLsE '])('legacy off=%s refuses Josh before querying', async value => {
  process.env.WINBACK_ACCEPT_JOSH_JWT = value;
  const svc = setup();
  expect(acceptsJoshJwt()).toBe(false);
  await expect(svc.authenticate(token('josh'))).rejects.toThrow('commerce staff account');
  expect(svc.db.query).not.toHaveBeenCalled();
});
it.each(['true', '1', 'on', ''])('legacy remains enabled for %s', value => {
  process.env.WINBACK_ACCEPT_JOSH_JWT = value;
  expect(acceptsJoshJwt()).toBe(true);
});
it.each(['commerce', 'josh'] as const)('app role gate uses canonical roles from %s', source => {
  for (const role of ['sale', 'sales', 'manager', 'sales_manager', 'sale_manager', 'admin', 'platform_admin']) {
    expect(new WinbackAppRoleGuard().canActivate(context({ winbackActor: { id: COMMERCE, role, source, isManager: false } }))).toBe(true);
  }
  expect(() => new WinbackAppRoleGuard().canActivate(context({ winbackActor: { id: COMMERCE, role: 'marketing', source } }))).toThrow(ForbiddenException);
});

describe('issuer routing: a token is verified only with the secret of the issuer it names', () => {
  const unsigned = (header: object, payload: object) =>
    [header, payload].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.sig';

  it('classifies by iss / josh shape from the unverified token', () => {
    expect(winbackTokenKind(token('commerce'))).toBe('commerce');
    expect(winbackTokenKind(token('josh'))).toBe('josh');
    expect(winbackTokenKind(token('legacy'))).toBe('commerce-legacy');
    expect(winbackTokenKind(unsigned({ alg: 'HS256' }, { sub: JOSH, tokenVersion: 3 }))).toBe('josh');
    expect(winbackTokenKind(unsigned({ alg: 'HS256' }, { sub: JOSH, companyId: null }))).toBe('josh');
    expect(() => winbackTokenKind(unsigned({ alg: 'HS256' }, { sub: JOSH, iss: 'someone-else' }))).toThrow('unknown token issuer');
    expect(() => winbackTokenKind(unsigned({ alg: 'none' }, { sub: COMMERCE, iss: COMMERCE_JWT_ISSUER }))).toThrow('unsupported token algorithm');
    expect(() => winbackTokenKind(unsigned({ alg: 'HS512' }, { sub: COMMERCE }))).toThrow('unsupported token algorithm');
    expect(() => winbackTokenKind('not-json.not-json.sig')).toThrow(UnauthorizedException);
  });

  describe('with EQUAL commerce and josh secrets', () => {
    beforeEach(() => { process.env.PORTAL_JWT_SECRET = 'same-secret'; process.env.JOSH_JWT_SECRET = 'same-secret'; });

    it('a josh token takes the josh path (josh_staff checks, never the commerce users row)', async () => {
      const svc = setup();
      const req = await svc.authenticate(token('josh', {}, 'same-secret'));
      expect(req.winbackActor).toMatchObject({ id: JOSH, source: 'josh' });
      const sqls = svc.db.query.mock.calls.map(([sql]) => sql as string);
      expect(sqls.some(sql => sql.includes('FROM josh_staff'))).toBe(true);
      expect(sqls.some(sql => /FROM users WHERE id/.test(sql))).toBe(false);
    });
    it('a commerce token takes the commerce path (users row, never josh_staff)', async () => {
      const svc = setup();
      const req = await svc.authenticate(token('commerce', {}, 'same-secret'));
      expect(req.winbackActor).toMatchObject({ id: COMMERCE, source: 'commerce' });
      expect(svc.db.query.mock.calls.some(([sql]) => (sql as string).includes('FROM josh_staff'))).toBe(false);
    });
    it('a pre-iss commerce token still takes the commerce path', async () => {
      expect((await setup().authenticate(token('legacy', {}, 'same-secret'))).winbackActor).toMatchObject({ id: COMMERCE, source: 'commerce' });
    });
    it.each(['commerce', 'legacy'] as const)('an expired %s token never falls back to josh', async kind => {
      const spy = jest.spyOn(JwtService.prototype, 'verifyAsync');
      const svc = setup();
      await expect(svc.authenticate(token(kind, { exp: 1 }, 'same-secret'))).rejects.toThrow('commerce token expired');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(svc.db.query).not.toHaveBeenCalled();
    });
    it('WINBACK_ACCEPT_JOSH_JWT=false rejects a josh token even though it would verify with the commerce secret', async () => {
      process.env.WINBACK_ACCEPT_JOSH_JWT = 'false';
      const svc = setup();
      await expect(svc.authenticate(token('josh', {}, 'same-secret'))).rejects.toThrow('commerce staff account');
      expect(svc.db.query).not.toHaveBeenCalled();
    });
  });

  it('a commerce-issuer token signed with the josh secret is refused, not re-tried as josh', async () => {
    const svc = setup();
    await expect(svc.authenticate(token('commerce', {}, 'josh-test'))).rejects.toThrow('invalid commerce token');
    expect(svc.db.query).not.toHaveBeenCalled();
  });
  it('a josh-shaped token signed with the commerce secret is refused on the josh path', async () => {
    const svc = setup();
    await expect(svc.authenticate(token('josh', {}, 'commerce-test'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(svc.db.query.mock.calls.some(([sql]) => /FROM users WHERE id/.test(sql as string))).toBe(false);
  });
  it('an unknown issuer is refused before any verification', async () => {
    const spy = jest.spyOn(JwtService.prototype, 'verifyAsync');
    await expect(setup().authenticate(new JwtService({ secret: 'commerce-test' }).sign({ sub: COMMERCE, role: 'sale' }, { issuer: 'other' }))).rejects.toThrow('unknown token issuer');
    expect(spy).not.toHaveBeenCalled();
  });
  it('WINBACK_ACCEPT_JOSH_JWT=false still accepts commerce tokens', async () => {
    process.env.WINBACK_ACCEPT_JOSH_JWT = 'false';
    expect((await setup().authenticate(token('commerce'))).winbackActor).toMatchObject({ source: 'commerce' });
  });
});
