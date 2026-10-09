import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import type { PromotionValue } from './promotion-value';

/**
 * josh's price tables as josh's TypeORM maps them, only the columns josh's resolveSkuPrice /
 * loadMechanicPricingByProductIds read. Registered on the read-only josh replica DataSource, so the
 * copied resolver runs exactly as in josh — `date` columns come back as 'YYYY-MM-DD' strings like
 * there. Not `*.entity.ts`: commerce's own DataSource must never load these.
 */

@Entity('product_inventory')
export class ProductInventory {
  @PrimaryColumn('uuid') product_inventory_id: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true }) selling_price: number | null;
}

@Entity('private_price')
export class PrivatePrice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) company_id: string;
  @Column({ type: 'uuid' }) product_inventory_id: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) private_selling_price: number;
  @Column({ type: 'date' }) start_date: Date;
  @Column({ type: 'date', nullable: true }) end_date: Date;
}

@Entity('branch_contract_price')
export class BranchContractPrice {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) branch_id: string;
  @Column({ type: 'uuid' }) product_inventory_id: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) contract_price: number;
  @Column({ type: 'date' }) start_date: Date;
  @Column({ type: 'date', nullable: true }) end_date: Date | null;
}

@Entity('product_branch_specials')
export class ProductBranchSpecial {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) branch_id: string;
  @Column({ type: 'uuid' }) product_inventory_id: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) special_price: number;
  @Column({ type: 'timestamp with time zone' }) start_date: Date;
  @Column({ type: 'timestamp with time zone' }) end_date: Date;
  @Column({ type: 'boolean' }) is_active: boolean;
}

@Entity('promotion_quantity_rules')
export class PromotionQuantityRule {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) product_inventory_id: string;
  @Column({ type: 'int' }) min_qty: number;
  @Column({ type: 'int', nullable: true }) max_qty: number | null;
  @Column({ type: 'numeric', precision: 12, scale: 2 }) promotion_price: number;
  @Column({ type: 'varchar', length: 50, nullable: true }) unit_label: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) badge_text: string | null;
  @Column({ type: 'int' }) sort_order: number;
  @Column({ type: 'boolean' }) is_active: boolean;
}

@Entity('promotion_mechanics')
export class PromotionMechanic {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 155 }) name: string;
  @Column({ type: 'timestamp with time zone' }) start_date: Date;
  @Column({ type: 'timestamp with time zone' }) end_date: Date;
  @Column({ type: 'varchar', length: 100, nullable: true }) badge_text: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) badge_text_en: string | null;
  @Column({ type: 'jsonb', nullable: true }) value: PromotionValue | null;
  @Column({ type: 'boolean' }) is_active: boolean;
  @Column({ type: 'int', nullable: true }) max_units: number | null;
  @Column({ type: 'int' }) sold_units: number;
  @Column({ type: 'varchar', length: 20 }) audience: string;
  /** `select: false` in josh too — loaders add it explicitly. */
  @Column({ type: 'jsonb', select: false }) audience_company_ids?: string[];
  @Column({ type: 'uuid', nullable: true }) campaign_id: string | null;
  @OneToMany(() => PromotionMechanicSkuItem, (item) => item.promotionMechanic) skuItems: PromotionMechanicSkuItem[];
}

@Entity('promotion_mechanic_sku_items')
export class PromotionMechanicSkuItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) promotion_mechanic_id: string;
  @ManyToOne(() => PromotionMechanic, (mechanic) => mechanic.skuItems)
  @JoinColumn({ name: 'promotion_mechanic_id' })
  promotionMechanic: PromotionMechanic;
  @Column({ type: 'uuid', nullable: true }) product_inventory_id: string | null;
  @Column({ type: 'varchar', length: 100 }) sku: string;
  @Column({ type: 'int' }) sort_order: number;
  @Column({ type: 'varchar', length: 100, nullable: true }) badge_text: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) badge_text_en: string | null;
  @Column({ type: 'varchar', length: 50, nullable: true }) unit_label: string | null;
  @Column({ type: 'jsonb' }) quantity_rules: Array<{ min_qty: number; max_qty?: number; promotion_price: number; unit_label?: string; badge_text?: string }>;
  @Column({ type: 'jsonb', nullable: true }) value: PromotionValue | null;
}

@Entity('promotion_pages')
export class PromotionPage {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar' }) slug: string;
  @Column({ type: 'uuid', nullable: true }) promotion_mechanic_id: string | null;
  @Column({ type: 'uuid', nullable: true }) campaign_id: string | null;
  @Column({ type: 'boolean' }) is_active: boolean;
  @Column({ type: 'timestamp with time zone', nullable: true }) start_date: Date | null;
  @Column({ type: 'timestamp with time zone', nullable: true }) end_date: Date | null;
  @Column({ type: 'timestamp with time zone' }) updated_at: Date;
}

export const JOSH_PRICING_TABLES = [ProductInventory, PrivatePrice, BranchContractPrice, ProductBranchSpecial, PromotionQuantityRule, PromotionMechanic, PromotionMechanicSkuItem, PromotionPage];
