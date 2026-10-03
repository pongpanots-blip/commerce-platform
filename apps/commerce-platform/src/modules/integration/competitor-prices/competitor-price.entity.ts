import { Check, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn, VersionColumn } from 'typeorm';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { ScrapingSource } from '../../platform/scraping/domain/scraping-source.entity';

/**
 * Moved from josh (same table, columns and ids — import-from-josh copies 1:1).
 * One catalog SKU can track several competitor product pages. Latest observation only.
 * `product` is commerce's copy of josh's catalog (JoshCatalogProduct).
 */
@Entity('competitor_prices')
@Unique('uq_competitor_price_product_url', ['productId', 'sourceUrl'])
@Check('ck_competitor_price_positive_weights', '"our_weight_kg" > 0 AND "competitor_weight_kg" > 0')
@Check('ck_competitor_price_positive_price', '"price_inc_vat" IS NULL OR "price_inc_vat" > 0')
export class CompetitorPrice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'product_id', type: 'uuid' }) productId: string;
  @ManyToOne(() => JoshCatalogProduct, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_competitor_prices_product' }) product: JoshCatalogProduct;
  @Column({ name: 'our_weight_kg', type: 'numeric', precision: 12, scale: 4 }) ourWeightKg: number;
  @Column({ name: 'source_url', type: 'varchar', length: 2000 }) sourceUrl: string;
  @Column({ name: 'scraping_source_id', type: 'uuid', nullable: true }) scrapingSourceId: string | null;
  @ManyToOne(() => ScrapingSource, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'scraping_source_id', foreignKeyConstraintName: 'FK_competitor_prices_scraping_source' }) scrapingSource: ScrapingSource | null;
  @Column({ name: 'competitor_name', type: 'varchar', length: 500 }) competitorName: string;
  @Column({ name: 'competitor_sku', type: 'varchar', length: 100, default: '' }) competitorSku: string;
  @Column({ name: 'competitor_weight_kg', type: 'numeric', precision: 12, scale: 4 }) competitorWeightKg: number;
  @Column({ name: 'source_context', type: 'varchar', length: 1000 }) sourceContext: string;
  @Column({ name: 'vat_included', default: false }) vatIncluded: boolean;
  @Column({ name: 'collection_allowed', default: false }) collectionAllowed: boolean;
  @Column({ name: 'auto_refresh', default: false }) autoRefresh: boolean;
  @Column({ name: 'verified_fingerprint', type: 'varchar', length: 64, nullable: true }) verifiedFingerprint: string | null;
  /** Staff email (josh rows: the josh admin's email, mapped on import). */
  @Column({ name: 'verified_by', type: 'varchar', length: 100, nullable: true }) verifiedBy: string | null;
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true }) verifiedAt: Date | null;
  @Column({ name: 'match_note', type: 'varchar', length: 1000, default: '' }) matchNote: string;
  @Column({ name: 'price_inc_vat', type: 'numeric', precision: 12, scale: 2, nullable: true }) priceIncVat: number | null;
  @Column({ name: 'observed_at', type: 'timestamptz', nullable: true }) observedAt: Date | null;
  @Column({ name: 'capture_method', type: 'varchar', length: 20, nullable: true }) captureMethod: 'manual' | 'automatic' | null;
  @Column({ name: 'captured_source_version', type: 'varchar', length: 64, nullable: true }) capturedSourceVersion: string | null;
  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true }) lastError: string | null;
  @VersionColumn() revision: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
