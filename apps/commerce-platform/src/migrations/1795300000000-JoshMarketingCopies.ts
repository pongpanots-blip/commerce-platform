import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 5 (plan 2026-10-08, S5-12): copies for the push-campaigns and marketing-workflows reports, fed by josh events.
 * - josh_push_campaigns: push_campaign.snapshot, columns as in josh's push_campaigns (reference copy, tombstones).
 * - josh_marketing_workflows: marketing_workflow.snapshot. A few real columns for the list's order / filter; the
 *   workflow row and its counts (by status, by Bangkok day, recent runs / failures, credited conversion order ids)
 *   as jsonb, as josh sent them. No enrollments and no user ids.
 */
export class JoshMarketingCopies1795300000000 implements MigrationInterface {
  name = 'JoshMarketingCopies1795300000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS josh_push_campaigns (id uuid PRIMARY KEY, name varchar(200), notification_type varchar(120),
      title varchar(300), body text, title_en varchar(300), body_en text, image_url varchar(1000), deep_link varchar(1000),
      deep_link_web varchar(1000), audience jsonb, ab_enabled boolean, ab_variant_b jsonb, status varchar(20), scheduled_at timestamptz,
      sent_at timestamptz, stats jsonb, created_by uuid, last_error text, created_at timestamptz, updated_at timestamptz,
      source_version bigint NOT NULL DEFAULT 0)`);
    await q.query(`CREATE INDEX IF NOT EXISTS ix_josh_push_campaigns_created ON josh_push_campaigns (created_at)`);
    await q.query(`CREATE TABLE IF NOT EXISTS josh_marketing_workflows (id uuid PRIMARY KEY, name varchar(200), status varchar(20),
      trigger_type varchar(40), updated_at timestamptz, workflow jsonb NOT NULL DEFAULT '{}', enrollments_by_status jsonb NOT NULL DEFAULT '[]',
      enrollments_by_day jsonb NOT NULL DEFAULT '[]', runs_by_day jsonb NOT NULL DEFAULT '[]', recent_runs jsonb NOT NULL DEFAULT '[]',
      recent_failures jsonb NOT NULL DEFAULT '[]', conversions jsonb NOT NULL DEFAULT '[]', copied_at timestamptz NOT NULL DEFAULT now(),
      source_version bigint NOT NULL DEFAULT 0)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS josh_marketing_workflows`);
    await q.query(`DROP TABLE IF EXISTS josh_push_campaigns`);
  }
}
