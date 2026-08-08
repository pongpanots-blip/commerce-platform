import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { WebhookEvent } from '../infrastructure/webhook-event.entity';
import { WebhookReceivedEvent } from '../domain/events/webhook-received.event';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';
import { QUEUES } from '../../../../config/redis.config';

const MAX_ATTEMPTS = 5;

/**
 * Processing side of the webhook pipeline. Loads the stored event, publishes a
 * domain event (never calls business services directly), and records the
 * outcome. Throwing lets BullMQ retry with backoff; replay re-enqueues by id.
 */
@Processor(QUEUES.WEBHOOK)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookRepo: Repository<WebhookEvent>,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {
    super();
  }

  async process(job: Job<{ webhookEventId: string }>): Promise<void> {
    await this.handle(job.data.webhookEventId);
  }

  async handle(webhookEventId: string): Promise<void> {
    const event = await this.webhookRepo.findOne({ where: { id: webhookEventId } });
    if (!event) {
      throw new Error(`Webhook event ${webhookEventId} not found`);
    }

    event.status = 'processing';
    await this.webhookRepo.save(event);

    try {
      await this.eventBus.publish(
        new WebhookReceivedEvent(event.integrationId, {
          webhookEventId: event.id,
          payload: event.payload,
        }),
      );
      event.status = 'processed';
      event.error = null;
      await this.webhookRepo.save(event);
    } catch (error) {
      event.attempts += 1;
      event.error = error instanceof Error ? error.message : String(error);
      if (event.attempts >= MAX_ATTEMPTS) {
        event.status = 'failed';
        this.logger.error(`Webhook ${event.id} failed after ${event.attempts} attempts`);
      }
      await this.webhookRepo.save(event);
      throw error;
    }
  }
}
