import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StorefrontApiKeyGuard } from './storefront-api-key.guard';
import { TRUSTED_STOREFRONT_KEY, TrustedStorefrontKey } from './trusted-storefront-key';
import { StorefrontCatalogController } from './catalog/storefront-catalog.controller';
import { StorefrontCheckoutController } from './checkout/storefront-checkout.controller';
import { StorefrontCustomersController } from './customers/storefront-customers.controller';
import { StorefrontOrdersController } from './orders/storefront-orders.controller';
import { WinbackLoginController } from '../modules/integration/winback/winback-login.controller';
import { DbdRelayController } from '../modules/integration/connector/josh/dbd-relay.controller';
import { JagotaGatewayController } from '../modules/integration/connector/josh/jagota/jagota-gateway.controller';
import { JoshOrderPlacedController } from '../modules/integration/connector/josh/orders/josh-order-copy.controller';
import { CsCrmRelayController } from '../modules/integration/connector/erp/presentation/cs-crm-relay.controller';

class CatalogLike { list() { return 'open'; } }
@TrustedStorefrontKey()
class JoshOnly { upsert() { return 'josh'; } }

function ctxWithKey(key?: string, cls: { prototype: object } = CatalogLike, request: Record<string, unknown> = {}) {
  const handler = Object.values(Object.getOwnPropertyDescriptors(cls.prototype)).find((d) => d.value !== cls)?.value;
  Object.assign(request, { headers: key ? { 'x-api-key': key } : {} });
  return { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => handler, getClass: () => cls } as never;
}

function makeGuard(opts: { dbRow?: unknown; hasAny?: boolean } = {}) {
  const apiKeys = {
    validate: jest.fn().mockResolvedValue(opts.dbRow ?? null),
    hasAnyKeys: jest.fn().mockResolvedValue(opts.hasAny ?? false),
    touchLastUsed: jest.fn().mockResolvedValue(undefined),
  };
  return { guard: new StorefrontApiKeyGuard(apiKeys as never, new Reflector()), apiKeys };
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

describe('StorefrontApiKeyGuard — trusted keys on josh-only routes', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    (StorefrontApiKeyGuard as unknown as { untrustedLogged: Map<string, number> }).untrustedLogged.clear();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
    for (const k of ['STOREFRONT_API_KEYS', 'STOREFRONT_TRUSTED_KEY_IDS', 'STOREFRONT_TRUSTED_KEYS_MODE']) delete process.env[k];
    process.env.NODE_ENV = 'test';
  });

  it('attaches which key matched: DB row id, or "env"', async () => {
    const db = makeGuard({ dbRow: { id: 'k1', active: true } });
    const req1: Record<string, unknown> = {};
    await db.guard.canActivate(ctxWithKey('ck_live_x', CatalogLike, req1));
    expect(req1.storefrontKey).toEqual({ source: 'db', id: 'k1' });
    process.env.STOREFRONT_API_KEYS = 'josh-env-key';
    const env = makeGuard();
    const req2: Record<string, unknown> = {};
    await env.guard.canActivate(ctxWithKey('josh-env-key', JoshOnly, req2));
    expect(req2.storefrontKey).toEqual({ source: 'env', id: 'env' });
  });

  it('env key is trusted on a josh-only route, even in enforce mode', async () => {
    process.env.STOREFRONT_API_KEYS = 'josh-env-key';
    process.env.STOREFRONT_TRUSTED_KEYS_MODE = 'enforce';
    const { guard } = makeGuard();
    await expect(guard.canActivate(ctxWithKey('josh-env-key', JoshOnly))).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('DB key listed in STOREFRONT_TRUSTED_KEY_IDS is trusted in enforce mode (also from the cache)', async () => {
    process.env.STOREFRONT_TRUSTED_KEY_IDS = 'other, josh-key-id ';
    process.env.STOREFRONT_TRUSTED_KEYS_MODE = 'enforce';
    const { guard } = makeGuard({ dbRow: { id: 'josh-key-id', active: true } });
    await expect(guard.canActivate(ctxWithKey('ck_live_josh', JoshOnly))).resolves.toBe(true);
    await expect(guard.canActivate(ctxWithKey('ck_live_josh', JoshOnly))).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warn mode (default): untrusted DB key is allowed, logged once per key id per hour with the id only', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(0);
      process.env.STOREFRONT_TRUSTED_KEY_IDS = 'josh-key-id';
      const { guard } = makeGuard({ dbRow: { id: 'portal-key-id', active: true } });
      await expect(guard.canActivate(ctxWithKey('ck_live_secret123', JoshOnly))).resolves.toBe(true);
      await expect(guard.canActivate(ctxWithKey('ck_live_secret123', JoshOnly))).resolves.toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain('id=portal-key-id');
      expect(line).toContain('JoshOnly.upsert');
      expect(line).not.toContain('ck_live_secret123');
      jest.setSystemTime(3600_000);
      await guard.canActivate(ctxWithKey('ck_live_secret123', JoshOnly));
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('enforce mode: untrusted DB key gets 403 on a josh-only route', async () => {
    process.env.STOREFRONT_TRUSTED_KEYS_MODE = 'enforce';
    const { guard } = makeGuard({ dbRow: { id: 'portal-key-id', active: true } });
    await expect(guard.canActivate(ctxWithKey('ck_live_x', JoshOnly))).rejects.toThrow('trusted API key');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('catalog route: untrusted DB key passes in enforce mode, nothing logged', async () => {
    process.env.STOREFRONT_TRUSTED_KEYS_MODE = 'enforce';
    const { guard } = makeGuard({ dbRow: { id: 'portal-key-id', active: true } });
    await expect(guard.canActivate(ctxWithKey('ck_live_x', CatalogLike))).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keyless non-production bootstrap stays open on josh-only routes', async () => {
    process.env.STOREFRONT_TRUSTED_KEYS_MODE = 'enforce';
    const { guard } = makeGuard({ hasAny: false });
    await expect(guard.canActivate(ctxWithKey(undefined, JoshOnly))).resolves.toBe(true);
  });

  it('classification: every non-catalog storefront route is josh-only; catalog is open', () => {
    const r = new Reflector();
    const marked = (cls: { prototype: object }, method?: string) =>
      !!r.getAllAndOverride<boolean>(TRUSTED_STOREFRONT_KEY,
        [method ? (cls.prototype as Record<string, () => unknown>)[method] : () => undefined, cls as never]);
    expect(marked(StorefrontCatalogController, 'list')).toBe(false);
    expect(marked(StorefrontCatalogController, 'byId')).toBe(false);
    for (const cls of [StorefrontCheckoutController, StorefrontCustomersController, StorefrontOrdersController,
      WinbackLoginController, DbdRelayController, JagotaGatewayController, JoshOrderPlacedController]) {
      expect([cls.name, marked(cls)]).toEqual([cls.name, true]);
    }
    expect(marked(CsCrmRelayController, 'toCsCrm')).toBe(true);
    expect(marked(CsCrmRelayController, 'kyc')).toBe(false); // own secret guard, not a storefront key
  });
});
