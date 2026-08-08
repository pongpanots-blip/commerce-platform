import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('order_lines')
@Index(['orderId'])
export class OrderLine extends BaseEntity {
  @Column({ type: 'uuid', name: 'order_id' })
  orderId: string;

  @Column({ type: 'uuid', name: 'product_id' })
  productId: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, default: 1 })
  qty: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, name: 'unit_price', default: 0 })
  unitPrice: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, name: 'line_total', default: 0 })
  lineTotal: string;
}
