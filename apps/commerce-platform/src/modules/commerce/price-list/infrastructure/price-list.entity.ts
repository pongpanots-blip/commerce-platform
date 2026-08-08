import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('price_lists')
export class PriceList extends BaseEntity {
  @Column({ type: 'varchar', length: 191 })
  name: string;

  @Column({ type: 'varchar', length: 8, default: 'THB' })
  currency: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;
}
