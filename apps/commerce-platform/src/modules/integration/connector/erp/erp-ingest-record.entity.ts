import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

export type ErpIngestEntityType = 'product' | 'stock' | 'customer' | 'sale_order';
export type ErpIngestStatus = 'received' | 'applied' | 'failed' | 'skipped';

/**
 * Staging row for inbound ERP data ("เอามากรองก่อน"): every payload lands here
 * verbatim BEFORE any platform table is written; appliers act on staged rows.
 */
@Entity('erp_ingest_records')
@Index(['entityType', 'status'])
@Index(['externalId'])
export class ErpIngestRecord extends BaseEntity {
  @Column({ type: 'uuid', name: 'integration_id' })
  integrationId: string;

  @Column({ type: 'varchar', length: 16, name: 'entity_type' })
  entityType: ErpIngestEntityType;

  @Column({ type: 'varchar', length: 128, name: 'external_id', nullable: true })
  externalId: string | null;

  @Column({ type: 'jsonb', name: 'raw_payload' })
  rawPayload: unknown;

  @Column({ type: 'jsonb', name: 'parsed_payload', nullable: true })
  parsedPayload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 12, default: 'received' })
  status: ErpIngestStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamp with time zone', name: 'applied_at', nullable: true })
  appliedAt: Date | null;
}
