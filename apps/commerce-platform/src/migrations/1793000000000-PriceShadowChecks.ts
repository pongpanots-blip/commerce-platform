import { MigrationInterface, QueryRunner } from 'typeorm';

/** Shadow mode for "commerce owns prices": josh order lines re-priced with josh's resolver and compared. */
export class PriceShadowChecks1793000000000 implements MigrationInterface {
  name = 'PriceShadowChecks1793000000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "price_shadow_checks" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "josh_order_item_id" uuid NOT NULL,
      "order_number" character varying(64),
      "sku" character varying(100),
      "quantity" integer NOT NULL,
      "ordered_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "josh_unit_price" numeric(12,2) NOT NULL,
      "josh_source" character varying(30),
      "josh_mechanic_id" uuid,
      "commerce_unit_price" numeric(12,2),
      "commerce_source" character varying(30),
      "commerce_mechanic_id" uuid,
      "matched" boolean NOT NULL,
      "diffs" jsonb NOT NULL DEFAULT '[]',
      "note" text,
      "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_price_shadow_checks" PRIMARY KEY ("id"),
      CONSTRAINT "uq_price_shadow_order_item" UNIQUE ("josh_order_item_id"))`);
    await queryRunner.query(`CREATE INDEX "ix_price_shadow_ordered_at" ON "price_shadow_checks" ("ordered_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "price_shadow_checks"`);
  }
}
