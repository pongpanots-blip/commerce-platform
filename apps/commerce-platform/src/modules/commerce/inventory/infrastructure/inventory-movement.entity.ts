import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

export type StockSource = 'erp' | 'commerce';
/** applied = moved the snapshot · stale = older than what we already have · ignored = warehouse owned by another source */
export type MovementStatus = 'applied' | 'stale' | 'ignored';

/**
 * Append-only stock ledger. Every quantity change lands here first; the
 * `inventory_levels` row is only the current snapshot. Kept from day one so the
 * platform can become its own warehouse system later (receive / adjust /
 * transfer / count) with full history to reconcile against the ERP.
 */
@Entity('inventory_movements')
@Index(['productId', 'warehouseId', 'occurredAt'])
export class InventoryMovement extends BaseEntity {
  @Column({ type: 'uuid', name: 'product_id' })
  productId: string;

  @Column({ type: 'uuid', name: 'warehouse_id' })
  warehouseId: string;

  @Column({ type: 'varchar', length: 16 })
  source: StockSource;

  /** Source-provided reason, e.g. ERP SALE / RECEIVE / ADJUST. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  reason: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 4, name: 'quantity_after' })
  quantityAfter: string;

  @Column({ type: 'varchar', length: 12 })
  status: MovementStatus;

  /** Where it came from, e.g. the erp_ingest_records id. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  ref: string | null;

  /** When the change happened at the source (ERP CHANGED_AT), not when we received it. */
  @Column({ type: 'timestamp with time zone', name: 'occurred_at' })
  occurredAt: Date;
}
