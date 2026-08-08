import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { WebhookEvent } from '../infrastructure/webhook-event.entity';
import { IntegrationService } from '../../integration/application/integration.service';
import { SignatureVerifier } from './signature-verifier';
import { QUEUES } from '../../../../config/redis.config';

/**
 * Ingest side of the webhook pipeline. Verifies the signature, stores the raw
 * payload for audit/replay, and enqueues a processing job. It NEVER calls
 * business logic directly.
 */
@Injectable()
export class WebhookReceiverService {
  private readonly logger = new Logger(WebhookReceiverService.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookRepo: Repository<WebhookEvent>,
    private readonly integrations: IntegrationService,
    private readonly verifier: SignatureVerifier,
    @InjectQueue(QUEUES.WEBHOOK) private readonly queue: Queue,
  ) {}

  /**
   * @param ref integration UUID or webhook slug (e.g. "shopify").
   */
  async receive(
    ref: string,
    headers: Record<string, unknown>,
    rawBody: string,
    signature: string | undefined,
  ): Promise<WebhookEvent> {
    const integration = await this.integrations.resolve(ref);
    if (!integration) {
      throw new NotFoundException(`Unknown integration "${ref}"`);
    }

    const signatureValid = this.verifier.verify(
      integration.signingSecret,
      rawBody,
      signature,
    );

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      payload = { raw: rawBody };
    }

    const saved = await this.webhookRepo.save(
      this.webhookRepo.create({
        integrationId: integration.id,
        headers,
        payload,
        signatureValid,
        status: 'received',
        attempts: 0,
      }),
    );

    if (!signatureValid) {
      this.logger.warn(`Rejected webhook ${saved.id}: invalid signature`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    await this.queue.add('process', { webhookEventId: saved.id });
    return saved;
  }

  /** List recent webhook events (admin/UI). */
  list(limit = 100): Promise<WebhookEvent[]> {
    return this.webhookRepo.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  /** Fetch a single webhook event including its raw payload (admin/UI). */
  async getOne(id: string): Promise<WebhookEvent> {
    const event = await this.webhookRepo.findOne({ where: { id } });
    if (!event) throw new NotFoundException(`Unknown webhook event ${id}`);
    return event;
  }

  /** Re-enqueue an already-stored webhook event for processing. */
  async replay(webhookEventId: string): Promise<void> {
    const event = await this.webhookRepo.findOne({ where: { id: webhookEventId } });
    if (!event) {
      throw new NotFoundException(`Unknown webhook event ${webhookEventId}`);
    }
    await this.queue.add('process', { webhookEventId });
  }
}
