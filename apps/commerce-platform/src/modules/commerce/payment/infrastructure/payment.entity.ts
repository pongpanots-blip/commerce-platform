import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('payments')
@Index(['orderId'])
export class Payment extends BaseEntity {
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  method: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 4, default: 0 })
  amount: string;

  @Column({ type: 'varchar', length: 8, default: 'THB' })
  currency: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  reference: string | null;
}
