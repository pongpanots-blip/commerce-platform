import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('organizations')
@Index(['slug'], { unique: true })
export class Organization extends BaseEntity {
  @Column({ type: 'uuid', name: 'company_id', nullable: true })
  companyId: string | null;

  @Column({ type: 'varchar', length: 191 })
  name: string;

  @Column({ type: 'varchar', length: 191 })
  slug: string;
}
