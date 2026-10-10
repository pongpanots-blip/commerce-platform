import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { JOSH_ACTIVE_ORDER_STATUSES } from '../../customers/customer-metrics.service';
import type { OrderMilestoneTriggerConfig, TriggerType, WebhookHeader } from '../domain/workflow.types';
import { MarketingWorkflowRow } from './marketing-workflow.entity';

export interface EnrollmentRecord {
  id: string; workflowId: string; userId: string; occurrenceKey: string; status: string; currentStepId: string | null;
  resumeAt: Date | null; isHoldout: boolean; isTest: boolean; skipWaits: boolean; splitAssignments: Record<string, string>; startedAt: Date;
}
type Row = Record<string, unknown>;
const toEnrollment = (r: Row): EnrollmentRecord => ({
  id: r.id as string, workflowId: r.workflow_id as string, userId: r.user_id as string, occurrenceKey: r.occurrence_key as string,
  status: r.status as string, currentStepId: (r.current_step_id as string | null) ?? null, resumeAt: (r.resume_at as Date | null) ?? null,
  isHoldout: !!r.is_holdout, isTest: !!r.is_test, skipWaits: !!r.skip_waits,
  splitAssignments: (r.split_assignments as Record<string, string>) ?? {}, startedAt: new Date(r.started_at as string),
});
const COUNTED = [...JOSH_ACTIVE_ORDER_STATUSES];

/** Every SQL the marketing workflow engine and triggers run (so the logic above it is unit-tested with a fake). */
@Injectable()
export class WorkflowStore {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async insertEnrollment(i: { workflowId: string; userId: string; occurrenceKey: string; entryStepId: string | null; holdout: boolean; test: boolean; skipWaits: boolean }): Promise<string | null> {
    const rows = await this.db.query(
      `INSERT INTO marketing_workflow_enrollments (workflow_id, user_id, occurrence_key, status, current_step_id, is_holdout, is_test, skip_waits, completed_at, end_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN 'holdout' END)
       ON CONFLICT (workflow_id, user_id, occurrence_key) DO NOTHING RETURNING id`,
      [i.workflowId, i.userId, i.occurrenceKey, i.holdout ? 'completed' : 'pending', i.holdout ? null : i.entryStepId, i.holdout, i.test, i.skipWaits]);
    return rows[0]?.id ?? null;
  }

  async lockDue(m: EntityManager, id: string): Promise<EnrollmentRecord | null> {
    const [r] = await m.query(`SELECT * FROM marketing_workflow_enrollments WHERE id = $1 AND status IN ('pending', 'running')
      AND (resume_at IS NULL OR resume_at <= now()) FOR UPDATE SKIP LOCKED`, [id]);
    return r ? toEnrollment(r) : null;
  }

  workflow(m: EntityManager, id: string): Promise<MarketingWorkflowRow | null> { return m.getRepository(MarketingWorkflowRow).findOneBy({ id }); }

