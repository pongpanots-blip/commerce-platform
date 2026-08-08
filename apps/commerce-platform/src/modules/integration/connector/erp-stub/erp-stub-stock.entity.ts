import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

/** Simulated ERP on-hand stock. qty is an int — the stub models whole units. */
@Entity('erp_stub_stock')
export class ErpStubStock extends BaseEntity {
  @Column({ type: 'varchar', length: 64, unique: true })
  sku: string;

  @Column({ type: 'int', default: 0 })
  qty: number;
}
