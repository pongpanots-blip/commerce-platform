import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import { createHmac } from 'crypto';
import { WebhookDelivery } from '../infrastructure/webhook-delivery.entity';
import { WebhookSubscription } from '../infrastructure/webhook-subscription.entity';
import { QUEUES } from '../../../../config/redis.config';

const MAX_ATTEMPTS = 5; // keep equal to RETRY_JOB_OPTIONS.attempts
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Performs the outbound HTTP POST to a subscriber's URL, signing the body with
 * the subscription secret (x-signature: HMAC-SHA256). Non-2xx or network errors
 * are retried with backoff by BullMQ; the delivery row records the outcome.
 */
@Processor(QUEUES.WEBHOOK_OUT)
export class WebhookDeliveryWorker extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveries: Repository<WebhookDelivery>,
    @InjectRepository(WebhookSubscription)
    private readonly subs: Repository<WebhookSubscription>,
  ) {
    super();
  }

  async process(job: Job<{ deliveryId: string }>): Promise<void> {
    await this.handle(job.data.deliveryId);
  }

  async handle(deliveryId: string): Promise<void> {
    const delivery = await this.deliveries.findOne({ where: { id: deliveryId } });
    if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
    if (delivery.status === 'success' || delivery.status === 'superseded') return;
    if (await this.isSuperseded(delivery)) {
      // Retrying an older snapshot after a newer one landed would roll the
      // subscriber back (e.g. stock 50 overwriting 48) — drop it instead.
      delivery.status = 'superseded';
      await this.deliveries.save(delivery);
      return;
    }
    const sub = await this.subs.findOne({ where: { id: delivery.subscriptionId } });

    const body = JSON.stringify(delivery.payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-event-type': delivery.eventType,
      'x-delivery-id': delivery.id,
    };
    if (sub?.secret) {
      headers['x-signature'] = createHmac('sha256', sub.secret).update(body).digest('hex');
    }

    delivery.attempts += 1;
    try {
      const res = await fetch(delivery.targetUrl, {
        method: 'POST', headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      delivery.statusCode = res.status;
      if (res.ok) {
        delivery.status = 'success';
        delivery.error = null;
        await this.deliveries.save(delivery);
        return;
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        // The subscriber rejected the payload itself — retrying won't change that.
        delivery.status = 'failed';
        delivery.error = `Target responded ${res.status} (not retried)`;
        await this.deliveries.save(delivery);
        throw new UnrecoverableError(delivery.error);
      }
      throw new Error(`Target responded ${res.status}`);
    } catch (error) {
      if (error instanceof UnrecoverableError) throw error;
      delivery.error = error instanceof Error ? error.message : String(error);
      if (delivery.attempts >= MAX_ATTEMPTS) {
        delivery.status = 'failed';
        this.logger.error(`Delivery ${delivery.id} failed after ${delivery.attempts} attempts`);
      }
      await this.deliveries.save(delivery);
      throw error;
    }
  }

  private async isSuperseded(delivery: WebhookDelivery): Promise<boolean> {
    const envelope = delivery.payload as { snapshot?: boolean; aggregateId?: string | null } | null;
    if (!envelope?.snapshot || !envelope.aggregateId) return false;
    // ponytail: jsonb lookup without an index — fine at today's volume; add an
    // expression index on (payload->>'aggregateId') if deliveries grow large.
    const newer = await this.deliveries
      .createQueryBuilder('d')
      .where('d.subscription_id = :sub', { sub: delivery.subscriptionId })
      .andWhere('d.event_type = :type', { type: delivery.eventType })
      .andWhere(`d.payload ->> 'aggregateId' = :agg`, { agg: envelope.aggregateId })
      .andWhere('d.status = :ok', { ok: 'success' })
      .andWhere('d.created_at > :at', { at: delivery.createdAt })
      .getCount();
    return newer > 0;
  }
}
