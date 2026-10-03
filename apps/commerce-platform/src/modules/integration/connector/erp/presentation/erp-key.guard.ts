import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/**
 * Shared-secret guard for ERP → platform webhooks: header `X-ERP-Key` must equal
 * env `ERP_WEBHOOK_KEY` (same contract as josh's ErpKeyGuard, so nginx can
 * fail over between the two without the ERP changing anything).
 *
 * - key set + mismatch → 401
 * - key unset + NODE_ENV=production → 401 (fail closed: never run open in prod)
 * - key unset elsewhere → allowed with a warning (local dev)
 */
@Injectable()
export class ErpKeyGuard implements CanActivate {
  private readonly logger = new Logger(ErpKeyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ERP_WEBHOOK_KEY?.trim();
    if (!expected) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('ERP webhook not configured');
      }
      this.logger.warn('ERP_WEBHOOK_KEY not set — allowing ERP webhook (non-production only)');
      return true;
    }

    const header = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>()
      .headers?.['x-erp-key'];
    const provided = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('X-ERP-Key invalid or missing');
    }
    return true;
  }
}
