import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { QUEUES, RETRY_JOB_OPTIONS } from '../../../../config/redis.config';
import { WebhookSubscription } from '../infrastructure/webhook-subscription.entity';
import { DeliveryStatus, WebhookDelivery } from '../infrastructure/webhook-delivery.entity';

/** CRUD for outbound webhook subscriptions + read access to the delivery log. */
@Injectable()
export class WebhookSubscriptionService {
  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subs: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveries: Repository<WebhookDelivery>,
    @InjectQueue(QUEUES.WEBHOOK_OUT) private readonly queue: Queue,
  ) {}

  list(): Promise<WebhookSubscription[]> {
    return this.subs.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<WebhookSubscription> {
    const found = await this.subs.findOne({ where: { id } });
    if (!found) throw new NotFoundException(`Subscription ${id} not found`);
    return found;
  }

  create(dto: Partial<WebhookSubscription>): Promise<WebhookSubscription> {
    return this.subs.save(this.subs.create(dto));
  }

  async update(id: string, dto: Partial<WebhookSubscription>): Promise<WebhookSubscription> {
    const current = await this.findOne(id);
    return this.subs.save({ ...current, ...dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.subs.softDelete(id);
  }

  /** Active subscriptions that want this event type (explicit match or "*"). */
  matching(eventType: string): Promise<WebhookSubscription[]> {
    return this.subs
      .createQueryBuilder('s')
      .where('s.active = :active', { active: true })
      .andWhere(
        `(s.event_types @> CAST(:one AS jsonb) OR s.event_types @> CAST(:all AS jsonb))`,
        { one: JSON.stringify([eventType]), all: JSON.stringify(['*']) },
      )
      .getMany();
  }

  listDeliveries(limit = 100, status?: DeliveryStatus): Promise<WebhookDelivery[]> {
    return this.deliveries.find({ where: status ? { status } : {}, order: { createdAt: 'DESC' }, take: limit });
  }

  /**
   * Dead-letter → try again: a 'failed' delivery gets a fresh retry budget.
   * The worker still drops it as 'superseded' if a newer snapshot for the same
   * aggregate already reached that subscriber.
   */
  async retryDelivery(id: string): Promise<WebhookDelivery> {
    const delivery = await this.deliveries.findOne({ where: { id } });
    if (!delivery) throw new NotFoundException(`Delivery ${id} not found`);
    if (delivery.status !== 'failed') throw new BadRequestException(`Only failed deliveries can be retried (this one is ${delivery.status})`);
    Object.assign(delivery, { status: 'pending', attempts: 0, error: null });
    const saved = await this.deliveries.save(delivery);
    await this.queue.add('deliver', { deliveryId: id }, RETRY_JOB_OPTIONS);
    return saved;
  }
}
