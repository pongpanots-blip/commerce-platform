import { MigrationInterface, QueryRunner } from 'typeorm';

/** Copy of josh jagota_order_sync (ERP send history), imported from josh's replica. */
export class JagotaOrderSyncHistory1793200000000 implements MigrationInterface {
  name = 'JagotaOrderSyncHistory1793200000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "jagota_order_sync_history" (
      "id" uuid NOT NULL,
      "order_id" uuid NOT NULL,
      "order_number" character varying(64),
      "shipment_id" uuid,
      "payment_success" boolean NOT NULL,
      "payment_method" character varying(30) NOT NULL,
      "request_json" jsonb,
      "sync_status" character varying(20) NOT NULL,
      "jagota_response_json" jsonb,
      "transaction_type" character varying(100),
      "doc_book" character varying(100),
      "doc_no" character varying(100),
      "order_taking_doc_seq" character varying(100),
      "error_message" text,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "imported_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_jagota_order_sync_history" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "ix_jagota_sync_history_created_at" ON "jagota_order_sync_history" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "ix_jagota_sync_history_order_id" ON "jagota_order_sync_history" ("order_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "jagota_order_sync_history"`);
  }
}
