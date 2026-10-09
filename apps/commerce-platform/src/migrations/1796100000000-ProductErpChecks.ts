import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-SKU ERP lookups for a product data issue list (e.g. P-12 "in ERP but missing from the feed"), written by
 * `npm run erp-product-check`. One row per (check_code, sku), overwritten on re-run; `erp` keeps the raw product
 * the ERP node API returned (null when it returned nothing).
 */
export class ProductErpChecks1796100000000 implements MigrationInterface {
  name = 'ProductErpChecks1796100000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "product_erp_checks" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "check_code" character varying(16) NOT NULL,
      "sku" character varying(100) NOT NULL,
      "verdict" character varying(16) NOT NULL,
      "erp_status" character varying(4),
      "is_enable" character varying(4),
      "erp" jsonb,
      "source" character varying(255) NOT NULL,
      "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_product_erp_checks" PRIMARY KEY ("id"),
      CONSTRAINT "uq_product_erp_checks_code_sku" UNIQUE ("check_code", "sku"))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "product_erp_checks"`);
  }
}
