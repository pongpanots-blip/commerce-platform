import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type StaffPriceKind = 'customer' | 'contract';
/** synced = josh holds exactly this · pending = being sent · failed = josh refused / unreachable (retry). */
export type StaffPriceStatus = 'synced' | 'pending' | 'failed';

/**
 * Customer prices (josh private_price: one per company + product) and branch contract prices
 * (josh branch_contract_price), owned by commerce once josh runs with COMMERCE_OWNS_PRICES=true.
 * Edited here, then written to josh through josh's own services; josh keeps its copy for the
 * storefront. Rows josh creates itself (ERP quotations, CS price requests) are imported.
 */
@Entity('staff_prices')
@Index('ix_staff_prices_scope', ['kind', 'companyId', 'branchId'])
@Index('uq_staff_prices_customer', ['companyId', 'productInventoryId'], { unique: true, where: `"kind" = 'customer' AND "deleted_at" IS NULL` })
export class StaffPrice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 10 }) kind: StaffPriceKind;
  @Column({ name: 'company_id', type: 'uuid', nullable: true }) companyId: string | null;
  @Column({ name: 'branch_id', type: 'uuid', nullable: true }) branchId: string | null;
  @Column({ name: 'product_inventory_id', type: 'uuid' }) productInventoryId: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) sku: string | null;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) price: string;
  @Column({ name: 'contract_ref', type: 'varchar', length: 100, nullable: true }) contractRef: string | null;
  /** 'YYYY-MM-DD' — josh compares calendar days. */
  @Column({ name: 'start_date', type: 'date' }) startDate: string;
  @Column({ name: 'end_date', type: 'date', nullable: true }) endDate: string | null;
  /** josh row id once josh holds it. */
  @Column({ name: 'josh_id', type: 'uuid', nullable: true, unique: true }) joshId: string | null;
  @Column({ length: 10 }) status: StaffPriceStatus;
  @Column({ name: 'sync_error', type: 'varchar', length: 500, nullable: true }) syncError: string | null;
  /** Who changed it last: a commerce staff email, or 'josh' for rows josh created / changed itself. */
  @Column({ name: 'updated_by', type: 'varchar', length: 255, nullable: true }) updatedBy: string | null;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt: Date | null;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' }) createdAt: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' }) updatedAt: Date;
}
