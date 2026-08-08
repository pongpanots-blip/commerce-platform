import { Column, Entity, Unique } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('settings')
@Unique(['organizationId', 'scope', 'key'])
export class Setting extends BaseEntity {
  @Column({ type: 'varchar', length: 64 })
  scope: string;

  @Column({ type: 'varchar', length: 128 })
  key: string;

  @Column({ type: 'jsonb', default: {} })
  value: unknown;
}
