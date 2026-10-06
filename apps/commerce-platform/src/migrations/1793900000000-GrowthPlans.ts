import { MigrationInterface, QueryRunner } from 'typeorm';

export class GrowthPlans1793900000000 implements MigrationInterface {
  name = 'GrowthPlans1793900000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "growth_plans" (
      "id" uuid PRIMARY KEY, "createdBy" uuid NOT NULL, "requestHash" varchar(64) NOT NULL,
      "plan" jsonb NOT NULL, "evidence" jsonb NOT NULL DEFAULT '[]', "tasks" jsonb NOT NULL DEFAULT '[]',
      "history" jsonb NOT NULL DEFAULT '[]', "version" int NOT NULL DEFAULT 1 CHECK ("version" > 0),
      "status" varchar(24) NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft','review','approved','exporting','ready','export_unknown')),
      "approvedBy" uuid, "approvedVersion" int, "workflowId" uuid,
      "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query('CREATE INDEX "ix_growth_plans_updated" ON "growth_plans" ("updatedAt")');
    await q.query('CREATE UNIQUE INDEX "uq_growth_workflow" ON "growth_plans" ("workflowId")');
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE "growth_plans"'); }
}
