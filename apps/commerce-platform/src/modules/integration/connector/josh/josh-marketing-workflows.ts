import { Injectable, NotFoundException } from '@nestjs/common';
import { JoshReplica } from './josh-replica';

/**
 * josh marketing workflows (automation: trigger → steps → message), read from josh's replica with
 * how each one is doing. Changes go through josh's MarketingWorkflowService (JoshActions target
 * `marketing-workflows`); enrolling and sending stay in josh's cron.
 */
@Injectable()
export class JoshMarketingWorkflows {
  constructor(private readonly replica: JoshReplica) {}

  get available() { return this.replica.configured; }

  list(days = 30) {
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

  async detail(id: string) {
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
}
