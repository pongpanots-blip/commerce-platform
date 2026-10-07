import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JoshReplica } from './josh-replica';

type Source = 'replica' | 'copies';
/**
 * MARKETING_WORKFLOWS_SOURCE: replica (default) · copies (stage 5, S5-12): `josh_marketing_workflows`, one row per
 * workflow from josh's marketing_workflow.snapshot (counts, no enrollments); works without the replica. The list's
 * "last N days" sums Bangkok-day buckets, so it can count up to one more partial day than the replica's rolling window.
 */
export const marketingWorkflowsSource = (): Source =>
  (process.env.MARKETING_WORKFLOWS_SOURCE?.trim().toLowerCase() === 'copies' ? 'copies' : 'replica');
const sumDays = (field: string) => `COALESCE(sum((d->>'${field}')::int), 0)::int`;

/**
 * josh marketing workflows (automation: trigger → steps → message), read from josh's replica with
 * how each one is doing. Changes go through josh's MarketingWorkflowService (JoshActions target
 * `marketing-workflows`); enrolling and sending stay in josh's cron.
 */
@Injectable()
export class JoshMarketingWorkflows {
  constructor(private readonly replica: JoshReplica, private readonly db: DataSource) {}

  get available() { return marketingWorkflowsSource() === 'copies' || this.replica.configured; }

  /** `source` overrides the switch (growth's own GROWTH_SOURCE decides for its pages). */
  list(days = 30, source: Source = marketingWorkflowsSource()) {
    if (source === 'copies') return this.listFromCopies(days);
    return this.replica.query(`SELECT w.id, w.name, w.status, w.trigger_type, w.schedule, w.cooldown_days, w.holdout_percent, w.conversion_window_days, w.updated_at,
        e.enrolled, e.running, e.failed, e.converted, e.holdout, r.last_run_at, r.failed_runs
      FROM marketing_workflows w
      LEFT JOIN LATERAL (SELECT count(*)::int AS enrolled, count(*) FILTER (WHERE status::text IN ('pending', 'running'))::int AS running,
          count(*) FILTER (WHERE status::text = 'failed')::int AS failed,
          count(*) FILTER (WHERE converted_at IS NOT NULL)::int AS converted, count(*) FILTER (WHERE is_holdout)::int AS holdout
        FROM marketing_workflow_enrollments WHERE workflow_id = w.id AND started_at >= now() - make_interval(days => $1)) e ON true
      LEFT JOIN LATERAL (SELECT max(fired_at) AS last_run_at, count(*) FILTER (WHERE status::text = 'failed')::int AS failed_runs
        FROM marketing_workflow_scheduled_runs WHERE workflow_id = w.id AND fired_at >= now() - make_interval(days => $1)) r ON true
      ORDER BY (w.status = 'active') DESC, w.updated_at DESC`, [days]);
  }

  async detail(id: string, source: Source = marketingWorkflowsSource()) {
    if (source === 'copies') return this.detailFromCopies(id);
    const [w] = await this.replica.query<Record<string, unknown>>(`SELECT * FROM marketing_workflows WHERE id = $1`, [id]);
    if (!w) throw new NotFoundException(`marketing workflow ${id} not found in josh`);
    const [byStatus, runs, failures] = await Promise.all([
      this.replica.query(`SELECT status::text AS status, count(*)::int AS n FROM marketing_workflow_enrollments WHERE workflow_id = $1 GROUP BY 1 ORDER BY 2 DESC`, [id]),
      this.replica.query(`SELECT fired_at, source, status::text AS status, skip_reason, audience_count, enrolled_count, error_message FROM marketing_workflow_scheduled_runs
        WHERE workflow_id = $1 ORDER BY fired_at DESC LIMIT 20`, [id]),
      this.replica.query(`SELECT l.created_at, l.step_id, l.action_kind, l.status::text AS status, l.detail FROM marketing_workflow_action_logs l
        JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id WHERE e.workflow_id = $1 AND l.status::text = 'failed' ORDER BY l.created_at DESC LIMIT 20`, [id]),
    ]);
    return { ...w, enrollmentsByStatus: byStatus, recentRuns: runs, recentFailures: failures };
  }

  private listFromCopies(days: number) {
    const since = `(now() AT TIME ZONE 'Asia/Bangkok')::date - $1::int`;
    return this.db.query(`SELECT w.id, w.name, w.status, w.trigger_type, w.workflow->'schedule' AS schedule, (w.workflow->>'cooldown_days')::int AS cooldown_days,
        (w.workflow->>'holdout_percent')::int AS holdout_percent, (w.workflow->>'conversion_window_days')::int AS conversion_window_days, w.updated_at,
        e.enrolled, e.running, e.failed, e.converted, e.holdout, r.last_run_at, r.failed_runs
      FROM josh_marketing_workflows w
      LEFT JOIN LATERAL (SELECT ${sumDays('enrolled')} AS enrolled, ${sumDays('running')} AS running, ${sumDays('failed')} AS failed,
          ${sumDays('converted')} AS converted, ${sumDays('holdout')} AS holdout
        FROM jsonb_array_elements(w.enrollments_by_day) d WHERE (d->>'day')::date >= ${since}) e ON true
      LEFT JOIN LATERAL (SELECT max((d->>'last_run_at')::timestamptz) AS last_run_at, ${sumDays('failed_runs')} AS failed_runs
        FROM jsonb_array_elements(w.runs_by_day) d WHERE (d->>'day')::date >= ${since}) r ON true
      ORDER BY (w.status = 'active') DESC, w.updated_at DESC`, [days]);
  }

  private async detailFromCopies(id: string) {
    const [row] = await this.db.query(`SELECT workflow, enrollments_by_status, recent_runs, recent_failures FROM josh_marketing_workflows WHERE id = $1`, [id]);
    if (!row) throw new NotFoundException(`marketing workflow ${id} not found in commerce's copy of josh`);
    return { ...row.workflow, enrollmentsByStatus: row.enrollments_by_status, recentRuns: row.recent_runs, recentFailures: row.recent_failures };
  }
}
