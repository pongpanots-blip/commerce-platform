import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

/**
 * Simulated ERP-side hold. `id` doubles as the externalRef the platform stores.
 * `idempotencyKey` makes reserve retries safe (no double decrement).
 */
@Entity('erp_stub_reservations')
@Index(['sku'])
export class ErpStubReservation extends BaseEntity {
  @Column({ type: 'varchar', length: 128, name: 'idempotency_key', unique: true })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'int' })
  qty: number;

  /** held | confirmed | released */
  @Column({ type: 'varchar', length: 12, default: 'held' })
  status: string;
}
