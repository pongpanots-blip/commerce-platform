import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('orders')
@Index(['customerId'])
export class Order extends BaseEntity {
  @Column({ type: 'uuid', name: 'customer_id' })
  customerId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 24, default: 'draft' })
  status: string;

  @Column({ type: 'varchar', length: 8, default: 'THB' })
  currency: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, default: 0 })
  total: string;

  /** Client-supplied checkout idempotency key; a repeat checkout with the same key is a no-op replay. */
  @Column({ type: 'varchar', length: 128, name: 'idempotency_key', nullable: true, unique: true })
  idempotencyKey: string | null;
}
