import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { JOSH_ACTIVE_ORDER_STATUSES } from '../../customers/customer-metrics.service';
import type { OrderMilestoneTriggerConfig, TriggerEvent, TriggerType, WaitingFor, WebhookHeader, ExitGoal } from '../domain/workflow.types';
import { MarketingWorkflowRow } from './marketing-workflow.entity';

type Row = Record<string, unknown>;
export type Who = { userId: string | null; deviceId: string | null };
export interface EnrollmentRecord {
  id: string; workflowId: string; userId: string | null; deviceId: string | null; occurrenceKey: string; status: string; currentStepId: string | null;
  resumeAt: Date | null; isHoldout: boolean; isTest: boolean; skipWaits: boolean; splitAssignments: Record<string, string>; startedAt: Date;
  waitingFor: WaitingFor | null; triggerEvent: TriggerEvent | null;
}
const toEnrollment = (r: Row): EnrollmentRecord => ({
  id: r.id as string, workflowId: r.workflow_id as string, userId: (r.user_id as string | null) ?? null, deviceId: (r.device_id as string | null) ?? null,
  occurrenceKey: r.occurrence_key as string, status: r.status as string, currentStepId: (r.current_step_id as string | null) ?? null,
  resumeAt: (r.resume_at as Date | null) ?? null, isHoldout: !!r.is_holdout, isTest: !!r.is_test, skipWaits: !!r.skip_waits,
  splitAssignments: (r.split_assignments as Record<string, string>) ?? {}, startedAt: new Date(r.started_at as string),
  waitingFor: (r.waiting_for as WaitingFor | null) ?? null, triggerEvent: (r.trigger_event as TriggerEvent | null) ?? null,
});
/** `$1` = user id, `$2` = device id; a guest (no user) is matched by its device. */
const WHO_SQL = `(($1::uuid IS NOT NULL AND user_id = $1) OR ($1::uuid IS NULL AND user_id IS NULL AND device_id = $2))`;
const COUNTED = [...JOSH_ACTIVE_ORDER_STATUSES];

