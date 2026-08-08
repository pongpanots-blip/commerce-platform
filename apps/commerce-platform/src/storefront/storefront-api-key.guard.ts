import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ApiKeyService } from '../modules/core/api-key/application/api-key.service';

const CACHE_TTL_MS = 30_000;

/**
 * Storefront auth, DB-first: api_keys lookup (30s positive cache, throttled
 * lastUsedAt) → env STOREFRONT_API_KEYS fallback (bootstrap/e2e) → 401.
 * Fail-open (non-production, no env) applies ONLY while NO api_keys row of
 * any kind exists — the moment a key is ever issued (even later revoked),
 * the surface fails closed for good.
 */
@Injectable()
export class StorefrontApiKeyGuard implements CanActivate {
  private static warned = false;
  private readonly logger = new Logger(StorefrontApiKeyGuard.name);
  private readonly cache = new Map<string, { keyId: string; expires: number; touched: number }>();

  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const provided = context.switchToHttp().getRequest().headers['x-api-key'];

    if (typeof provided === 'string' && provided) {
      const cached = this.cache.get(provided);
      if (cached) {
        if (cached.expires > Date.now()) {
          this.maybeTouch(provided, cached);
          return true;
        }
        this.cache.delete(provided); // evict expired entry; re-validate below
      }
      const row = await this.apiKeys.validate(provided);
      if (row) {
        this.cache.set(provided, { keyId: row.id, expires: Date.now() + CACHE_TTL_MS, touched: 0 });
        this.maybeTouch(provided, this.cache.get(provided)!);
        return true;
      }
      const envKeys = this.envKeys();
      if (envKeys.includes(provided)) return true;
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
    return true;
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
