import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

/**
 * An OUTBOUND webhook registration: a subscriber (e.g. an e-commerce system)
 * asking the platform to POST to their URL when specific domain events fire.
 */
@Entity('webhook_subscriptions')
@Index(['active'])
export class WebhookSubscription extends BaseEntity {
  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 1024, name: 'target_url' })
  targetUrl: string;

  /** Canonical event types to deliver, e.g. ["customer.updated","order.created"]; ["*"] = all. */
  @Column({ type: 'jsonb', name: 'event_types', default: () => "'[]'" })
  eventTypes: string[];

  /** Secret used to HMAC-sign the outbound body (sent as x-signature). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  secret: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Portal account that owns this subscription; null = admin-created. */
  @Column({ type: 'uuid', name: 'account_id', nullable: true })
  accountId: string | null;
}
