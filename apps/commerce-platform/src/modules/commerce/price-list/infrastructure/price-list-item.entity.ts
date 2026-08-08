import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('price_list_items')
@Index(['priceListId', 'productId'])
export class PriceListItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'price_list_id' })
  priceListId: string;

  @Column({ type: 'uuid', name: 'product_id' })
  productId: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, name: 'min_qty', default: 1 })
  minQty: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, name: 'unit_price' })
  unitPrice: string;
}
