import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import { Repository } from 'typeorm';
import { createHmac } from 'crypto';
import { WebhookDelivery } from '../infrastructure/webhook-delivery.entity';
import { WebhookSubscription } from '../infrastructure/webhook-subscription.entity';
import { DELIVERY_MAX_ATTEMPTS, deliveryBackoff, QUEUES } from '../../../../config/redis.config';
import { PORTAL_EVENT_TYPES } from '../../../../portal/webhooks/event-catalog';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Performs the outbound HTTP POST to a subscriber's URL, signing the body with
 * the subscription secret (x-signature: HMAC-SHA256). Non-2xx or network errors
 * are retried with backoff by BullMQ; the delivery row records the outcome.
 */
@Processor(QUEUES.WEBHOOK_OUT, { settings: { backoffStrategy: deliveryBackoff } })
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
    // Marketing webhook rows have their own queue/worker (marketing-workflow module); never send them from here.
    if (delivery.kind === 'marketing') return;
    if (delivery.status === 'success' || delivery.status === 'superseded') return;
    if (await this.isSuperseded(delivery)) {
      // Sending an older snapshot after (or instead of) a newer one would roll
      // the subscriber back (e.g. stock 50 overwriting 48) — drop it instead.
      delivery.status = 'superseded';
      await this.deliveries.save(delivery);
      return;
    }
    const sub = await this.subs.findOne({ where: { id: delivery.subscriptionId } });

    // Deliveries queued before a catalog change (including manual retries) must
    // respect the current portal allowlist before any payload leaves the app.
    if (sub?.accountId && !PORTAL_EVENT_TYPES.has(delivery.eventType)) {
      delivery.status = 'failed';
      delivery.error = 'Event type is not available to portal webhooks';
      await this.deliveries.save(delivery);
      throw new UnrecoverableError(delivery.error);
    }

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
      if (delivery.attempts >= DELIVERY_MAX_ATTEMPTS) {
        delivery.status = 'failed';
        this.logger.error(`Delivery ${delivery.id} failed after ${delivery.attempts} attempts`);
      }
      await this.deliveries.save(delivery);
      throw error;
    }
  }

  /**
   * Latest-wins events: skip this one when a newer delivery for the same aggregate
   * already landed OR is still waiting its turn (it carries the newer value). In a
   * burst for one SKU only the last value goes out; order is kept because the
   * queue is FIFO and anything older than what was sent is dropped.
   * A newer delivery that failed for good does not count — this one still goes.
   */
  private async isSuperseded(delivery: WebhookDelivery): Promise<boolean> {
    const envelope = delivery.payload as { snapshot?: boolean; aggregateId?: string | null } | null;
    if (!envelope?.snapshot || !envelope.aggregateId) return false;
    const newer = await this.deliveries
      .createQueryBuilder('d')
      .where('d.subscription_id = :sub', { sub: delivery.subscriptionId })
      .andWhere('d.event_type = :type', { type: delivery.eventType })
      // matches the partial index ix_webhook_deliveries_snapshot_agg
      .andWhere(`d.payload ->> 'snapshot' = 'true'`)
      .andWhere(`d.payload ->> 'aggregateId' = :agg`, { agg: envelope.aggregateId })
      // compare in the DB: a JS Date drops the microseconds, and the row would look newer than itself
      .andWhere('d.created_at > (SELECT created_at FROM webhook_deliveries WHERE id = :id)', { id: delivery.id })
      .andWhere('d.status IN (:...live)', { live: ['pending', 'success'] })
      .getExists();
    return newer;
  }
}
