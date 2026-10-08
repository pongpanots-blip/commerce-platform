import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { WinbackAppRecordKind } from '../winback.enums';

/**
 * App-owned winback records the saleactivity screens need persisted (drafts, coaching tasks, work plans,
 * saved places, quotes, daily reports, sync runs, …) — one table keyed by `kind`, the body in `payload`
 * (snake_case, validated by the route's DTO before it is stored). Nothing here is a business record of
 * another system: quotes and dispatches are the rep's own record, never sent or turned into orders.
 *
 * `record_key` is the natural key for kinds with one row per subject (a work plan per account, a draft per
 * user + key, a dispatch per quote content version); unique per kind when set (`uq_winback_app_record_key`).
 */
@Entity('winback_app_record')
@Index('ix_winback_app_record_kind_sales', ['kind', 'sales_user_id'])
@Index('ix_winback_app_record_kind_account', ['kind', 'account_id'])
export class WinbackAppRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 40 })
  kind: WinbackAppRecordKind;

  @Column({ type: 'varchar', length: 200, nullable: true })
  record_key: string | null;

  /** The rep the record belongs to (owner / author). */
  @Column({ type: 'uuid', nullable: true })
  sales_user_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  account_id: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  status: string | null;

  /** Optimistic-concurrency counter for kinds that take `expected_version` (quotes, daily reports). */
  @Column({ type: 'integer', default: 1 })
  version: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  create_date: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  update_date: Date;
}
