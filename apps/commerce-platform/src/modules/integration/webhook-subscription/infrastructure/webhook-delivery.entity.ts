import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

export type DeliveryStatus = 'pending' | 'success' | 'failed';

/** One outbound delivery attempt of an event to a subscription's target URL. */
@Entity('webhook_deliveries')
@Index(['subscriptionId', 'status'])
export class WebhookDelivery extends BaseEntity {
  @Column({ type: 'uuid', name: 'subscription_id' })
  subscriptionId: string;

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
