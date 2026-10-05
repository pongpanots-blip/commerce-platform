import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('winback_sales_target')
@Index('uq_winback_sales_target_period', ['sales_user_id', 'period_month'], { unique: true })
export class WinbackSalesTarget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sales_user_id: string;

  @Column({ type: 'varchar', length: 7 })
  period_month: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  gmv_target: number;

  @Column({ type: 'uuid' })
  created_by: string;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updated_at: Date;
}
