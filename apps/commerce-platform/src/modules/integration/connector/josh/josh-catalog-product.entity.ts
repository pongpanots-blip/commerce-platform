import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type JoshProductTranslation = {
  language_code: string; product_name: string; product_description: string | null; product_detail: string | null;
};

/**
 * Read-only copy of josh's catalog (product_inventory + product_translation),
 * pulled by JoshCatalogSyncService. Same id as josh's product_inventory_id.
 * Column values are kept exactly as josh stores them (numeric as string), so
 * fingerprints computed here match the ones josh computed before the move.
 * josh stays the writer; nothing here is pushed back.
 */
@Entity('josh_catalog_products')
@Index('ix_josh_catalog_product_sku', ['sku'])
export class JoshCatalogProduct {
  @PrimaryColumn('uuid') id: string;
  @Column({ length: 100 }) sku: string;
  @Column({ type: 'varchar', length: 20, nullable: true }) status: string | null;
  @Column({ name: 'brand_code', type: 'varchar', length: 100, nullable: true }) brandCode: string | null;
  @Column({ name: 'brand_name', type: 'varchar', length: 255, nullable: true }) brandName: string | null;
  @Column({ name: 'country_code_source', type: 'varchar', length: 50, nullable: true }) countryCodeSource: string | null;
  @Column({ name: 'storage_temperature', type: 'varchar', length: 50, nullable: true }) storageTemperature: string | null;
  @Column({ name: 'packaging_type', type: 'varchar', length: 50, nullable: true }) packagingType: string | null;
  @Column({ name: 'pack_size', type: 'varchar', length: 50, nullable: true }) packSize: string | null;
  @Column({ name: 'units_per_box', type: 'varchar', length: 50, nullable: true }) unitsPerBox: string | null;
  @Column({ name: 'weight_per_unit', type: 'varchar', length: 50, nullable: true }) weightPerUnit: string | null;
  @Column({ name: 'selling_unit', type: 'varchar', length: 50, nullable: true }) sellingUnit: string | null;
  @Column({ name: 'vat_type', type: 'varchar', length: 50, nullable: true }) vatType: string | null;
  /** The live selling price (after MER approval in josh), VAT included. */
  @Column({ name: 'selling_unit_price', type: 'numeric', precision: 12, scale: 2, nullable: true }) sellingUnitPrice: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) translations: JoshProductTranslation[];
  @Column({ name: 'josh_updated_at', type: 'timestamptz' }) joshUpdatedAt: Date;
  /** Set when the product disappears from josh. Rows are never deleted (comparisons keep their history). */
  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true }) removedAt: Date | null;
  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' }) syncedAt: Date;
}
