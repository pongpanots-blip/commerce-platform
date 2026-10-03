import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Shared-secret guard for josh → commerce-platform internal API calls: header `X-Internal-Key`
 * must equal env `COMMERCE_INTERNAL_KEY` (timing-safe comparison).
 *
 * - key set + mismatch → 401
 * - key unset + NODE_ENV=production → 401 (fail closed: never run open in prod)
 * - key unset elsewhere → allowed with a warning (local dev)
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  private readonly logger = new Logger(InternalKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.COMMERCE_INTERNAL_KEY?.trim();
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Commerce internal key not configured');
      }
      this.logger.warn('COMMERCE_INTERNAL_KEY not set — allowing internal API (non-production only)');
      return true;
    }

    const header = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>()
      .headers?.['x-internal-key'];
    const provided = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('X-Internal-Key invalid or missing');
    }
    return true;
  }
}
