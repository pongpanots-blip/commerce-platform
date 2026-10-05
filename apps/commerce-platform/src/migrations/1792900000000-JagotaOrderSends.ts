import { MigrationInterface, QueryRunner } from 'typeorm';

/** Step 2 of "orders reach Jagota through commerce": what commerce sent to Jagota for josh, one row per order reference. */
export class JagotaOrderSends1792900000000 implements MigrationInterface {
  name = 'JagotaOrderSends1792900000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "jagota_order_sends" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "order_reference" character varying(64) NOT NULL,
      "status" character varying(12) NOT NULL,
      "request" jsonb NOT NULL,
      "response" jsonb,
      "attempts" integer NOT NULL DEFAULT 1,
      "last_error" character varying(500),
      "doc_book" character varying(20),
      "doc_no" character varying(40),
      "duration_ms" integer,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_jagota_order_sends" PRIMARY KEY ("id"),
      CONSTRAINT "uq_jagota_order_sends_reference" UNIQUE ("order_reference"))`);
    await queryRunner.query(`CREATE INDEX "ix_jagota_order_sends_updated" ON "jagota_order_sends" ("updated_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "jagota_order_sends"`);
  }
}
