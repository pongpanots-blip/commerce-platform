import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../domain/base.entity';

export type OutboxStatus = 'pending' | 'published' | 'failed';

/**
 * Transactional outbox row. Written in the same DB transaction as the state
 * change that produced the event; drained asynchronously by the relay worker.
 */
@Entity('outbox_messages')
@Index(['status', 'createdAt'])
export class OutboxMessage extends BaseEntity {
  @Column({ type: 'varchar', length: 191 })
  type: string;

  @Column({ type: 'uuid', name: 'aggregate_id' })
  aggregateId: string;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: OutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamp with time zone', name: 'published_at', nullable: true })
  publishedAt: Date | null;
}
