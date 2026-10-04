import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

/** Feed types are processed at receipt by ErpFeedService (one row per SKU), never via apply(). */
export type ErpFeedEntityType = 'product_qty' | 'product_price' | 'product_moq';
export type ErpIngestEntityType = 'product' | 'stock' | 'customer' | 'sale_order' | ErpFeedEntityType | 'relay';
export const ERP_FEED_ENTITY_TYPES: ReadonlySet<string> = new Set<ErpFeedEntityType>(['product_qty', 'product_price', 'product_moq']);
/** ERP calls relayed verbatim to the platforms (product upsert, customers, order/invoice/quotation status). */
export const ERP_RELAY_ENTITY_TYPE = 'relay';
export type ErpIngestStatus = 'received' | 'applied' | 'failed' | 'skipped' | 'stale' | 'ignored';

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
