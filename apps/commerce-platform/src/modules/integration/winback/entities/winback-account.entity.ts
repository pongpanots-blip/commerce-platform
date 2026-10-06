import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  WinbackHealth,
  WinbackLifecycle,
  WinbackSource,
  WinbackStage,
} from '../winback.enums';

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
