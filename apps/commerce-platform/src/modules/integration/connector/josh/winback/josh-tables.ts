/**
 * josh's winback tables, copied from josh `apps/backend/src/entities/winback-*.entity.ts`
 * (josh origin/main af81a227) so the copied report code runs unchanged — plus slim read-only
 * views of josh `users` and `orders` with only the columns winback reads.
 *
 * Registered ONLY on the josh replica DataSource (JoshReplica). This file is deliberately not
 * named *.entity.ts: commerce's own DataSource loads every *.entity file, and these tables
 * must never appear in commerce's schema or migrations.
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { WinbackActivityOutcome, WinbackActivityType, WinbackHealth, WinbackLifecycle, WinbackMeetingSignal, WinbackSource, WinbackStage } from './winback.enums';

// ---- josh entities/winback-account.entity.ts
@Entity('winback_account')
@Index('uq_winback_customer_code', ['customer_code'], { unique: true })
@Index('ix_winback_health', ['health'])
@Index('ix_winback_stage', ['stage'])
@Index('ix_winback_lifecycle', ['lifecycle'])
@Index('ix_winback_assigned', ['assigned_sales_user_id'])
// ix_winback_delay_ratio is a partial index (WHERE delay_ratio IS NOT NULL) and
// lives in WinbackReorderBaseline1791740000000 — TypeORM cannot express it here.
export class WinbackAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  customer_code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  display_name: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  register_number: string | null;

  @Column({ type: 'varchar', length: 20, default: WinbackSource.JOSH })
  source: WinbackSource;

  @Column({ type: 'uuid', nullable: true })
  josh_user_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  josh_company_id: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  last_order_at: Date | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  lifetime_spend_hint: number | null;

  @Column({ type: 'int', default: 0 })
  inactive_days: number;

  /**
   * This customer's own normal gap between orders. Dormancy is judged against
   * this, not against one fixed threshold for everybody.
   *
   * NULL means "not enough order history to tell" — never 0. A consumer must be
   * able to tell that apart from a customer who orders daily.
   */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  median_reorder_interval_days: number | null;

  /**
   * `inactive_days / median_reorder_interval_days`. 1.0 = due now, 2.5 = two
   * and a half cycles late. NULL when there is no baseline to compare against.
   */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  delay_ratio: number | null;

  /** Orders in the last 365 days. 0 is meaningful: gone for a whole year. */
  @Column({ type: 'int', default: 0 })
  order_count_365d: number;

  /**
   * Revenue per month **while the customer was ordering** — the number that is
   * at risk. Deliberately separate from `lifetime_spend_hint`, which is a
   * cumulative all-time total and must never be presented as a monthly figure.
   *
   * NULL when the span is unknown (a single order, or none in the window).
   */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  avg_monthly_revenue: number | null;

  @Column({ type: 'varchar', length: 20, default: WinbackHealth.DORMANT })
  health: WinbackHealth;

  @Column({ type: 'varchar', length: 20, default: WinbackStage.INACTIVE_POOL })
  stage: WinbackStage;

  /**
   * Capture phase orthogonal to pipeline stage:
   * tmp = first field capture, follow until app register;
   * lead = Josh app registered (or manually confirmed).
   */
  @Column({ type: 'varchar', length: 10, default: WinbackLifecycle.TMP })
  lifecycle: WinbackLifecycle;

  @Column({ type: 'timestamp with time zone', nullable: true })
  promoted_to_lead_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  assigned_sales_user_id: string | null;

  /**
   * When the **current** owner got this lead. Reset on every reassignment, NULL
   * whenever the lead is unowned — the question it answers is "how long has
   * this rep had it", not how long the record has existed (`create_date`
   * already answers that).
   *
   * NULL also means "we do not know": rows predating this column were left
   * empty on purpose. An approximate date in a field named `assigned_at` is
   * worse than an empty one, because no consumer can tell the two apart.
   */
  @Column({ type: 'timestamp with time zone', nullable: true })
  assigned_at: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  next_follow_up_at: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  reactivated_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  cuisine_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  cuisine_name: string | null;

  @Column({ type: 'int', default: 0 })
  activity_count: number;

  @Column({ type: 'int', default: 0 })
  visit_count: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  last_activity_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_sales_user_id: string | null;

  // --- Lead pipeline v1 fields ---
  @Column({ type: 'varchar', length: 20, nullable: true })
  customer_type: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  lead_source: string | null;

  /** When the lead agreed to the Privacy Policy on a public form. NULL = never. */
  @Column({ type: 'timestamptz', nullable: true })
  consent_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location: string | null;

  /**
   * Delivery province, taken from the customer's most recent ERP invoice
   * (`erp_sales_history.del_province`). Field sales work by territory, so this
   * is the filter that makes a pool of thousands usable.
   *
   * NULL for accounts that never had an ERP invoice — manually created leads and
   * market-explorer captures. Those have free-text `location` instead, which is
   * not the same thing and is not a substitute.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  province: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  company_registration_num: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  id_card_number: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  company_name: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  restaurant_name: string | null;

  /** Set when the tmp lead was created from Market Explorer restaurant_place. */
  @Column({ type: 'uuid', nullable: true })
  restaurant_place_id: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  lat: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 7, nullable: true })
  lng: number | null;

  @Column({ type: 'uuid', nullable: true })
  cuisine_parent_id: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  cuisine_parent_name: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  business_size: string | null;

  @Column({ type: 'int', nullable: true })
  branch_count: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  line_id: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  whatsapp: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  wongnai_url: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  operation_hours: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  reject_reason: string | null;

  @Column({ type: 'text', nullable: true })
  reject_note: string | null;

  /** Last time the owner was told this lead is unworked (`winback_lead_aging`). */
  @Column({ type: 'timestamp with time zone', nullable: true })
  aging_notified_at: Date | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  create_date: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  update_date: Date;
}

// ---- josh entities/winback-activity.entity.ts
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

  @Column({ type: 'uuid', nullable: true })
  contact_id: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  created_at: Date;
}

// ---- josh entities/winback-contact.entity.ts
@Entity('winback_contact')
@Index('ix_winback_contact_account', ['account_id'])
export class WinbackContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  account_id: string;

  @Column({ type: 'varchar', length: 20 })
  team: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  role_label: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  mobile: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  line_id: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  whatsapp: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  create_date: Date;
}

// ---- josh entities/winback-stage-history.entity.ts
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

// ---- josh entities/winback-sales-target.entity.ts
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

// ---- josh entities/winback-meeting-ack.entity.ts
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

// ---- slim read-only views of josh tables (only what winback reads)
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) first_name: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) last_name: string;
  @Column({ type: 'uuid', nullable: true }) company_id: string;
  @Column({ type: 'varchar', length: 50 }) role: string;
  @Column({ type: 'varchar', length: 255 }) email: string;
  @Column({ type: 'boolean' }) is_active: boolean;
  @CreateDateColumn({ type: 'timestamp with time zone' }) created_at: Date;
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid') orders_id: string;
  @Column({ type: 'varchar', length: 50, nullable: true }) customer_code: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) total_price: number;
  @Column({ type: 'varchar' }) status: string;
  @CreateDateColumn({ type: 'timestamp with time zone' }) create_date: Date;
}

export const JOSH_WINBACK_TABLES = [WinbackAccount, WinbackActivity, WinbackContact, WinbackStageHistory, WinbackSalesTarget, WinbackMeetingAck, User, Order];
