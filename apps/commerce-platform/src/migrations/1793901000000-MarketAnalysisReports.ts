import { MigrationInterface, QueryRunner } from 'typeorm';
export class MarketAnalysisReports1793901000000 implements MigrationInterface {
  name = 'MarketAnalysisReports1793901000000';
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE "market_analysis_reports" (
      "id" uuid PRIMARY KEY, "createdBy" uuid NOT NULL, "requestHash" varchar(64) NOT NULL,
      "report" jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await q.query('CREATE INDEX "ix_market_analysis_owner_created" ON "market_analysis_reports" ("createdBy", "createdAt" DESC)');
  }
  async down(q: QueryRunner) { await q.query('DROP TABLE "market_analysis_reports"'); }
}
