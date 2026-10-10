import { MigrationInterface, QueryRunner } from 'typeorm';

/** Commerce-run marketing workflows, phase 1 (spec 2026-10-10 §3.1, §4.4). */
export class CommerceMarketingWorkflows1796300000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE marketing_workflows (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name varchar(200) NOT NULL, status varchar(16) NOT NULL DEFAULT 'draft',
      trigger_type varchar(32) NOT NULL, trigger_config jsonb NOT NULL DEFAULT '{}', entry_step_id varchar(64),
      steps jsonb NOT NULL DEFAULT '[]', graph_ui jsonb, cooldown_days int NOT NULL DEFAULT 0, holdout_percent int NOT NULL DEFAULT 0,
      conversion_window_days int NOT NULL DEFAULT 7, exit_on_goal jsonb, schedule jsonb, activated_at timestamptz,
      last_scheduled_key varchar(16), created_by varchar(128), updated_by varchar(128),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT marketing_workflows_status CHECK (status IN ('draft', 'active', 'paused')))`);
    await q.query(`CREATE INDEX marketing_workflows_active ON marketing_workflows (trigger_type) WHERE status = 'active'`);
    await q.query(`CREATE TABLE marketing_workflow_revisions (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), workflow_id uuid NOT NULL REFERENCES marketing_workflows(id) ON DELETE CASCADE,
      snapshot jsonb NOT NULL, created_by varchar(128), created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX marketing_workflow_revisions_wf ON marketing_workflow_revisions (workflow_id, created_at DESC)`);
    await q.query(`CREATE TABLE marketing_workflow_enrollments (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), workflow_id uuid NOT NULL REFERENCES marketing_workflows(id) ON DELETE CASCADE,
      user_id uuid NOT NULL, occurrence_key varchar(64) NOT NULL, status varchar(16) NOT NULL DEFAULT 'pending',
      current_step_id varchar(64), resume_at timestamptz, is_holdout boolean NOT NULL DEFAULT false, is_test boolean NOT NULL DEFAULT false,
      skip_waits boolean NOT NULL DEFAULT false, split_assignments jsonb NOT NULL DEFAULT '{}', started_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz, end_reason varchar(64), converted_at timestamptz,
      CONSTRAINT marketing_workflow_enrollments_once UNIQUE (workflow_id, user_id, occurrence_key),
      CONSTRAINT marketing_workflow_enrollments_status CHECK (status IN ('pending', 'running', 'completed', 'skipped', 'failed')))`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_due ON marketing_workflow_enrollments (resume_at) WHERE status = 'running'`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_pending ON marketing_workflow_enrollments (started_at) WHERE status = 'pending'`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_user ON marketing_workflow_enrollments (user_id, started_at DESC)`);
    await q.query(`CREATE INDEX marketing_workflow_enrollments_wf ON marketing_workflow_enrollments (workflow_id, started_at DESC)`);
    await q.query(`CREATE TABLE marketing_workflow_action_logs (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), enrollment_id uuid NOT NULL REFERENCES marketing_workflow_enrollments(id) ON DELETE CASCADE,
      step_id varchar(64) NOT NULL, kind varchar(16) NOT NULL, status varchar(16) NOT NULL, meta jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX marketing_workflow_action_logs_enrollment ON marketing_workflow_action_logs (enrollment_id, created_at)`);
    await q.query(`CREATE INDEX marketing_workflow_action_logs_kind ON marketing_workflow_action_logs (kind, created_at)`);
    await q.query(`CREATE TABLE marketing_webhook_secrets (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), name varchar(128) NOT NULL, value_encrypted text NOT NULL, created_by varchar(128),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`ALTER TABLE webhook_deliveries ALTER COLUMN subscription_id DROP NOT NULL,
      ADD COLUMN kind varchar(16) NOT NULL DEFAULT 'event', ADD COLUMN method varchar(8), ADD COLUMN headers jsonb,
      ADD COLUMN idempotency_key varchar(191)`);
    await q.query(`CREATE UNIQUE INDEX webhook_deliveries_idempotency ON webhook_deliveries (idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await q.query(`CREATE INDEX webhook_deliveries_marketing_pending ON webhook_deliveries (updated_at) WHERE kind = 'marketing' AND status = 'pending'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM webhook_deliveries WHERE kind = 'marketing'`);
    await q.query(`DROP INDEX webhook_deliveries_marketing_pending`);
    await q.query(`DROP INDEX webhook_deliveries_idempotency`);
    await q.query(`ALTER TABLE webhook_deliveries DROP COLUMN idempotency_key, DROP COLUMN headers, DROP COLUMN method, DROP COLUMN kind,
      ALTER COLUMN subscription_id SET NOT NULL`);
    await q.query(`DROP TABLE marketing_webhook_secrets`);
    await q.query(`DROP TABLE marketing_workflow_action_logs`);
    await q.query(`DROP TABLE marketing_workflow_enrollments`);
    await q.query(`DROP TABLE marketing_workflow_revisions`);
    await q.query(`DROP TABLE marketing_workflows`);
  }
}
