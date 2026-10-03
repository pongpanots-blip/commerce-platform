import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMarketingResearch1791030000000 implements MigrationInterface {
    name = 'CreateMarketingResearch1791030000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "marketing_research_topics" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(400) NOT NULL, "kind" character varying(20) NOT NULL, "area" character varying(100) NOT NULL, "days" integer NOT NULL DEFAULT '30', "sector" character varying(100) NOT NULL, "sources" jsonb NOT NULL, "followHourly" boolean NOT NULL DEFAULT false, "createdBy" uuid NOT NULL, "version" integer NOT NULL DEFAULT '1', "nextRunAt" TIMESTAMP WITH TIME ZONE, "archivedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cb46af6c43670e4b478c4c5f2cc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_research_topics_due" ON "marketing_research_topics" ("nextRunAt") WHERE "archivedAt" IS NULL AND "followHourly" = true`);
        await queryRunner.query(`CREATE TABLE "marketing_research_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "topicId" uuid NOT NULL, "requestKey" character varying(100) NOT NULL, "requestedBy" uuid, "topicVersion" integer NOT NULL, "scope" jsonb NOT NULL, "availableSources" jsonb NOT NULL, "status" character varying(30) NOT NULL, "message" text NOT NULL DEFAULT '', "attempts" integer NOT NULL DEFAULT '0', "leaseToken" uuid, "leaseExpiresAt" TIMESTAMP WITH TIME ZONE, "report" jsonb, "findingsCount" integer NOT NULL DEFAULT '0', "keptBy" uuid, "keptAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finishedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_0382400d5eba2e239e1ffe167c2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "ix_research_runs_claim" ON "marketing_research_runs" ("status", "leaseExpiresAt") `);
        await queryRunner.query(`CREATE INDEX "ix_research_runs_history" ON "marketing_research_runs" ("topicId", "createdAt") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_research_active_run" ON "marketing_research_runs" ("topicId") WHERE "status" IN ('queued', 'running')`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_research_run_key" ON "marketing_research_runs" ("topicId", "requestKey") `);
        await queryRunner.query(`ALTER TABLE "marketing_research_runs" ADD CONSTRAINT "FK_621f14d1a0373c2d79794d5b70c" FOREIGN KEY ("topicId") REFERENCES "marketing_research_topics"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "marketing_research_runs" DROP CONSTRAINT "FK_621f14d1a0373c2d79794d5b70c"`);
        await queryRunner.query(`DROP INDEX "public"."uq_research_run_key"`);
        await queryRunner.query(`DROP INDEX "public"."uq_research_active_run"`);
        await queryRunner.query(`DROP INDEX "public"."ix_research_runs_history"`);
        await queryRunner.query(`DROP INDEX "public"."ix_research_runs_claim"`);
        await queryRunner.query(`DROP TABLE "marketing_research_runs"`);
        await queryRunner.query(`DROP INDEX "public"."ix_research_topics_due"`);
        await queryRunner.query(`DROP TABLE "marketing_research_topics"`);
    }

}
