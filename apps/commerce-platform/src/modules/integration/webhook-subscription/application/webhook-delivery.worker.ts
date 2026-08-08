import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { createHmac } from 'crypto';
import { WebhookDelivery } from '../infrastructure/webhook-delivery.entity';
import { WebhookSubscription } from '../infrastructure/webhook-subscription.entity';
import { QUEUES } from '../../../../config/redis.config';

const MAX_ATTEMPTS = 5;

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
      const res = await fetch(delivery.targetUrl, { method: 'POST', headers, body });
      delivery.statusCode = res.status;
      if (res.ok) {
        delivery.status = 'success';
        delivery.error = null;
        await this.deliveries.save(delivery);
        return;
      }
      throw new Error(`Target responded ${res.status}`);
    } catch (error) {
      delivery.error = error instanceof Error ? error.message : String(error);
      if (delivery.attempts >= MAX_ATTEMPTS) {
        delivery.status = 'failed';
        this.logger.error(`Delivery ${delivery.id} failed after ${delivery.attempts} attempts`);
      }
      await this.deliveries.save(delivery);
      throw error;
    }
  }
}
