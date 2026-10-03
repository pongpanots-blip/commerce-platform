import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { WebhookDelivery } from '../infrastructure/webhook-delivery.entity';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { QUEUES, RETRY_JOB_OPTIONS } from '../../../../config/redis.config';

interface EmittedEvent {
  eventId?: string;
  type?: string;
  aggregateId?: string;
  payload?: unknown;
  metadata?: { snapshot?: boolean };
}

/**
 * Bridges internal domain events to OUTBOUND webhooks. Listens to every domain
 * event, finds subscriptions that want it, records a pending delivery, and
 * enqueues the actual HTTP POST (handled by the delivery worker).
 */
@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(
    private readonly subscriptions: WebhookSubscriptionService,
    @InjectRepository(WebhookDelivery)
    private readonly deliveries: Repository<WebhookDelivery>,
    @InjectQueue(QUEUES.WEBHOOK_OUT) private readonly queue: Queue,
  ) {}

  @OnEvent('**')
  async onDomainEvent(data: EmittedEvent): Promise<void> {
    try {
      await this.dispatch(data);
    } catch (error) {
      this.logger.error(
        `Failed to dispatch outbound webhook for ${data?.type}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async dispatch(data: EmittedEvent): Promise<void> {
    const eventType = data?.type;
    // Only dispatch canonical domain events (e.g. "customer.updated").
    if (!eventType || !eventType.includes('.')) return;

    const matched = await this.subscriptions.matching(eventType);
    if (!matched.length) return;

    for (const sub of matched) {
      const delivery = await this.deliveries.save(
        this.deliveries.create({
          subscriptionId: sub.id,
          eventType,
          eventId: data.eventId ?? null,
          targetUrl: sub.targetUrl,
          payload: {
            type: eventType,
            aggregateId: data.aggregateId ?? null,
            data: data.payload ?? null,
            // Latest-wins events: the worker skips this one if a newer one for
            // the same aggregate already reached the subscriber.
            ...(data.metadata?.snapshot ? { snapshot: true } : {}),
          },
          status: 'pending',
          attempts: 0,
        }),
      );
      await this.queue.add('deliver', { deliveryId: delivery.id }, RETRY_JOB_OPTIONS);
      this.logger.log(`Queued ${eventType} → ${sub.name} (${sub.targetUrl})`);
    }
  }
}
