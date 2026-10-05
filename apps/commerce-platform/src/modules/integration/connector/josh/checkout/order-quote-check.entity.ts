import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One josh order whose totals commerce rebuilt with josh's checkout math (shadow quote, nothing written to josh). */
@Entity('order_quote_checks')
@Index('ix_order_quote_checks_ordered_at', ['orderedAt'])
export class OrderQuoteCheck {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'josh_order_id', type: 'uuid', unique: true }) joshOrderId: string;
  @Column({ name: 'order_number', type: 'varchar', length: 64, nullable: true }) orderNumber: string | null;
  @Column({ name: 'ordered_at', type: 'timestamptz' }) orderedAt: Date;
  @Column() matched: boolean;
  /** [{ field, josh, commerce }] */
  @Column({ type: 'jsonb', default: () => "'[]'" }) diffs: { field: string; josh: number; commerce: number }[];
  @Column({ name: 'josh_totals', type: 'jsonb' }) joshTotals: Record<string, number | null>;
  @Column({ name: 'commerce_totals', type: 'jsonb', nullable: true }) commerceTotals: Record<string, number> | null;
  @Column({ type: 'text', nullable: true }) note: string | null;
  @Column({ name: 'checked_at', type: 'timestamptz', default: () => 'now()' }) checkedAt: Date;
}
