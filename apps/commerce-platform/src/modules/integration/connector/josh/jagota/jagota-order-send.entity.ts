import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ErpCreateOrderRequest } from './erp-order-request';

/**
 * One order reference (josh shipment / order number) commerce sent to Jagota on josh's behalf
 * (step 2: josh routes `POST /order/add-order-create` through commerce). One row per reference —
 * that is the dedupe: a reference already `sent` is never sent again, the stored answer is replayed.
 */
@Entity('jagota_order_sends')
@Index('ix_jagota_order_sends_updated', ['updatedAt'])
export class JagotaOrderSend {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** MAGENTO_ORDER_NO — the reference ERP itself refuses twice ("Magento Order Id is already used"). */
  @Column({ name: 'order_reference', length: 64, unique: true }) orderReference: string;
  /** sending → sent | failed. A failed one can be sent again (josh retries); sending older than the lease can be taken over. */
  @Column({ length: 12 }) status: 'sending' | 'sent' | 'failed';
  @Column({ type: 'jsonb' }) request: ErpCreateOrderRequest;
  @Column({ type: 'jsonb', nullable: true }) response: Record<string, unknown> | null;
  @Column({ type: 'int', default: 1 }) attempts: number;
  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true }) lastError: string | null;
  @Column({ name: 'doc_book', type: 'varchar', length: 20, nullable: true }) docBook: string | null;
  @Column({ name: 'doc_no', type: 'varchar', length: 40, nullable: true }) docNo: string | null;
  @Column({ name: 'duration_ms', type: 'int', nullable: true }) durationMs: number | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' }) updatedAt: Date;
}
