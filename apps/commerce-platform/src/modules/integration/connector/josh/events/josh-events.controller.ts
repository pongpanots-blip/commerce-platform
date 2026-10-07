import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../../../../shared-kernel/presentation/auth.decorators';
import { joshApiConfigured, postToJosh } from '../josh-api';
import { JoshEnvelope, JoshEventsService } from './josh-events.service';
import { verifyJoshSignature } from './josh-events.signature';

/** josh backfill groups (josh CommerceBackfillController). Stage 2c added the reference rows winback reads. */
const BACKFILL_GROUPS = ['order', 'customer', 'catalog', 'company', 'cuisine', 'restaurant_place', 'staff', 'branch', 'jagota_sync', 'push_campaign', 'marketing_workflow', 'promotion-rules', 'promotion-lock'];

/** josh → commerce events (spec 2026-10-06 §2.2). HMAC over the raw body; replays are harmless (version guard). */
@Public()
@Controller('internal/josh-events')
export class JoshEventsController {
  constructor(private readonly service: JoshEventsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-signature') signature: string | undefined) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    verifyJoshSignature(raw, signature);
    return { received: true, result: await this.service.apply(req.body as JoshEnvelope) };
  }
}

/** Staff (guard default): ask josh to resend every order, customer or catalog product through its outbox (spec §2.5). */
@Controller('reports/order-copy')
export class JoshBackfillController {
  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  backfill(@Body() body: { group?: string }) {
    if (!BACKFILL_GROUPS.includes(body?.group ?? '')) throw new BadRequestException(`group: ${BACKFILL_GROUPS.join(' | ')}`);
    if (!joshApiConfigured()) throw new ServiceUnavailableException('JOSH_API_URL / JOSH_EVENTS_SECRET not set');
    return postToJosh<{ enqueued: number }>('/internal/commerce/backfill', { group: body.group });
  }
}
