import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WinbackMeetingSignal } from '../winback.enums';

/**
 * "We already raised this at the meeting." One row per talking point that a
 * manager has discussed, so the Monday screen can mark a point that came back
 * unresolved.
 *
 * Identity is `account_id + signal + subject_id`, and the uniqueness lives in
 * the DB (`uq_winback_meeting_ack`, on `COALESCE(subject_id, '')` — a plain
 * unique index treats NULLs as distinct, which would insert a new row for every
 * acknowledgement of a lead-level signal).
 */
@Entity('winback_meeting_ack')
@Index('ix_winback_meeting_ack_discussed_at', ['discussed_at'])
@Index('ix_winback_meeting_ack_account', ['account_id'])
export class WinbackMeetingAck {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  account_id: string;

  @Column({ type: 'varchar', length: 40 })
  signal: WinbackMeetingSignal;

  /**
   * What within the lead the point is about — the appointment's activity id for
   * `appointment_unlogged`, the stage name for `stage_stalled`. NULL when the
   * lead itself is the subject (`never_touched`, `went_quiet`).
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  subject_id: string | null;

  @Column({ type: 'timestamp with time zone' })
  discussed_at: Date;

  /** Who acknowledged it. Stored for audit; not returned by the API. */
  @Column({ type: 'uuid', nullable: true })
  discussed_by: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  create_date: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  update_date: Date;
}
