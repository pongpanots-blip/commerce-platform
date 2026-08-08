import { StorefrontApiKeyGuard } from './storefront-api-key.guard';

function ctxWithKey(key?: string) {
  return { switchToHttp: () => ({ getRequest: () =>
    ({ headers: key ? { 'x-api-key': key } : {} }) }) } as never;
}

function makeGuard(opts: { dbRow?: unknown; hasAny?: boolean } = {}) {
  const apiKeys = {
    validate: jest.fn().mockResolvedValue(opts.dbRow ?? null),
    hasAnyKeys: jest.fn().mockResolvedValue(opts.hasAny ?? false),
    touchLastUsed: jest.fn().mockResolvedValue(undefined),
  };
  return { guard: new StorefrontApiKeyGuard(apiKeys as never), apiKeys };
}

describe('StorefrontApiKeyGuard (DB-first)', () => {
  afterEach(() => { delete process.env.STOREFRONT_API_KEYS; process.env.NODE_ENV = 'test'; });

  it('accepts a DB key and touches lastUsedAt', async () => {
    const { guard, apiKeys } = makeGuard({ dbRow: { id: 'k1', active: true } });
    await expect(guard.canActivate(ctxWithKey('ck_live_x'))).resolves.toBe(true);
    expect(apiKeys.touchLastUsed).toHaveBeenCalledWith('k1');
  });

  it('caches a positive DB result (validate called once for repeat key)', async () => {
    const { guard, apiKeys } = makeGuard({ dbRow: { id: 'k1', active: true } });
    await guard.canActivate(ctxWithKey('ck_live_x'));
    await guard.canActivate(ctxWithKey('ck_live_x'));
    expect(apiKeys.validate).toHaveBeenCalledTimes(1);
  });

  it('evicts an expired cache entry (re-validates, no stale entry retained)', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(0);
      const { guard, apiKeys } = makeGuard({ dbRow: { id: 'k1', active: true } });
      await guard.canActivate(ctxWithKey('ck_live_x'));
      jest.setSystemTime(31_000); // past 30s TTL
      apiKeys.validate.mockResolvedValueOnce(null); // key revoked meanwhile
      await expect(guard.canActivate(ctxWithKey('ck_live_x'))).rejects.toThrow('API key');
      expect(apiKeys.validate).toHaveBeenCalledTimes(2);
      const cache = (guard as unknown as { cache: Map<string, unknown> }).cache;
      expect(cache.size).toBe(0); // stale entry deleted, nothing re-set on DB miss
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to env keys when DB misses', async () => {
    process.env.STOREFRONT_API_KEYS = 'legacy-key';
    const { guard } = makeGuard();
    await expect(guard.canActivate(ctxWithKey('legacy-key'))).resolves.toBe(true);
    await expect(guard.canActivate(ctxWithKey('wrong'))).rejects.toThrow('API key');
  });

  it('fail-open only while NO api_keys rows exist at all (non-production, no env)', async () => {
    const open = makeGuard({ hasAny: false });
    await expect(open.guard.canActivate(ctxWithKey(undefined))).resolves.toBe(true);
    const closed = makeGuard({ hasAny: true });
    await expect(closed.guard.canActivate(ctxWithKey(undefined))).rejects.toThrow('API key');
  });

  it('fail-closed even when every row is revoked/inactive — hasAnyKeys is true, not hasActiveKeys', async () => {
    // An all-revoked api_keys table must still close the keyless path: it counts
    // ALL rows, not just active:true ones (see ApiKeyService.hasAnyKeys).
    const { guard } = makeGuard({ hasAny: true });
    await expect(guard.canActivate(ctxWithKey(undefined))).rejects.toThrow('API key');
  });

  it('production without key always rejects', async () => {
    process.env.NODE_ENV = 'production';
    const { guard } = makeGuard({ hasAny: false });
    await expect(guard.canActivate(ctxWithKey(undefined))).rejects.toThrow('API key');
  });
});
