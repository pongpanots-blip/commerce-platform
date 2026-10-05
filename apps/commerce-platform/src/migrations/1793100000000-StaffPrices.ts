import { MigrationInterface, QueryRunner } from 'typeorm';

/** Customer and branch contract prices owned by commerce (written to josh through josh's services). */
export class StaffPrices1793100000000 implements MigrationInterface {
  name = 'StaffPrices1793100000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "staff_prices" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "kind" character varying(10) NOT NULL,
      "company_id" uuid,
      "branch_id" uuid,
      "product_inventory_id" uuid NOT NULL,
      "sku" character varying(100),
      "price" numeric(12,2) NOT NULL,
      "contract_ref" character varying(100),
      "start_date" date NOT NULL,
      "end_date" date,
      "josh_id" uuid,
      "status" character varying(10) NOT NULL,
      "sync_error" character varying(500),
      "updated_by" character varying(255),
      "deleted_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_staff_prices" PRIMARY KEY ("id"),
      CONSTRAINT "uq_staff_prices_josh_id" UNIQUE ("josh_id"),
      CONSTRAINT "ck_staff_prices_scope" CHECK (("kind" = 'customer' AND "company_id" IS NOT NULL) OR ("kind" = 'contract' AND "branch_id" IS NOT NULL)),
      CONSTRAINT "ck_staff_prices_price" CHECK ("price" >= 0))`);
    await queryRunner.query(`CREATE INDEX "ix_staff_prices_scope" ON "staff_prices" ("kind", "company_id", "branch_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_staff_prices_customer" ON "staff_prices" ("company_id", "product_inventory_id") WHERE "kind" = 'customer' AND "deleted_at" IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "staff_prices"`);
  }
}
