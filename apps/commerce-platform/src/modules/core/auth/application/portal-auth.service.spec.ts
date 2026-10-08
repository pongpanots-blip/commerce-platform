import { PortalAuthService } from './portal-auth.service';

function makeService(existing: unknown = null) {
  const users = {
    findOne: jest.fn().mockResolvedValue(existing),
    save: jest.fn().mockImplementation(async (r) => ({ id: 'u1', ...r })),
    create: (r: unknown) => r,
  };
  const sessions = {
    issueSession: jest.fn(async (user: { role: string; mustChangePassword?: boolean }) => ({
      accessToken: 'jwt-token', role: user.role, mustChangePassword: !!user.mustChangePassword, refreshToken: 'refresh-token', expiresIn: 900, refreshExpiresIn: 2592000,
    })),
    refresh: jest.fn(async () => ({ accessToken: 'jwt-2' })),
    logout: jest.fn(async () => ({ ok: true })),
  };
  return { service: new PortalAuthService(users as never, sessions as never), users, sessions };
}

describe('PortalAuthService', () => {
  afterEach(() => { process.env.NODE_ENV = 'test'; delete process.env.PORTAL_JWT_SECRET; });

  it('register hashes the password with bcrypt and stores role developer', async () => {
    const { service, users } = makeService();
    const res = await service.register('Dev@Example.com', 'secret123');
    expect(res).toEqual({ accountId: 'u1', email: 'dev@example.com' });
    const saved = users.save.mock.calls[0][0] as Record<string, string>;
    expect(saved.email).toBe('dev@example.com');
    expect(saved.role).toBe('developer');
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
    expect(saved.passwordHash).not.toContain('secret123');
  });

  it('register 409s on an existing email', async () => {
    const { service } = makeService({ id: 'u1', email: 'dev@example.com' });
    await expect(service.register('dev@example.com', 'secret123')).rejects.toThrow('already registered');
  });

  it('login verifies bcrypt and returns the old fields plus a refresh pair (portal audience by default)', async () => {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('secret123', 10);
    const { service, sessions } = makeService({ id: 'u1', email: 'dev@example.com', role: 'developer', passwordHash, status: 'active' });
    const res = await service.login('dev@example.com', 'secret123');
    expect(res).toMatchObject({ accessToken: 'jwt-token', role: 'developer', mustChangePassword: false });
    expect(res).toMatchObject({ refreshToken: 'refresh-token', expiresIn: 900 });
    expect(sessions.issueSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', role: 'developer' }), 'portal', {});
  });

  it('staff login: a non-staff account is 403 and gets no refresh token; staff get the staff audience', async () => {
    const { ForbiddenException } = await import('@nestjs/common');
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('secret123', 10);
    const dev = makeService({ id: 'u1', email: 'dev@example.com', role: 'developer', passwordHash, status: 'active' });
    await expect(dev.service.login('dev@example.com', 'secret123', 'staff')).rejects.toBeInstanceOf(ForbiddenException);
    expect(dev.sessions.issueSession).not.toHaveBeenCalled();
    const staff = makeService({ id: 'u2', email: 'mer@jagota.co.th', role: 'merchandising', passwordHash, status: 'active', mustChangePassword: true });
    await expect(staff.service.login('mer@jagota.co.th', 'secret123', 'staff', { ip: '10.0.0.1' })).resolves.toMatchObject({ role: 'merchandising', mustChangePassword: true });
    expect(staff.sessions.issueSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }), 'staff', { ip: '10.0.0.1' });
  });

  it('refresh and logout go to the refresh-token service with the audience', async () => {
    const { service, sessions } = makeService();
    await service.refresh('rt', 'staff');
    await service.logout('rt', 'portal');
    expect(sessions.refresh).toHaveBeenCalledWith('rt', 'staff', {});
    expect(sessions.logout).toHaveBeenCalledWith('rt', 'portal');
  });

  it('staff login accepts a stored sale_manager alias (the session service issues the canonical role)', async () => {
    const { service, sessions } = makeService();
    jest.spyOn(service, 'verifyCredentials').mockResolvedValue({ id: 'u1', email: 'rep@example.test', role: ' SALE_MANAGER ' } as never);
    await expect(service.login('rep@example.test', 'test-password', 'staff')).resolves.toBeDefined();
    expect(sessions.issueSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'staff', {});
  });

  it('login 401s on wrong password or unknown email', async () => {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('secret123', 10);
    const { service } = makeService({ id: 'u1', email: 'dev@example.com', passwordHash, status: 'active' });
    await expect(service.login('dev@example.com', 'nope')).rejects.toThrow('invalid credentials');
    const empty = makeService(null);
    await expect(empty.service.login('ghost@example.com', 'x')).rejects.toThrow('invalid credentials');
  });

  it('login runs a dummy bcrypt compare on unknown email (timing equalization)', async () => {
    // Spy on the raw CJS module: the service's tslib __importStar wrapper
    // reads it through dynamic getters, so the spy is observed there too.
    const bcrypt = jest.requireActual<typeof import('bcrypt')>('bcrypt');
    const compareSpy = jest.spyOn(bcrypt, 'compare');
    try {
      const { service } = makeService(null);
      await expect(service.login('ghost@example.com', 'whatever1')).rejects.toThrow('invalid credentials');
      expect(compareSpy).toHaveBeenCalled();
    } finally {
      compareSpy.mockRestore();
    }
  });

  it('register maps a duplicate-key race on save to 409 already registered', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const { service, users } = makeService(null);
    users.save.mockRejectedValue(Object.assign(
      new Error('duplicate key value violates unique constraint "IDX_users_email"'),
      { code: '23505' },
    ));
    await expect(service.register('dev@example.com', 'secret123')).rejects.toThrow('already registered');
    users.save.mockRejectedValue(Object.assign(
      new Error('duplicate key value violates unique constraint "IDX_users_email"'),
      { code: '23505' },
    ));
    await expect(service.register('dev@example.com', 'secret123')).rejects.toBeInstanceOf(ConflictException);
  });

  it('register rejects in production when PORTAL_JWT_SECRET unset', async () => {
    process.env.NODE_ENV = 'production';
    const { service } = makeService();
    await expect(service.register('a@b.co', 'secret123')).rejects.toThrow('PORTAL_JWT_SECRET');
  });
});
