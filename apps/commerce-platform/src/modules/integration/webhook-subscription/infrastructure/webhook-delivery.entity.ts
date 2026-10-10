import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

/** superseded = a newer snapshot event for the same aggregate already reached the subscriber. */
export type DeliveryStatus = 'pending' | 'success' | 'failed' | 'superseded';

/** One outbound delivery attempt of an event to a subscription's target URL. */
@Entity('webhook_deliveries')
@Index(['subscriptionId', 'status'])
export class WebhookDelivery extends BaseEntity {
  /** null only for kind = 'marketing'. */
  @Column({ type: 'uuid', name: 'subscription_id', nullable: true })
  subscriptionId: string | null;

  /** event = a subscription delivery · marketing = a marketing workflow webhook step (own queue, no subscription). */
  @Column({ type: 'varchar', length: 16, default: 'event' })
  kind: 'event' | 'marketing';

  @Column({ type: 'varchar', length: 8, nullable: true })
  method: string | null;

  /** Marketing only, secret refs NOT resolved (resolved at send time). */
  @Column({ type: 'jsonb', nullable: true })
  headers: { key: string; value: string }[] | null;

  @Column({ type: 'varchar', length: 191, name: 'idempotency_key', nullable: true })
  idempotencyKey: string | null;

  @Column({ type: 'varchar', length: 191, name: 'event_type' })
  eventType: string;

  @Column({ type: 'uuid', name: 'event_id', nullable: true })
  eventId: string | null;

  @Column({ type: 'varchar', length: 1024, name: 'target_url' })
  targetUrl: string;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: DeliveryStatus;

  @Column({ type: 'int', name: 'status_code', nullable: true })
  statusCode: number | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
