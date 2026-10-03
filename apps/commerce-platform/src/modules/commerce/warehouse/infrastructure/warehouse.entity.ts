import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('warehouses')
export class Warehouse extends BaseEntity {
  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 191 })
  name: string;

  @Column({ type: 'jsonb', nullable: true })
  address: Record<string, unknown> | null;

  /**
   * Who owns this warehouse's stock numbers. 'erp' today; flips to 'commerce'
   * per warehouse once it runs on our own warehouse system — ERP quantities
   * for it are then recorded as 'ignored' movements instead of applied.
   */
  @Column({ type: 'varchar', length: 16, name: 'stock_source', default: 'erp' })
  stockSource: 'erp' | 'commerce';
}
