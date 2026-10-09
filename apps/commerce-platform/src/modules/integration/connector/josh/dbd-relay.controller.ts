import { BadRequestException, Controller, Get, Logger, Param, Res, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Repository } from 'typeorm';
import { Public } from '../../../../shared-kernel/presentation/auth.decorators';
import { StorefrontApiKeyGuard } from '../../../../storefront/storefront-api-key.guard';
import { TrustedStorefrontKey } from '../../../../storefront/trusted-storefront-key';
import { DbdLookup } from './dbd-lookup.entity';

/** josh gives DBD 2 s in total; leave it time to go direct if DBD is slow here. */
const DBD_TIMEOUT_MS = 1_500;
const FRESH_MS = 24 * 3600_000;

/**
 * DBD juristic-person lookup for josh onboarding (josh DBD_VIA_COMMERCE=true). Relays DBD's own
 * answer (status + JSON, marked `x-dbd-relay`) and keeps the last one per register number, so a
 * company looked up in the last 24 h is answered without DBD, and a DBD outage is answered from the
 * last copy. Anything else is answered WITHOUT the marker: josh then asks DBD directly.
 */
@Public()
@Controller('v1/storefront/dbd')
@UseGuards(StorefrontApiKeyGuard)
@TrustedStorefrontKey()
export class DbdRelayController {
  private readonly logger = new Logger(DbdRelayController.name);

  constructor(@InjectRepository(DbdLookup) private readonly lookups: Repository<DbdLookup>) {}

  @Get('juristic_person/:n')
  async lookup(@Param('n') n: string, @Res() res: Response) {
    if (!/^\d{13}$/.test(n)) throw new BadRequestException('13-digit juristic register number');
    const cached = await this.lookups.findOneBy({ registerNumber: n });
    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < FRESH_MS) return this.send(res, n, cached.httpStatus, cached.body);
    const base = (process.env.DBD_OPENAPI_BASE_URL?.trim() || 'https://openapi.dbd.go.th').replace(/\/$/, '');
    try {
      const r = await fetch(`${base}/api/v1/juristic_person/${n}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(DBD_TIMEOUT_MS) });
      if (r.status === 200 || r.status === 404) {
        const body = r.status === 200 ? await r.json() : null;
        await this.lookups.upsert({ registerNumber: n, httpStatus: r.status, body, fetchedAt: new Date() }, ['registerNumber']);
        return this.send(res, n, r.status, body);
      }
      // 403 / 429 are DBD's rate limit: josh shows its own "try again" for those — relay them as is.
      if (r.status === 403 || r.status === 429) return this.send(res, n, r.status, null);
      this.logger.warn(`DBD HTTP ${r.status} for ${n}`);
    } catch (error) {
      this.logger.warn(`DBD lookup failed for ${n}: ${error instanceof Error ? error.message : error}`);
    }
    if (cached) return this.send(res, n, cached.httpStatus, cached.body); // DBD down: the last answer beats none
    return res.status(502).json({ message: 'DBD did not answer' }); // no marker → josh goes direct
  }

  private send(res: Response, n: string, status: number, body: unknown) {
    res.setHeader('x-dbd-relay', '1');
    return res.status(status).json(body ?? { register_number: n });
  }
}
