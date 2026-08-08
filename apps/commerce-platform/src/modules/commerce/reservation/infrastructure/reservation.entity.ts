import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

export type ReservationMode = 'on_hand' | 'to_order';
export type ReservationStatus =
  | 'pending' | 'held' | 'confirmed' | 'released' | 'expired' | 'failed' | 'reconcile';

/**
 * One stock hold (or to_order demand) per order line. The ONLY table that
 * records holds — the single reservation authority persists here.
 */
@Entity('reservations')
@Index(['orderId'])
@Index(['status', 'expiresAt'])
export class Reservation extends BaseEntity {
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @Column({ type: 'uuid', name: 'order_line_id' })
  orderLineId: string;

  @Column({ type: 'uuid', name: 'product_id' })
  productId: string;

  /** Denormalised for connector calls — the ERP speaks SKU, not our UUIDs. */
  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'numeric', precision: 14, scale: 4 })
  qty: string;

  @Column({ type: 'varchar', length: 12 })
  mode: ReservationMode;

  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status: ReservationStatus;

  /** ERP-side reservation reference (null for to_order — no external call). */
  @Column({ type: 'varchar', length: 128, name: 'external_ref', nullable: true })
  externalRef: string | null;

  @Column({ type: 'uuid', name: 'integration_id', nullable: true })
  integrationId: string | null;

  @Column({ type: 'varchar', length: 128, name: 'idempotency_key', unique: true })
  idempotencyKey: string;

  @Column({ type: 'timestamp with time zone', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'date', name: 'promised_date', nullable: true })
  promisedDate: string | null;

  @Column({ type: 'varchar', length: 255, name: 'fail_reason', nullable: true })
  failReason: string | null;
}
