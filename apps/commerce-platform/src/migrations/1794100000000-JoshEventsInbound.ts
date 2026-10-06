import { MigrationInterface, QueryRunner } from 'typeorm';

/** josh → commerce events (spec 2026-10-06 §2.2): version on the order copy, customer copy, ERP fallback calls. */
export class JoshEventsInbound1794100000000 implements MigrationInterface {
  name = 'JoshEventsInbound1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "josh_orders" ADD COLUMN IF NOT EXISTS "source_version" bigint NOT NULL DEFAULT 0`);
    await queryRunner.query(`CREATE TABLE "josh_customers" ("id" uuid NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "source_version" bigint NOT NULL DEFAULT 0, "deleted_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_josh_customers" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "josh_erp_fallback_calls" ("josh_outbox_id" bigint NOT NULL, "method" character varying(10) NOT NULL, "path" character varying(200) NOT NULL, "body" jsonb, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_josh_erp_fallback_calls" PRIMARY KEY ("josh_outbox_id"))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "josh_erp_fallback_calls"`);
    await queryRunner.query(`DROP TABLE "josh_customers"`);
    await queryRunner.query(`ALTER TABLE "josh_orders" DROP COLUMN "source_version"`);
  }
}
