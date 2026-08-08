import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

export type WebhookStatus = 'received' | 'processing' | 'processed' | 'failed';

/**
 * Immutable-ish record of an inbound webhook. The raw payload + headers are
 * stored verbatim on receipt (audit + replay); status transitions as the worker
 * processes it.
 */
@Entity('webhook_events')
@Index(['integrationId', 'status'])
export class WebhookEvent extends BaseEntity {
  @Column({ type: 'uuid', name: 'integration_id' })
  integrationId: string;

  @Column({ type: 'jsonb' })
  headers: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  payload: unknown;

  @Column({ type: 'boolean', name: 'signature_valid', default: false })
  signatureValid: boolean;

  @Column({ type: 'varchar', length: 16, default: 'received' })
  status: WebhookStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
