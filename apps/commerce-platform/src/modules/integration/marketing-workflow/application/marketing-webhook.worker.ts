import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import { deliveryBackoff, QUEUES } from '../../../../config/redis.config';
import { WebhookDelivery } from '../../webhook-subscription/infrastructure/webhook-delivery.entity';
import { secretIdsOf } from '../domain/template';
import type { WebhookMethod } from '../domain/workflow.types';
import { sendWebhook, WebhookSendError } from './webhook-send';
import { WebhookSecretsService } from './webhook-secrets.service';

/** ~15 minutes with deliveryBackoff (1s doubling, capped 60s) — external endpoints, not a platform catching up. */
export const MARKETING_WEBHOOK_MAX_ATTEMPTS = 20;

@Processor(QUEUES.MARKETING_WEBHOOK, { settings: { backoffStrategy: deliveryBackoff } })
export class MarketingWebhookWorker extends WorkerHost {
  constructor(
    @InjectRepository(WebhookDelivery) private readonly deliveries: Repository<WebhookDelivery>,
    private readonly secrets: WebhookSecretsService,
  ) { super(); }

  async process(job: Job<{ deliveryId: string }>): Promise<void> { await this.handle(job.data.deliveryId); }

  async handle(deliveryId: string): Promise<void> {
    const d = await this.deliveries.findOne({ where: { id: deliveryId, kind: 'marketing' } });
    if (!d || d.status !== 'pending') return;
    d.attempts += 1;
    try {
      const headers = d.headers ?? [];
      const ids = secretIdsOf(headers);
      if (ids.length && !this.secrets.configured()) throw new WebhookSendError('secret_key_missing', false);
      const res = await sendWebhook({ method: (d.method ?? 'POST') as WebhookMethod, url: d.targetUrl, headers,
        body: typeof d.payload === 'string' ? d.payload : null, deliveryId: d.id }, await this.secrets.resolve(ids));
      d.status = 'success'; d.statusCode = res.status; d.error = null;
      await this.deliveries.save(d);
    } catch (e) {
      const err = e instanceof WebhookSendError ? e : new WebhookSendError('send_failed', true);
      d.statusCode = err.status; d.error = err.code;
      if (!err.retryable || d.attempts >= MARKETING_WEBHOOK_MAX_ATTEMPTS) {
        d.status = 'failed';
        await this.deliveries.save(d);
        throw new UnrecoverableError(err.code);
      }
      await this.deliveries.save(d);
      throw err;
    }
  }
}