  async park(m: EntityManager, id: string, stepId: string, resumeAt: Date) {
    await m.query(`UPDATE marketing_workflow_enrollments SET status = 'running', current_step_id = $2, resume_at = $3 WHERE id = $1`, [id, stepId, resumeAt]);
  }
  async finish(m: EntityManager, id: string, status: 'completed' | 'skipped' | 'failed', reason: string | null) {
    await m.query(`UPDATE marketing_workflow_enrollments SET status = $2, end_reason = $3, completed_at = now(), current_step_id = NULL, resume_at = NULL
      WHERE id = $1`, [id, status, reason]);
  }
  async saveSplit(m: EntityManager, id: string, assignments: Record<string, string>) {
    await m.query(`UPDATE marketing_workflow_enrollments SET split_assignments = $2::jsonb WHERE id = $1`, [id, JSON.stringify(assignments)]);
  }
  async log(m: EntityManager, enrollmentId: string, stepId: string, kind: string, status: 'sent' | 'queued' | 'skipped' | 'failed', meta: Record<string, unknown>) {
    await m.query(`INSERT INTO marketing_workflow_action_logs (enrollment_id, step_id, kind, status, meta) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [enrollmentId, stepId, kind, status, JSON.stringify(meta)]);
  }
  async hasCountedOrderSince(m: EntityManager, userId: string, since: Date): Promise<boolean> {
    const [r] = await m.query(`SELECT EXISTS (SELECT 1 FROM josh_orders WHERE user_id = $1 AND status = ANY($2::text[]) AND create_date >= $3) AS hit`,
      [userId, COUNTED, since]);
    return !!r?.hit;
  }
  async countedOrderCount(m: EntityManager, userId: string): Promise<number> {
    const [r] = await m.query(`SELECT count(*)::int AS n FROM josh_orders WHERE user_id = $1 AND status = ANY($2::text[])`, [userId, COUNTED]);
    return r?.n ?? 0;
  }
  /** Commerce-queued notifies for this customer today (Bangkok day), test runs excluded. */
  async notifiesQueuedToday(m: EntityManager, userId: string): Promise<number> {
    const [r] = await m.query(`SELECT count(*)::int AS n FROM marketing_workflow_action_logs l JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id
      WHERE e.user_id = $1 AND NOT e.is_test AND l.kind = 'notify' AND l.status = 'queued'
        AND l.created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')`, [userId]);
    return r?.n ?? 0;
  }
  /** One delivery per enrollment + step (idempotency_key); a re-run returns the existing row's id. */
  async insertWebhookDelivery(m: EntityManager, d: { idempotencyKey: string; url: string; method: string; headers: WebhookHeader[]; body: string | null }): Promise<string> {
    const [r] = await m.query(`INSERT INTO webhook_deliveries (id, subscription_id, event_type, event_id, target_url, payload, status, attempts, kind, method, headers, idempotency_key, created_at, updated_at)
      VALUES ($1, NULL, 'marketing.webhook', NULL, $2, $3::jsonb, 'pending', 0, 'marketing', $4, $5::jsonb, $6, now(), now())
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key RETURNING id`,
      [randomUUID(), d.url, JSON.stringify(d.body), d.method, JSON.stringify(d.headers), d.idempotencyKey]);
    return r.id;
  }
  async customerData(m: EntityManager, userId: string): Promise<Record<string, unknown> | null> {
    const [r] = await m.query(`SELECT data FROM josh_customers WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    return (r?.data as Record<string, unknown>) ?? null;
  }
  async inCooldown(workflowId: string, userId: string, days: number): Promise<boolean> {
    const [r] = await this.db.query(`SELECT EXISTS (SELECT 1 FROM marketing_workflow_enrollments WHERE workflow_id = $1 AND user_id = $2 AND NOT is_test
      AND started_at > now() - make_interval(days => $3)) AS hit`, [workflowId, userId, days]);
    return !!r?.hit;
  }
  /** Waits that are due, plus pending enrollments whose first job was lost (> 2 min old). */
  async dueEnrollmentIds(limit: number): Promise<string[]> {
    const rows = await this.db.query(`(SELECT id FROM marketing_workflow_enrollments WHERE status = 'running' AND resume_at <= now() ORDER BY resume_at LIMIT $1)
      UNION ALL (SELECT id FROM marketing_workflow_enrollments WHERE status = 'pending' AND started_at < now() - interval '2 minutes' ORDER BY started_at LIMIT $1)`, [limit]);
    return rows.map((r: { id: string }) => r.id);
  }
  async stalePendingWebhookIds(limit: number): Promise<string[]> {
    const rows = await this.db.query(`SELECT id FROM webhook_deliveries WHERE kind = 'marketing' AND status = 'pending' AND updated_at < now() - interval '10 minutes'
      ORDER BY updated_at LIMIT $1`, [limit]);
    return rows.map((r: { id: string }) => r.id);
  }

  activeWorkflows(types: TriggerType[]): Promise<MarketingWorkflowRow[]> {
    return this.db.getRepository(MarketingWorkflowRow).createQueryBuilder('w')
      .where(`w.status = 'active'`).andWhere('w.trigger_type IN (:...types)', { types }).getMany();
  }
  async customerTime(userId: string, field: 'first_app_login_at' | 'last_app_login_at'): Promise<Date | null> {
    const column = field === 'first_app_login_at' ? 'first_app_login_at' : 'last_app_login_at';
    const [r] = await this.db.query(`SELECT (data->>'${column}')::timestamptz AS at FROM josh_customers WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    return r?.at ? new Date(r.at) : null;
  }
  /** True when the metric meets the target now and (lifetime metrics) did not before activation; single order: one counted order since activation. */
  async milestoneCrossed(userId: string, cfg: OrderMilestoneTriggerConfig, since: Date): Promise<boolean> {
    const op = cfg.operator === '>' ? '>' : '>=';
    const base = `FROM josh_orders WHERE user_id = $1 AND status = ANY($2::text[])`;
    let sql: string;
    if (cfg.metric === 'single_order_total') {
      sql = `SELECT EXISTS (SELECT 1 ${base} AND create_date >= $3 AND total_price ${op} $4) AS hit`;
    } else {
      const agg = cfg.metric === 'lifetime_spend' ? 'COALESCE(sum(total_price), 0)' : 'count(*)';
      sql = `SELECT ((SELECT ${agg} ${base}) ${op} $4) AND NOT ((SELECT ${agg} ${base} AND create_date < $3) ${op} $4) AS hit`;
    }
    const [r] = await this.db.query(sql, [userId, COUNTED, since, cfg.value]);
    return !!r?.hit;
  }
  /** Converted = a counted order after the enrollment started, inside the workflow's window. */
  async markConverted(userId: string): Promise<void> {
    // Correlated subqueries, not a LATERAL join: UPDATE … FROM may not reference the target table laterally.
    await this.db.query(`UPDATE marketing_workflow_enrollments e SET converted_at = (SELECT min(o.create_date) FROM josh_orders o
        WHERE o.user_id = e.user_id AND o.status = ANY($2::text[]) AND o.create_date >= e.started_at)
      FROM marketing_workflows w
      WHERE e.workflow_id = w.id AND e.user_id = $1 AND e.converted_at IS NULL
        AND EXISTS (SELECT 1 FROM josh_orders o WHERE o.user_id = e.user_id AND o.status = ANY($2::text[]) AND o.create_date >= e.started_at
          AND o.create_date <= e.started_at + make_interval(days => w.conversion_window_days))`, [userId, COUNTED]);
  }
  /** PDPA delete: stop the customer's journeys and their unsent webhooks. */
  async customerDeleted(userId: string): Promise<void> {
    await this.db.query(`UPDATE webhook_deliveries SET status = 'failed', error = 'customer_deleted' WHERE kind = 'marketing' AND status = 'pending'
      AND id IN (SELECT (l.meta->>'deliveryId')::uuid FROM marketing_workflow_action_logs l JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id
        WHERE e.user_id = $1 AND l.kind = 'webhook' AND l.meta ? 'deliveryId')`, [userId]);
    await this.db.query(`UPDATE marketing_workflow_enrollments SET status = 'skipped', end_reason = 'customer_deleted', completed_at = now(),
      current_step_id = NULL, resume_at = NULL WHERE user_id = $1 AND status IN ('pending', 'running')`, [userId]);
  }
  /** Keyset page over the customers commerce knows (PDPA-deleted excluded). */
  async customerIdsAfter(afterId: string | null, limit: number): Promise<string[]> {
    const rows = await this.db.query(`SELECT id FROM segment_customers WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`, [afterId, limit]);
    return rows.map((r: { id: string }) => r.id);
  }
  async setLastScheduledKey(workflowId: string, key: string): Promise<void> {
    await this.db.query(`UPDATE marketing_workflows SET last_scheduled_key = $2 WHERE id = $1`, [workflowId, key]);
  }
}
