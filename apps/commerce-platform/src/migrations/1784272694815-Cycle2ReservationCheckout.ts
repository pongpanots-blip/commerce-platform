import { MigrationInterface, QueryRunner } from "typeorm";

export class Cycle2ReservationCheckout1784272694815 implements MigrationInterface {
    name = 'Cycle2ReservationCheckout1784272694815'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "erp_stub_stock" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "sku" character varying(64) NOT NULL, "qty" integer NOT NULL DEFAULT '0', CONSTRAINT "UQ_50fc492cb4a8ddb2f80f0149b5e" UNIQUE ("sku"), CONSTRAINT "PK_8615be6795b0d778115518a576a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "erp_stub_reservations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "idempotency_key" character varying(128) NOT NULL, "sku" character varying(64) NOT NULL, "qty" integer NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'held', CONSTRAINT "UQ_279c2773874070c88b9f0abb622" UNIQUE ("idempotency_key"), CONSTRAINT "PK_8be6b72f68d26348f74e20c65fd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_add04986155edb454074209979" ON "erp_stub_reservations" ("sku") `);
        await queryRunner.query(`CREATE TABLE "reservations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "order_id" uuid NOT NULL, "order_line_id" uuid NOT NULL, "product_id" uuid NOT NULL, "sku" character varying(64) NOT NULL, "qty" numeric(14,4) NOT NULL, "mode" character varying(12) NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'pending', "external_ref" character varying(128), "integration_id" uuid, "idempotency_key" character varying(128) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE, "promised_date" date, "fail_reason" character varying(255), CONSTRAINT "UQ_6b0a68b6082ee14612e6b5cbc44" UNIQUE ("idempotency_key"), CONSTRAINT "PK_da95cef71b617ac35dc5bcda243" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ea9ecedd029b9d302218892058" ON "reservations" ("status", "expires_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_82ff9434d944488ca3bf1946c4" ON "reservations" ("order_id") `);
        await queryRunner.query(`CREATE TABLE "order_fulfillments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "order_id" uuid NOT NULL, "order_line_id" uuid NOT NULL, "source" character varying(16) NOT NULL DEFAULT 'erp', "mode" character varying(12) NOT NULL, "status" character varying(24) NOT NULL DEFAULT 'pending', "reservation_id" uuid, CONSTRAINT "UQ_925e16bcba4350ddf5988ce0a18" UNIQUE ("order_line_id"), CONSTRAINT "PK_f01b61fa5f54b3fc235cdc759ce" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7d1d5591f1e9fbc070714bd5dd" ON "order_fulfillments" ("order_id") `);
        await queryRunner.query(`ALTER TABLE "products" ADD "fulfillment_mode" character varying(12) NOT NULL DEFAULT 'on_hand'`);
        await queryRunner.query(`ALTER TABLE "products" ADD "lead_time_days" integer`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "idempotency_key" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "UQ_59d6b7756aeb6cbb43a093d15a1" UNIQUE ("idempotency_key")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "UQ_59d6b7756aeb6cbb43a093d15a1"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "idempotency_key"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "lead_time_days"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "fulfillment_mode"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7d1d5591f1e9fbc070714bd5dd"`);
        await queryRunner.query(`DROP TABLE "order_fulfillments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_82ff9434d944488ca3bf1946c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ea9ecedd029b9d302218892058"`);
        await queryRunner.query(`DROP TABLE "reservations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_add04986155edb454074209979"`);
        await queryRunner.query(`DROP TABLE "erp_stub_reservations"`);
        await queryRunner.query(`DROP TABLE "erp_stub_stock"`);
    }

}
