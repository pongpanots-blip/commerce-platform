import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('notifications')
export class Notification extends BaseEntity {
  @Column({ type: 'varchar', length: 24 })
  channel: string;

  @Column({ type: 'varchar', length: 191 })
  recipient: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  template: string | null;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;
}
