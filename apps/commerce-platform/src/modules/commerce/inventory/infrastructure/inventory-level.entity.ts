import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('inventory_levels')
@Index(['productId', 'warehouseId'])
export class InventoryLevel extends BaseEntity {
  @Column({ type: 'uuid', name: 'product_id' })
  productId: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, default: 0 })
  quantity: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, default: 0 })
  reserved: string;
}
