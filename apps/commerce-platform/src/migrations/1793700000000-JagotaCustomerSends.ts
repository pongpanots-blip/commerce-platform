import { MigrationInterface, QueryRunner } from 'typeorm';

/** Customers reach Jagota through commerce: one row per registration email (dedupe + record of what was sent). */
export class JagotaCustomerSends1793700000000 implements MigrationInterface {
  name = 'JagotaCustomerSends1793700000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "jagota_customer_sends" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "email" character varying(254) NOT NULL,
      "status" character varying(12) NOT NULL,
      "request" jsonb NOT NULL,
      "response" jsonb,
      "cust_code" character varying(40),
      "attempts" integer NOT NULL DEFAULT 1,
      "last_error" character varying(500),
      "duration_ms" integer,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_jagota_customer_sends" PRIMARY KEY ("id"),
      CONSTRAINT "uq_jagota_customer_sends_email" UNIQUE ("email"))`);
    await queryRunner.query(`CREATE INDEX "ix_jagota_customer_sends_updated" ON "jagota_customer_sends" ("updated_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "jagota_customer_sends"`);
  }
}
