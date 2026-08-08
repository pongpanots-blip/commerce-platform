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
}
