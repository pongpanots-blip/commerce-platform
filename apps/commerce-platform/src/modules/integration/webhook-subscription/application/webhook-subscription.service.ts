import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookSubscription } from '../infrastructure/webhook-subscription.entity';
import { WebhookDelivery } from '../infrastructure/webhook-delivery.entity';

/** CRUD for outbound webhook subscriptions + read access to the delivery log. */
@Injectable()
export class WebhookSubscriptionService {
  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subs: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveries: Repository<WebhookDelivery>,
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

  listDeliveries(limit = 100): Promise<WebhookDelivery[]> {
    return this.deliveries.find({ order: { createdAt: 'DESC' }, take: limit });
  }
}
