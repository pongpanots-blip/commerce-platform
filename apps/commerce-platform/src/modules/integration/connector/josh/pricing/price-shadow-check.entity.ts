import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One josh order line re-priced by commerce with josh's resolver (shadow mode for "commerce owns prices"; nothing is written to josh). */
@Entity('price_shadow_checks')
@Index('ix_price_shadow_ordered_at', ['orderedAt'])
export class PriceShadowCheck {
  @PrimaryGeneratedColumn('uuid') id: string;
  /** josh order_items.id — each line is checked once. */
  @Column({ name: 'josh_order_item_id', type: 'uuid', unique: true }) joshOrderItemId: string;
  @Column({ name: 'order_number', type: 'varchar', length: 64, nullable: true }) orderNumber: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) sku: string | null;
  @Column({ type: 'int' }) quantity: number;
  @Column({ name: 'ordered_at', type: 'timestamptz' }) orderedAt: Date;
  @Column({ name: 'josh_unit_price', type: 'numeric', precision: 12, scale: 2 }) joshUnitPrice: string;
  @Column({ name: 'josh_source', type: 'varchar', length: 30, nullable: true }) joshSource: string | null;
  @Column({ name: 'josh_mechanic_id', type: 'uuid', nullable: true }) joshMechanicId: string | null;
  @Column({ name: 'commerce_unit_price', type: 'numeric', precision: 12, scale: 2, nullable: true }) commerceUnitPrice: string | null;
  @Column({ name: 'commerce_source', type: 'varchar', length: 30, nullable: true }) commerceSource: string | null;
  @Column({ name: 'commerce_mechanic_id', type: 'uuid', nullable: true }) commerceMechanicId: string | null;
  @Column() matched: boolean;
  /** Which of price / source / mechanic differ. */
  @Column({ type: 'jsonb', default: () => "'[]'" }) diffs: string[];
  /** Why a line could not be compared, or what may explain a difference (price data changed after the order). */
  @Column({ type: 'text', nullable: true }) note: string | null;
  @Column({ name: 'checked_at', type: 'timestamptz', default: () => 'now()' }) checkedAt: Date;
}
