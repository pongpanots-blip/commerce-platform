import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWebhookSubscriptions1784110967584 implements MigrationInterface {
    name = 'AddWebhookSubscriptions1784110967584'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "webhook_subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "name" character varying(128) NOT NULL, "target_url" character varying(1024) NOT NULL, "event_types" jsonb NOT NULL DEFAULT '[]', "secret" character varying(255), "active" boolean NOT NULL DEFAULT true, "description" text, CONSTRAINT "PK_bf631ae77d39849d599817fb6f4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ee0122621cdc85e8717adf7554" ON "webhook_subscriptions" ("active") `);
        await queryRunner.query(`CREATE TABLE "webhook_deliveries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "organization_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "subscription_id" uuid NOT NULL, "event_type" character varying(191) NOT NULL, "event_id" uuid, "target_url" character varying(1024) NOT NULL, "payload" jsonb NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'pending', "status_code" integer, "attempts" integer NOT NULL DEFAULT '0', "error" text, CONSTRAINT "PK_535dd409947fb6d8fc6dfc0112a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1ba4ee138615fded8df0ab1d03" ON "webhook_deliveries" ("subscription_id", "status") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_1ba4ee138615fded8df0ab1d03"`);
        await queryRunner.query(`DROP TABLE "webhook_deliveries"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ee0122621cdc85e8717adf7554"`);
        await queryRunner.query(`DROP TABLE "webhook_subscriptions"`);
    }

}
