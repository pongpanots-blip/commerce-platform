import { MigrationInterface, QueryRunner } from 'typeorm';

/** Shadow mode for "orders reach Jagota through commerce": each josh send compared with the request commerce would build. */
export class JagotaShadowChecks1792800000000 implements MigrationInterface {
  name = 'JagotaShadowChecks1792800000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "jagota_shadow_checks" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "josh_sync_id" character varying(64) NOT NULL,
      "josh_order_id" uuid,
      "josh_shipment_id" uuid,
      "order_reference" character varying(64),
      "josh_sync_status" character varying(20),
      "josh_sent_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "matched" boolean NOT NULL,
      "diffs" jsonb NOT NULL DEFAULT '[]',
      "josh_request" jsonb,
      "commerce_request" jsonb,
      "note" text,
      "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_jagota_shadow_checks" PRIMARY KEY ("id"),
      CONSTRAINT "uq_jagota_shadow_josh_sync" UNIQUE ("josh_sync_id"))`);
    await queryRunner.query(`CREATE INDEX "ix_jagota_shadow_sent_at" ON "jagota_shadow_checks" ("josh_sent_at")`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "jagota_shadow_checks"`);
  }
}
