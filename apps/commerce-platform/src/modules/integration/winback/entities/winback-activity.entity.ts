import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { WinbackActivityOutcome, WinbackActivityType } from '../winback.enums';

@Entity('winback_activity')
@Index('ix_winback_activity_account', ['account_id'])
@Index('ix_winback_activity_sales', ['sales_user_id', 'activity_at'])
export class WinbackActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  account_id: string;

  @Column({ type: 'uuid' })
  sales_user_id: string;

  @Column({ type: 'varchar', length: 20 })
  type: WinbackActivityType;

  @Column({ type: 'varchar', length: 20, nullable: true })
  outcome: WinbackActivityOutcome | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'timestamp with time zone', default: () => 'now()' })
  activity_at: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  next_follow_up_at: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  stage_after: string | null;

  @Column({ type: 'varchar', length: 20, default: 'done' })
  status: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  scheduled_at: Date | null;

  /** When the `winback_appointment_due` reminder for this planned activity was sent. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  reminded_at: Date | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  photo_urls: string[];

  @Column({ type: 'timestamp with time zone', nullable: true })
  checkin_at: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  checkout_at: Date | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  lat: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  lng: number | null;

  /** Reported accuracy (metres) of the check-in fix in `lat`/`lng`. */
  @Column({ type: 'numeric', precision: 8, scale: 1, nullable: true })
  checkin_accuracy_m: number | null;

  /** Where the rep was when they checked out. */
  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  checkout_lat: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  checkout_lng: number | null;

  @Column({ type: 'numeric', precision: 8, scale: 1, nullable: true })
  checkout_accuracy_m: number | null;

  @Column({ type: 'uuid', nullable: true })
  contact_id: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;
}
