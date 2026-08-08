import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../../shared-kernel/domain/base.entity';

export type FulfillmentMode = 'on_hand' | 'to_order' | 'both';

// SKU uniqueness is enforced per-organization by a functional unique index in
// the migration (COALESCE on organization_id) so null-org duplicates also fail.
@Entity('products')
export class Product extends BaseEntity {
  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'varchar', length: 191 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'uuid', name: 'brand_id', nullable: true })
  brandId: string | null;

  @Column({ type: 'uuid', name: 'category_id', nullable: true })
  categoryId: string | null;

  @Column({ type: 'uuid', name: 'supplier_id', nullable: true })
  supplierId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  /** How lines for this SKU are fulfilled. 'both' tries on_hand only — NO fallback. */
  @Column({ type: 'varchar', length: 12, name: 'fulfillment_mode', default: 'on_hand' })
  fulfillmentMode: FulfillmentMode;

  /** to_order promise = order date + lead time. Null → settings/env default. */
  @Column({ type: 'int', name: 'lead_time_days', nullable: true })
  leadTimeDays: number | null;
}
