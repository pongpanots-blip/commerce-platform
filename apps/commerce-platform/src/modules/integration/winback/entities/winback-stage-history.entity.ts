import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('winback_stage_history')
@Index('ix_winback_stage_history_account', ['account_id', 'changed_at'])
@Index('ix_winback_stage_history_changed_at', ['changed_at'])
export class WinbackStageHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  account_id: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  from_stage: string | null;

  @Column({ type: 'varchar', length: 20 })
  to_stage: string;

  @Column({ type: 'uuid' })
  changed_by: string;

  @Column({ type: 'timestamp with time zone', default: () => 'now()' })
  changed_at: Date;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
