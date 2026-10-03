import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scraping catalog moved from josh (josh migration 1792250001000-ScrapingCatalog).
 * Same DDL — table, column, index and FK names — so rows import 1:1 with the
 * same ids (npm run import-scraping-from-josh). The competitor_prices part of
 * the josh migration stays in josh.
 */
export class ScrapingCatalog1792300000000 implements MigrationInterface {
  name = 'ScrapingCatalog1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "scraping_sources" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "origin" character varying(500) NOT NULL, "config" jsonb NOT NULL, "revision" integer NOT NULL DEFAULT '1', "enabled" boolean NOT NULL DEFAULT false, "status" character varying(20) NOT NULL DEFAULT 'idle', "progress" jsonb NOT NULL DEFAULT '{"pending":[],"visited":[],"successful":0,"failed":0,"items":0}'::jsonb, "lease_until" TIMESTAMP WITH TIME ZONE, "last_error" character varying(500), "last_run_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_scraping_source_origin" UNIQUE ("origin"), CONSTRAINT "PK_5b89f0bf1a2ff541ce10a4c7daa" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "scraped_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source_id" uuid NOT NULL, "url" character varying(2000) NOT NULL, "page_url" character varying(2000) NOT NULL, "name" character varying(500) NOT NULL, "sku" character varying(100) NOT NULL DEFAULT '', "fields" jsonb NOT NULL, "price_inc_vat" numeric(12,2), "weight_kg" numeric(12,4), "currency" character varying(3) NOT NULL, "config_version" character varying(64) NOT NULL, "observed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_scraped_item_source_url" UNIQUE ("source_id", "url"), CONSTRAINT "PK_42689075b4a2121ba00dfc7eaa1" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "ix_scraped_item_source_observed" ON "scraped_items" ("source_id", "observed_at")`);
    await queryRunner.query(`ALTER TABLE "scraped_items" ADD CONSTRAINT "FK_4c499f1c1f832fb203917938646" FOREIGN KEY ("source_id") REFERENCES "scraping_sources"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "scraped_items"`);
    await queryRunner.query(`DROP TABLE "scraping_sources"`);
  }
}
