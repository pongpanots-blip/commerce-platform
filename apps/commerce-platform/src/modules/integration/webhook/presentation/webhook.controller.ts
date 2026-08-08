import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookReceiverService } from '../application/webhook-receiver.service';

/**
 * Generic webhook entrypoint. Thin by design: hands raw body + headers to the
 * receiver, which verifies, stores, and enqueues. Returns fast.
 */
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly receiver: WebhookReceiverService) {}

  @Get()
  list() {
    return this.receiver.list();
  }

  @Get('events/:id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.receiver.getOne(id);
  }

  // `ref` is either the integration UUID or its webhook slug (e.g. "shopify"),
  // giving each platform a clean URL: POST /webhooks/shopify
  @Post(':ref')
  @HttpCode(200)
  async receive(
    @Param('ref') ref: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string>,
  ) {
    const rawBody = req.rawBody
      ? req.rawBody.toString('utf8')
      : JSON.stringify(req.body ?? {});
    const signature = headers['x-signature'];
    const saved = await this.receiver.receive(ref, headers, rawBody, signature);
    return { id: saved.id, status: saved.status };
  }

  @Post('replay/:webhookEventId')
  @HttpCode(202)
  async replay(@Param('webhookEventId', ParseUUIDPipe) webhookEventId: string) {
    await this.receiver.replay(webhookEventId);
    return { replayed: webhookEventId };
  }
}
