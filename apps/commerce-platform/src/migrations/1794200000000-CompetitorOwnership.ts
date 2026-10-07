import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 1 (plan 2026-10-07): commerce owns competitor prices.
 * - josh_catalog_products is fed by josh catalog.snapshot events (version-guarded) instead of a replica read,
 *   plus what the review grid shows (category names, first image) and what the offer text needs (ordering price/unit).
 * - josh's CompetitorReview schema (josh migration 1792270000000): typed pack sizes, "not this one" answers,
 *   reviewed SKUs — keyed to the catalog copy instead of josh's product_inventory.
 */
export class CompetitorOwnership1794200000000 implements MigrationInterface {
  name = 'CompetitorOwnership1794200000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE josh_catalog_products
      ADD COLUMN source_version bigint NOT NULL DEFAULT 0,
      ADD COLUMN ordering_price numeric(12,2), ADD COLUMN order_taking_unit varchar(50),
      ADD COLUMN category_name_th varchar(100), ADD COLUMN category_name_en varchar(100), ADD COLUMN image_url varchar(2000)`);
    await q.query(`ALTER TABLE competitor_prices
      ADD COLUMN competitor_unit varchar(8) NOT NULL DEFAULT 'kg', ADD COLUMN competitor_qty_min numeric(12,4),
      ADD COLUMN competitor_qty_max numeric(12,4), ADD COLUMN competitor_pack_count integer NOT NULL DEFAULT 1,
      ADD CONSTRAINT ck_competitor_price_unit CHECK (competitor_unit IN ('kg', 'l', 'piece')),
      ADD CONSTRAINT ck_competitor_price_pack_count CHECK (competitor_pack_count >= 1)`);
    await q.query(`CREATE TABLE competitor_match_rejections (
      id uuid NOT NULL DEFAULT uuid_generate_v4(), product_id uuid NOT NULL, source_url varchar(2000) NOT NULL,
      created_by varchar(100) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_competitor_match_rejections" PRIMARY KEY (id),
      CONSTRAINT uq_competitor_match_rejection UNIQUE (product_id, source_url),
      CONSTRAINT "FK_competitor_match_rejection_product" FOREIGN KEY (product_id) REFERENCES josh_catalog_products(id) ON DELETE CASCADE)`);
    await q.query(`CREATE TABLE competitor_match_reviews (
      product_id uuid NOT NULL, reviewed_by varchar(100) NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_competitor_match_reviews" PRIMARY KEY (product_id),
      CONSTRAINT "FK_competitor_match_review_product" FOREIGN KEY (product_id) REFERENCES josh_catalog_products(id) ON DELETE CASCADE)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE competitor_match_reviews`);
    await q.query(`DROP TABLE competitor_match_rejections`);
    await q.query(`ALTER TABLE competitor_prices DROP CONSTRAINT ck_competitor_price_pack_count, DROP CONSTRAINT ck_competitor_price_unit,
      DROP COLUMN competitor_pack_count, DROP COLUMN competitor_qty_max, DROP COLUMN competitor_qty_min, DROP COLUMN competitor_unit`);
    await q.query(`ALTER TABLE josh_catalog_products DROP COLUMN image_url, DROP COLUMN category_name_en, DROP COLUMN category_name_th,
      DROP COLUMN order_taking_unit, DROP COLUMN ordering_price, DROP COLUMN source_version`);
  }
}
