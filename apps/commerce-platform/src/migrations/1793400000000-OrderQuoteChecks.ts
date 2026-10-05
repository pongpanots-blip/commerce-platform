import { MigrationInterface, QueryRunner } from 'typeorm';

/** Checkout shadow quote: josh order totals rebuilt by commerce with josh's checkout math. */
export class OrderQuoteChecks1793400000000 implements MigrationInterface {
  name = 'OrderQuoteChecks1793400000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "order_quote_checks" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "josh_order_id" uuid NOT NULL,
      "order_number" character varying(64),
      "ordered_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "matched" boolean NOT NULL,
      "diffs" jsonb NOT NULL DEFAULT '[]',
      "josh_totals" jsonb NOT NULL,
      "commerce_totals" jsonb,
      "note" text,
      "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_order_quote_checks" PRIMARY KEY ("id"),
      CONSTRAINT "uq_order_quote_checks_josh_order_id" UNIQUE ("josh_order_id"))`);
    await queryRunner.query(`CREATE INDEX "ix_order_quote_checks_ordered_at" ON "order_quote_checks" ("ordered_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_quote_checks"`);
  }
}
