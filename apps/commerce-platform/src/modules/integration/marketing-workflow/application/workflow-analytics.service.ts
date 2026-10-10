import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ActionLogRow, EnrollmentRow, WorkflowAnalytics, WorkflowStep } from '../domain/workflow.types';

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

/** Results for one commerce workflow; test runs never count. */
@Injectable()
export class WorkflowAnalyticsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async analytics(workflowId: string, steps: WorkflowStep[]): Promise<WorkflowAnalytics> {
    const [c] = await this.db.query(`SELECT count(*)::int AS enrolled,
        count(*) FILTER (WHERE status IN ('running', 'pending'))::int AS running, count(*) FILTER (WHERE status = 'completed' AND NOT is_holdout)::int AS completed,
        count(*) FILTER (WHERE status = 'skipped')::int AS skipped, count(*) FILTER (WHERE status = 'failed')::int AS failed,
        count(converted_at)::int AS converted, count(*) FILTER (WHERE is_holdout)::int AS holdout,
        count(*) FILTER (WHERE NOT is_holdout)::int AS treated, count(converted_at) FILTER (WHERE is_holdout)::int AS holdout_converted,
        count(converted_at) FILTER (WHERE NOT is_holdout)::int AS treated_converted,
        count(*) FILTER (WHERE device_id IS NOT NULL)::int AS guests, count(*) FILTER (WHERE device_id IS NOT NULL AND user_id IS NOT NULL)::int AS merged
      FROM marketing_workflow_enrollments WHERE workflow_id = $1 AND NOT is_test`, [workflowId]);
    const actions = await this.db.query(`SELECT l.kind, l.status, count(*)::int AS count FROM marketing_workflow_action_logs l
      JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id WHERE e.workflow_id = $1 AND NOT e.is_test AND l.kind NOT IN ('split', 'condition')
      GROUP BY 1, 2 ORDER BY 1, 2`, [workflowId]);
    const split: Record<string, unknown>[] = await this.db.query(`SELECT l.step_id, l.meta->>'branchId' AS branch_id, count(DISTINCT e.id)::int AS entered,
        count(DISTINCT e.id) FILTER (WHERE e.converted_at IS NOT NULL)::int AS converted
      FROM marketing_workflow_action_logs l JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id
      WHERE e.workflow_id = $1 AND NOT e.is_test AND l.kind = 'split' GROUP BY 1, 2`, [workflowId]);
    const splits = steps.filter((s): s is Extract<WorkflowStep, { type: 'split' }> => s.type === 'split').map((s) => ({
      stepId: s.id,
      branches: s.branches.map((b) => {
        const hit = split.find((r) => r.step_id === s.id && r.branch_id === b.id);
        return { branchId: b.id, label: b.label, entered: (hit?.entered as number) ?? 0, converted: (hit?.converted as number) ?? 0 };
      }),
    }));
    return {
      counts: { enrolled: c.enrolled, running: c.running, completed: c.completed, skipped: c.skipped, failed: c.failed, converted: c.converted, holdout: c.holdout, enrolledGuests: c.guests, mergedToUser: c.merged },
      actions, splits,
      holdout: { enrolled: c.holdout, converted: c.holdout_converted }, treated: { enrolled: c.treated, converted: c.treated_converted },
    };
  }

  async enrollments(workflowId: string, page: number): Promise<{ rows: EnrollmentRow[]; total: number }> {
    const rows = await this.db.query(`SELECT *, count(*) OVER ()::int AS total FROM marketing_workflow_enrollments WHERE workflow_id = $1
      ORDER BY started_at DESC LIMIT 50 OFFSET $2`, [workflowId, (page - 1) * 50]);
    return {
      total: rows[0]?.total ?? 0,
      rows: rows.map((r: Record<string, unknown>) => ({ id: r.id, userId: r.user_id ?? null, deviceId: r.device_id ?? null, status: r.status, occurrenceKey: r.occurrence_key,
        currentStepId: r.current_step_id, resumeAt: iso(r.resume_at), isHoldout: r.is_holdout, isTest: r.is_test, startedAt: iso(r.started_at),
        completedAt: iso(r.completed_at), endReason: r.end_reason, convertedAt: iso(r.converted_at) }) as EnrollmentRow),
    };
  }

  async logs(workflowId: string, enrollmentId: string): Promise<ActionLogRow[]> {
    const rows = await this.db.query(`SELECT l.* FROM marketing_workflow_action_logs l JOIN marketing_workflow_enrollments e ON e.id = l.enrollment_id
      WHERE e.workflow_id = $1 AND e.id = $2 ORDER BY l.created_at`, [workflowId, enrollmentId]);
    return rows.map((r: Record<string, unknown>) => ({ id: r.id, stepId: r.step_id, kind: r.kind, status: r.status, meta: r.meta, createdAt: iso(r.created_at) }) as ActionLogRow);
  }
}
