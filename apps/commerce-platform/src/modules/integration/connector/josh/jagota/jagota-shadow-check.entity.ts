import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { ErpCreateOrderRequest, FieldDiff } from './erp-order-request';

/** One josh → Jagota send, compared with the request commerce would have sent (shadow mode, nothing is sent). */
@Entity('jagota_shadow_checks')
@Index('ix_jagota_shadow_sent_at', ['joshSentAt'])
export class JagotaShadowCheck {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** josh jagota_order_sync.id — each send is checked once. */
  @Column({ name: 'josh_sync_id', length: 64, unique: true }) joshSyncId: string;
  @Column({ name: 'josh_order_id', type: 'uuid', nullable: true }) joshOrderId: string | null;
  @Column({ name: 'josh_shipment_id', type: 'uuid', nullable: true }) joshShipmentId: string | null;
  @Column({ name: 'order_reference', type: 'varchar', length: 64, nullable: true }) orderReference: string | null;
  @Column({ name: 'josh_sync_status', type: 'varchar', length: 20, nullable: true }) joshSyncStatus: string | null;
  @Column({ name: 'josh_sent_at', type: 'timestamptz' }) joshSentAt: Date;
  @Column() matched: boolean;
  @Column({ type: 'jsonb', default: () => "'[]'" }) diffs: FieldDiff[];
  @Column({ name: 'josh_request', type: 'jsonb', nullable: true }) joshRequest: ErpCreateOrderRequest | null;
  @Column({ name: 'commerce_request', type: 'jsonb', nullable: true }) commerceRequest: ErpCreateOrderRequest | null;
  /** Why a row could not be compared, or what may explain a difference (data changed after the send). */
  @Column({ type: 'text', nullable: true }) note: string | null;
  @Column({ name: 'checked_at', type: 'timestamptz', default: () => 'now()' }) checkedAt: Date;
}
