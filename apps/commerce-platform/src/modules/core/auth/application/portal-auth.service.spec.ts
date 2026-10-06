import { PortalAuthService } from './portal-auth.service';

function makeService(existing: unknown = null) {
  const users = {
    findOne: jest.fn().mockResolvedValue(existing),
    save: jest.fn().mockImplementation(async (r) => ({ id: 'u1', ...r })),
    create: (r: unknown) => r,
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('jwt-token') };
  return { service: new PortalAuthService(users as never, jwt as never), users, jwt };
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

  it('login verifies bcrypt and signs a JWT with sub/email/role', async () => {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('secret123', 10);
    const { service, jwt } = makeService({ id: 'u1', email: 'dev@example.com', role: 'developer', passwordHash, status: 'active' });
    const res = await service.login('dev@example.com', 'secret123');
    expect(res).toEqual({ accessToken: 'jwt-token', role: 'developer', mustChangePassword: false });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', email: 'dev@example.com', role: 'developer' });
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
