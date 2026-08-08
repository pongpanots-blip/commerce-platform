import { MigrationInterface, QueryRunner } from "typeorm";

export class Cycle3bPortalIngest1784346928501 implements MigrationInterface {
    name = 'Cycle3bPortalIngest1784346928501'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "erp_ingest_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "integration_id" uuid NOT NULL, "entity_type" character varying(16) NOT NULL, "external_id" character varying(128), "raw_payload" jsonb NOT NULL, "parsed_payload" jsonb, "status" character varying(12) NOT NULL DEFAULT 'received', "error" text, "applied_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a95c0c94aabe6609cf6aef919f2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9cff392afab310e39ee7e9448f" ON "erp_ingest_records" ("external_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_501b97427b68e0806a8d90b214" ON "erp_ingest_records" ("entity_type", "status") `);
        await queryRunner.query(`CREATE TABLE "api_keys" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "account_id" uuid NOT NULL, "name" character varying(128) NOT NULL, "key_prefix" character varying(16) NOT NULL, "key_hash" character varying(64) NOT NULL, "scope" character varying(24) NOT NULL DEFAULT 'storefront', "active" boolean NOT NULL DEFAULT true, "last_used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_5c8a79801b44bd27b79228e1dad" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_57384430aa1959f4578046c9b8" ON "api_keys" ("key_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_decaf331589778e33441b2a8d9" ON "api_keys" ("account_id") `);
        await queryRunner.query(`ALTER TABLE "webhook_subscriptions" ADD "account_id" uuid`);
        await queryRunner.query(`ALTER TABLE "users" ADD "role" character varying(24) NOT NULL DEFAULT 'developer'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
        await queryRunner.query(`ALTER TABLE "webhook_subscriptions" DROP COLUMN "account_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_decaf331589778e33441b2a8d9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_57384430aa1959f4578046c9b8"`);
        await queryRunner.query(`DROP TABLE "api_keys"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_501b97427b68e0806a8d90b214"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9cff392afab310e39ee7e9448f"`);
        await queryRunner.query(`DROP TABLE "erp_ingest_records"`);
    }

}
