import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Copy of josh `jagota_order_sync` (every order / shipment josh sent — or skipped — to Jagota ERP),
 * same columns and names as josh, keyed by josh's id. Kept in commerce so the ERP send history
 * survives josh being down and commerce can become its owner (orders → Jagota, step 3).
 */
@Entity('jagota_order_sync_history')
@Index('ix_jagota_sync_history_created_at', ['createdAt'])
@Index('ix_jagota_sync_history_order_id', ['orderId'])
export class JagotaSyncHistory {
  /** josh jagota_order_sync.id */
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'order_id', type: 'uuid' }) orderId: string;
  /** josh orders.order_number at import time (josh's table has only order_id). */
  @Column({ name: 'order_number', type: 'varchar', length: 64, nullable: true }) orderNumber: string | null;
  @Column({ name: 'shipment_id', type: 'uuid', nullable: true }) shipmentId: string | null;
  @Column({ name: 'payment_success' }) paymentSuccess: boolean;
  @Column({ name: 'payment_method', length: 30 }) paymentMethod: string;
  @Column({ name: 'request_json', type: 'jsonb', nullable: true }) requestJson: Record<string, unknown> | null;
  @Column({ name: 'sync_status', length: 20 }) syncStatus: string;
  @Column({ name: 'jagota_response_json', type: 'jsonb', nullable: true }) jagotaResponseJson: unknown;
  @Column({ name: 'transaction_type', type: 'varchar', length: 100, nullable: true }) transactionType: string | null;
  @Column({ name: 'doc_book', type: 'varchar', length: 100, nullable: true }) docBook: string | null;
  @Column({ name: 'doc_no', type: 'varchar', length: 100, nullable: true }) docNo: string | null;
  @Column({ name: 'order_taking_doc_seq', type: 'varchar', length: 100, nullable: true }) orderTakingDocSeq: string | null;
  @Column({ name: 'error_message', type: 'text', nullable: true }) errorMessage: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  /** Last import, or last jagota_sync.snapshot applied (stage 5) — the copy's freshness. */
  @Column({ name: 'imported_at', type: 'timestamptz', default: () => 'now()' }) importedAt: Date;
  /** josh commerce_snapshot_seq of the last applied jagota_sync.snapshot; 0 = replica import only. */
  @Column({ name: 'source_version', type: 'bigint', default: 0 }) sourceVersion: string;
}
