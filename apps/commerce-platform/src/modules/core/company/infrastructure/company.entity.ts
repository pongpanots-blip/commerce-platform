import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('companies')
export class Company extends BaseEntity {
  @Column({ type: 'varchar', length: 191 })
  name: string;

  @Column({ type: 'varchar', length: 191, name: 'legal_name', nullable: true })
  legalName: string | null;

  @Column({ type: 'varchar', length: 64, name: 'tax_id', nullable: true })
  taxId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;
}
