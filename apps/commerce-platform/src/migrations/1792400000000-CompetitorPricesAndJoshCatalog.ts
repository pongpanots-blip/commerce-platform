import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * josh_catalog_products: commerce's read-only copy of josh's catalog (JoshCatalogSyncService).
 * competitor_prices: moved from josh — same DDL as josh migration 1792250000000 (+ captured_source_version,
 * scraping_source_id) so rows import 1:1 with the same ids. product_id now points at the catalog copy.
 */
export class CompetitorPricesAndJoshCatalog1792400000000 implements MigrationInterface {
  name = 'CompetitorPricesAndJoshCatalog1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "josh_catalog_products" ("id" uuid NOT NULL, "sku" character varying(100) NOT NULL, "status" character varying(20), "brand_code" character varying(100), "brand_name" character varying(255), "country_code_source" character varying(50), "storage_temperature" character varying(50), "packaging_type" character varying(50), "pack_size" character varying(50), "units_per_box" character varying(50), "weight_per_unit" character varying(50), "selling_unit" character varying(50), "vat_type" character varying(50), "selling_unit_price" numeric(12,2), "translations" jsonb NOT NULL DEFAULT '[]'::jsonb, "josh_updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "removed_at" TIMESTAMP WITH TIME ZONE, "synced_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_josh_catalog_products" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "ix_josh_catalog_product_sku" ON "josh_catalog_products" ("sku")`);
    await queryRunner.query(`CREATE TABLE "competitor_prices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "our_weight_kg" numeric(12,4) NOT NULL, "source_url" character varying(2000) NOT NULL, "scraping_source_id" uuid, "competitor_name" character varying(500) NOT NULL, "competitor_sku" character varying(100) NOT NULL DEFAULT '', "competitor_weight_kg" numeric(12,4) NOT NULL, "source_context" character varying(1000) NOT NULL, "vat_included" boolean NOT NULL DEFAULT false, "collection_allowed" boolean NOT NULL DEFAULT false, "auto_refresh" boolean NOT NULL DEFAULT false, "verified_fingerprint" character varying(64), "verified_by" character varying(100), "verified_at" TIMESTAMP WITH TIME ZONE, "match_note" character varying(1000) NOT NULL DEFAULT '', "price_inc_vat" numeric(12,2), "observed_at" TIMESTAMP WITH TIME ZONE, "capture_method" character varying(20), "captured_source_version" character varying(64), "last_error" character varying(500), "revision" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_competitor_price_product_url" UNIQUE ("product_id", "source_url"), CONSTRAINT "ck_competitor_price_positive_price" CHECK ("price_inc_vat" IS NULL OR "price_inc_vat" > 0), CONSTRAINT "ck_competitor_price_positive_weights" CHECK ("our_weight_kg" > 0 AND "competitor_weight_kg" > 0), CONSTRAINT "PK_bc533b625afbd864d68f9cf8136" PRIMARY KEY ("id"))`);
    await queryRunner.query(`ALTER TABLE "competitor_prices" ADD CONSTRAINT "FK_competitor_prices_product" FOREIGN KEY ("product_id") REFERENCES "josh_catalog_products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "competitor_prices" ADD CONSTRAINT "FK_competitor_prices_scraping_source" FOREIGN KEY ("scraping_source_id") REFERENCES "scraping_sources"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "competitor_prices"`);
    await queryRunner.query(`DROP TABLE "josh_catalog_products"`);
  }
}