/** Every SQL the marketing workflow engine and triggers run (so the logic above it is unit-tested with a fake). */
@Injectable()
export class WorkflowStore {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async insertEnrollment(i: { workflowId: string; userId: string | null; deviceId?: string | null; occurrenceKey: string; entryStepId: string | null;
    holdout: boolean; test: boolean; skipWaits: boolean; triggerEvent?: TriggerEvent | null }): Promise<string | null> {
    const conflict = i.userId ? '(workflow_id, user_id, occurrence_key)' : '(workflow_id, device_id, occurrence_key) WHERE user_id IS NULL';
    const rows = await this.db.query(
      `INSERT INTO marketing_workflow_enrollments (workflow_id, user_id, device_id, occurrence_key, status, current_step_id, is_holdout, is_test, skip_waits,
         completed_at, end_reason, trigger_event)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN 'holdout' END, $10::jsonb)
       ON CONFLICT ${conflict} DO NOTHING RETURNING id`,
      [i.workflowId, i.userId, i.userId ? null : i.deviceId ?? null, i.occurrenceKey, i.holdout ? 'completed' : 'pending', i.holdout ? null : i.entryStepId,
        i.holdout, i.test, i.skipWaits, i.triggerEvent ? JSON.stringify(i.triggerEvent) : null]);
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
  async inCooldown(workflowId: string, who: Who, days: number): Promise<boolean> {
    const [r] = await this.db.query(`SELECT EXISTS (SELECT 1 FROM marketing_workflow_enrollments WHERE workflow_id = $3 AND ${WHO_SQL} AND NOT is_test
      AND started_at > now() - make_interval(days => $4)) AS hit`, [who.userId, who.deviceId, workflowId, days]);
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

  async parkForEvent(m: EntityManager, id: string, stepId: string, waitingFor: WaitingFor, resumeAt: Date) {
    await m.query(`UPDATE marketing_workflow_enrollments SET status = 'running', current_step_id = $2, waiting_for = $3::jsonb, resume_at = $4 WHERE id = $1`,
      [id, stepId, JSON.stringify(waitingFor), resumeAt]);
  }
  async clearWait(m: EntityManager, id: string) {
    await m.query(`UPDATE marketing_workflow_enrollments SET waiting_for = NULL WHERE id = $1`, [id]);
  }
  /** Waits for a row lock (not SKIP LOCKED): an event that races the timeout queues behind it and then finds nothing to do. */
  async lockWaiting(m: EntityManager, id: string, stepId: string): Promise<EnrollmentRecord | null> {
    const [r] = await m.query(`SELECT * FROM marketing_workflow_enrollments WHERE id = $1 AND status = 'running' AND current_step_id = $2
      AND waiting_for->>'stepId' = $2 FOR UPDATE`, [id, stepId]);
    return r ? toEnrollment(r) : null;
  }
  async moveAfterEvent(m: EntityManager, id: string, nextId: string | null) {
    await m.query(`UPDATE marketing_workflow_enrollments SET current_step_id = $2, waiting_for = NULL, resume_at = NULL WHERE id = $1`, [id, nextId]);
  }
  async waitingFor(who: Who, eventName: string, occurredAt: Date): Promise<{ id: string; waitingFor: WaitingFor; triggerEvent: TriggerEvent | null }[]> {
    const rows = await this.db.query(`SELECT id, waiting_for, trigger_event FROM marketing_workflow_enrollments WHERE status = 'running'
      AND waiting_for->>'eventName' = $3 AND ${WHO_SQL} AND (waiting_for->>'since')::timestamptz <= $4`, [who.userId, who.deviceId, eventName, occurredAt]);
    return rows.map((r: Row) => ({ id: r.id as string, waitingFor: r.waiting_for as WaitingFor, triggerEvent: (r.trigger_event as TriggerEvent | null) ?? null }));
  }
  async eventsSince(m: EntityManager, who: Who, eventName: string, since: Date): Promise<{ attributes: Record<string, unknown> }[]> {
    const col = who.userId ? 'attributed_user_id = $1::uuid' : 'device_id = $1 AND attributed_user_id IS NULL';
    return m.query(`SELECT attributes FROM marketing_events WHERE ${col} AND name = $2 AND occurred_at >= $3 ORDER BY occurred_at LIMIT 200`,
      [who.userId ?? who.deviceId, eventName, since]);
  }
  async devicePush(m: EntityManager, deviceId: string): Promise<{ pushSubscriptionId: string | null; platform: string } | null> {
    const [r] = await m.query(`SELECT push_subscription_id, platform FROM marketing_devices WHERE device_id = $1`, [deviceId]);
    return r ? { pushSubscriptionId: r.push_subscription_id ?? null, platform: r.platform } : null;
  }
  async guestPushesLast24h(m: EntityManager, deviceId: string): Promise<number> {
    const [r] = await m.query(`SELECT count(*)::int AS n FROM marketing_guest_push_log WHERE device_id = $1 AND sent_at > now() - interval '24 hours'`, [deviceId]);
    return r?.n ?? 0;
  }
  async logGuestPush(m: EntityManager, deviceId: string) {
    await m.query(`INSERT INTO marketing_guest_push_log (device_id) VALUES ($1)`, [deviceId]);
  }
  /** Open conversions on an event goal (spec §9): started before the event, still inside the workflow's window. */
  async eventGoalCandidates(who: Who, eventName: string, occurredAt: Date): Promise<{ id: string; goal: Extract<ExitGoal, { kind: 'event' }>; triggerEvent: TriggerEvent | null }[]> {
    const rows = await this.db.query(`SELECT e.id, w.exit_on_goal, e.trigger_event FROM marketing_workflow_enrollments e JOIN marketing_workflows w ON w.id = e.workflow_id
      WHERE e.converted_at IS NULL AND NOT e.is_test AND w.exit_on_goal->>'kind' = 'event' AND w.exit_on_goal->>'eventName' = $3
        AND ${WHO_SQL.replace(/user_id/g, 'e.user_id').replace(/device_id/g, 'e.device_id')}
        AND e.started_at <= $4 AND $4 <= e.started_at + make_interval(days => w.conversion_window_days)`, [who.userId, who.deviceId, eventName, occurredAt]);
    return rows.map((r: Row) => ({ id: r.id as string, goal: r.exit_on_goal as Extract<ExitGoal, { kind: 'event' }>, triggerEvent: (r.trigger_event as TriggerEvent | null) ?? null }));
  }
  async markConvertedAt(id: string, at: Date) {
    await this.db.query(`UPDATE marketing_workflow_enrollments SET converted_at = $2 WHERE id = $1 AND converted_at IS NULL`, [id, at]);
  }

  /** Events to act on (spec §7). Bounded to the last 8 days so partition pruning applies (ingest refuses older events). */
  async eventsByIds(ids: string[]): Promise<{ eventId: string; deviceId: string; name: string; attributes: Record<string, unknown>; occurredAt: string;
    attributedUserId: string | null; attribution: string | null; actorKind: string | null }[]> {
    if (!ids.length) return [];
    const rows = await this.db.query(`SELECT event_id, device_id, name, attributes, occurred_at, attributed_user_id, attribution, actor_kind FROM marketing_events
      WHERE event_id = ANY($1::uuid[]) AND occurred_at >= now() - interval '8 days' ORDER BY occurred_at`, [ids]);
    return rows.map((r: Row) => ({ eventId: r.event_id as string, deviceId: r.device_id as string, name: r.name as string,
      attributes: (r.attributes as Record<string, unknown>) ?? {}, occurredAt: new Date(r.occurred_at as string).toISOString(),
      attributedUserId: (r.attributed_user_id as string | null) ?? null, attribution: (r.attribution as string | null) ?? null, actorKind: (r.actor_kind as string | null) ?? null }));
  }

  get manager(): EntityManager { return this.db.manager; }

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
  /** Keyset page over the customers commerce knows (PDPA-deleted excluded). */
  async customerIdsAfter(afterId: string | null, limit: number): Promise<string[]> {
    const rows = await this.db.query(`SELECT id FROM segment_customers WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2`, [afterId, limit]);
    return rows.map((r: { id: string }) => r.id);
  }
  async setLastScheduledKey(workflowId: string, key: string): Promise<void> {
    await this.db.query(`UPDATE marketing_workflows SET last_scheduled_key = $2 WHERE id = $1`, [workflowId, key]);
  }
}

/**
 * PDPA delete (spec §8), run inside josh-events' `customer.deleted` transaction so it can't be lost: stop the
 * customer's journeys first (waits for an in-flight run's row lock, so its new delivery is visible next), then fail
 * the unsent webhook rows and blank every marketing webhook row's rendered URL / headers / body.
 */
export async function stopMarketingForCustomer(m: EntityManager, userId: string): Promise<void> {
  await stopEnrollmentsForCustomer(m, userId, 'customer_deleted');
  await m.query(`UPDATE webhook_deliveries SET status = CASE WHEN status = 'pending' THEN 'failed' ELSE status END,
      error = CASE WHEN status = 'pending' THEN 'customer_deleted' ELSE error END, payload = 'null'::jsonb, headers = NULL, target_url = ''
    WHERE kind = 'marketing' AND id IN (SELECT (l.meta->>'deliveryId')::uuid FROM marketing_workflow_action_logs l
      JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id WHERE e.user_id = $1 AND l.kind = 'webhook' AND l.meta ? 'deliveryId')`, [userId]);
}

/** Ends the customer's open journeys (PDPA delete, consent withdrawn). */
export async function stopEnrollmentsForCustomer(m: EntityManager, userId: string, reason: string): Promise<void> {
  await m.query(`UPDATE marketing_workflow_enrollments SET status = 'skipped', end_reason = $2, completed_at = now(),
    current_step_id = NULL, resume_at = NULL, waiting_for = NULL WHERE user_id = $1 AND status IN ('pending', 'running')`, [userId, reason]);
}

/**
 * A guest logged in (spec §5 step 4, §10): their open guest journeys become the customer's. One the customer already
 * has for the same workflow + occurrence ends as `merged` instead.
 */
export async function adoptGuestEnrollments(m: EntityManager, deviceId: string, userId: string): Promise<void> {
  await m.query(`UPDATE marketing_workflow_enrollments g SET user_id = $2 WHERE g.device_id = $1 AND g.user_id IS NULL AND g.status IN ('pending', 'running')
    AND NOT EXISTS (SELECT 1 FROM marketing_workflow_enrollments x WHERE x.workflow_id = g.workflow_id AND x.user_id = $2 AND x.occurrence_key = g.occurrence_key)`,
    [deviceId, userId]);
  await m.query(`UPDATE marketing_workflow_enrollments SET status = 'skipped', end_reason = 'merged', completed_at = now(), current_step_id = NULL,
    resume_at = NULL, waiting_for = NULL WHERE device_id = $1 AND user_id IS NULL AND status IN ('pending', 'running')`, [deviceId]);
}
