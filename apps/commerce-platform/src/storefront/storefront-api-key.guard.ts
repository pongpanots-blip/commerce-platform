import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyService } from '../modules/core/api-key/application/api-key.service';
import { StorefrontKeyMatch, TRUSTED_STOREFRONT_KEY, trustedKeyIds, trustedKeysEnforced } from './trusted-storefront-key';

const CACHE_TTL_MS = 30_000;
const UNTRUSTED_LOG_EVERY_MS = 3600_000;

/**
 * Storefront auth, DB-first: api_keys lookup (30s positive cache, throttled
 * lastUsedAt) → env STOREFRONT_API_KEYS fallback (bootstrap/e2e) → 401.
 * Fail-open (non-production, no env) applies ONLY while NO api_keys row of
 * any kind exists — the moment a key is ever issued (even later revoked),
 * the surface fails closed for good.
 * The matched key goes on `request.storefrontKey`; a @TrustedStorefrontKey() route then also needs a trusted key
 * (see trusted-storefront-key.ts).
 */
@Injectable()
export class StorefrontApiKeyGuard implements CanActivate {
  private static warned = false;
  /** Untrusted key id → last log time; static because several modules each get their own guard instance. */
  private static readonly untrustedLogged = new Map<string, number>();
  private readonly logger = new Logger(StorefrontApiKeyGuard.name);
  private readonly cache = new Map<string, { keyId: string; expires: number; touched: number }>();

  constructor(private readonly apiKeys: ApiKeyService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown>; storefrontKey?: StorefrontKeyMatch }>();
    const provided = request.headers['x-api-key'];
    const match = await this.authenticate(typeof provided === 'string' ? provided : undefined);
    request.storefrontKey = match;
    if (this.reflector.getAllAndOverride<boolean>(TRUSTED_STOREFRONT_KEY, [context.getHandler(), context.getClass()])) {
      this.checkTrusted(context, match, provided);
    }
    return true;
  }

  private async authenticate(provided: string | undefined): Promise<StorefrontKeyMatch> {
    if (provided) {
      const cached = this.cache.get(provided);
      if (cached) {
        if (cached.expires > Date.now()) {
          this.maybeTouch(provided, cached);
          return { source: 'db', id: cached.keyId };
        }
        this.cache.delete(provided); // evict expired entry; re-validate below
      }
      const row = await this.apiKeys.validate(provided);
      if (row) {
        this.cache.set(provided, { keyId: row.id, expires: Date.now() + CACHE_TTL_MS, touched: 0 });
        this.maybeTouch(provided, this.cache.get(provided)!);
        return { source: 'db', id: row.id };
      }
      const envKeys = this.envKeys();
      if (envKeys.includes(provided)) return { source: 'env', id: 'env' };
      throw new UnauthorizedException('invalid storefront API key');
    }

    // No key supplied:
    if (this.envKeys().length) throw new UnauthorizedException('storefront API key required');
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('storefront API key required');
    }
    if (await this.apiKeys.hasAnyKeys()) {
      throw new UnauthorizedException('storefront API key required');
    }
    if (!StorefrontApiKeyGuard.warned) {
      this.logger.warn('no API keys configured — storefront OPEN (non-production bootstrap only)');
      StorefrontApiKeyGuard.warned = true;
    }
    return { source: 'open', id: null };
  }

  /** env keys and the keyless dev bootstrap are trusted; a DB key only when its id is in STOREFRONT_TRUSTED_KEY_IDS. */
  private checkTrusted(context: ExecutionContext, match: StorefrontKeyMatch, provided: unknown): void {
    if (match.source !== 'db' || trustedKeyIds().includes(match.id)) return;
    if (typeof provided === 'string' && this.envKeys().includes(provided)) return; // same key also listed in env
    const enforce = trustedKeysEnforced();
    const now = Date.now();
    const last = StorefrontApiKeyGuard.untrustedLogged.get(match.id);
    if (last === undefined || now - last >= UNTRUSTED_LOG_EVERY_MS) {
      StorefrontApiKeyGuard.untrustedLogged.set(match.id, now);
      this.logger.warn(`untrusted storefront key id=${match.id} on ${context.getClass().name}.${context.getHandler().name}: `
        + (enforce ? 'refused (STOREFRONT_TRUSTED_KEYS_MODE=enforce)' : 'allowed (warn mode); add the id to STOREFRONT_TRUSTED_KEY_IDS before enforce'));
    }
    if (enforce) throw new ForbiddenException('this storefront route needs a trusted API key');
  }

  private maybeTouch(key: string, entry: { keyId: string; touched: number }): void {
    const now = Date.now();
    if (now - entry.touched > CACHE_TTL_MS) {
      entry.touched = now;
      void this.apiKeys.touchLastUsed(entry.keyId).catch(() => undefined);
    }
  }

  private envKeys(): string[] {
    return (process.env.STOREFRONT_API_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  }
}
