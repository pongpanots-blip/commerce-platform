import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

@Entity('promotions')
export class Promotion extends BaseEntity {
  @Column({ type: 'varchar', length: 191 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  @Column({ type: 'numeric', precision: 14, scale: 4, default: 0 })
  value: string;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'timestamp with time zone', name: 'starts_at', nullable: true })
  startsAt: Date | null;

  @Column({ type: 'timestamp with time zone', name: 'ends_at', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  rules: Record<string, unknown> | null;
}
