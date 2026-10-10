import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { assertPublicHttpUrl } from '../../../../shared-kernel/infrastructure/public-url';
import { SegmentsService } from '../../segments/segments.service';
import { MARKETING_EXPRESSION_FIELD_TYPES } from '../domain/expression.parser';
import { FIELD_LABELS, SUPPORTED_FIELDS } from '../domain/expression.fields';
import { TEMPLATE_VARS } from '../domain/template';
import { validateWorkflow } from '../domain/workflow.validator';
import { LIMITS } from '../domain/workflow.types';
import type { Workflow, WorkflowInput, WorkflowIssue, WorkflowListItem, WorkflowMeta, WorkflowRevision } from '../domain/workflow.types';
import { MarketingWorkflowRevisionRow } from '../infrastructure/marketing-workflow-revision.entity';
import { MarketingWorkflowRow } from '../infrastructure/marketing-workflow.entity';

const INPUT_KEYS = ['name', 'triggerType', 'triggerConfig', 'entryStepId', 'steps', 'graphUi', 'cooldownDays', 'holdoutPercent',
  'conversionWindowDays', 'exitOnGoal', 'schedule'] as const;
const inputOf = (r: MarketingWorkflowRow): WorkflowInput => Object.fromEntries(INPUT_KEYS.map((k) => [k, r[k] ?? null])) as unknown as WorkflowInput;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Commerce-run marketing workflows: CRUD, revisions, activation checks (spec 2026-10-10 §4.8). */
@Injectable()
export class WorkflowService {
  constructor(
    @InjectRepository(MarketingWorkflowRow) private readonly workflows: Repository<MarketingWorkflowRow>,
    @InjectRepository(MarketingWorkflowRevisionRow) private readonly revisions: Repository<MarketingWorkflowRevisionRow>,
    private readonly segments: SegmentsService,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  meta(): WorkflowMeta {
    return {
      limits: { maxWaitSteps: LIMITS.maxWaitSteps, maxConditionSteps: LIMITS.maxConditionSteps, maxAudienceSteps: LIMITS.maxAudienceSteps,
        maxWaitMinutes: LIMITS.maxWaitMinutes, maxHeaders: LIMITS.maxHeaders, maxBodyBytes: LIMITS.maxBodyBytes,
        minSplitBranches: LIMITS.minSplitBranches, maxSplitBranches: LIMITS.maxSplitBranches },
      expressionFields: SUPPORTED_FIELDS.map((field) => ({ field, type: MARKETING_EXPRESSION_FIELD_TYPES[field], label: FIELD_LABELS[field] })),
      templateVars: TEMPLATE_VARS.map((v) => ({ ...v })),
    };
  }

  segmentOptions() { return this.segments.evaluableSegments(); }

  async list(): Promise<WorkflowListItem[]> {
    return (await this.db.query(`SELECT w.id, w.name, w.status, w.trigger_type, w.updated_at,
        count(e.id) FILTER (WHERE NOT e.is_test)::int AS enrolled, count(e.converted_at) FILTER (WHERE NOT e.is_test)::int AS converted
      FROM marketing_workflows w LEFT JOIN marketing_workflow_enrollments e ON e.workflow_id = w.id AND e.started_at >= now() - interval '30 days'
      GROUP BY w.id ORDER BY (w.status = 'active') DESC, w.updated_at DESC`))
      .map((r: Record<string, unknown>) => ({ id: r.id, name: r.name, status: r.status, triggerType: r.trigger_type,
        updatedAt: iso(r.updated_at as Date), enrolled30d: r.enrolled, converted30d: r.converted }) as WorkflowListItem);
  }

  async get(id: string): Promise<Workflow> { return this.toDto(await this.row(id)); }

  async create(input: WorkflowInput, actor: string): Promise<Workflow> {
    const row = (await this.workflows.save({ ...input, status: 'draft', createdBy: actor, updatedBy: actor })) as MarketingWorkflowRow;
    await this.revisions.save({ workflowId: row.id, snapshot: inputOf(row), createdBy: actor });
    return this.toDto(row);
  }

  /** An active workflow must stay valid: edits apply to live enrollments. */
  async update(id: string, input: WorkflowInput, actor: string): Promise<Workflow> {
    const row = await this.row(id);
    if (row.status === 'active') await this.assertActivatable({ ...row, ...input } as MarketingWorkflowRow);
    const saved = (await this.workflows.save({ ...row, ...input, updatedBy: actor })) as MarketingWorkflowRow;
    await this.revisions.save({ workflowId: id, snapshot: inputOf(saved), createdBy: actor });
    return this.toDto(saved);
  }

  async activate(id: string, actor: string): Promise<Workflow> {
    const row = await this.row(id);
    await this.assertActivatable(row);
    return this.toDto((await this.workflows.save({ ...row, status: 'active', activatedAt: new Date(), updatedBy: actor })) as MarketingWorkflowRow);
  }

  async pause(id: string, actor: string): Promise<Workflow> {
    const row = await this.row(id);
    return this.toDto((await this.workflows.save({ ...row, status: 'paused', updatedBy: actor })) as MarketingWorkflowRow);
  }

  async remove(id: string): Promise<void> {
    const row = await this.row(id);
    if (row.status === 'active') throw new BadRequestException('หยุด workflow ก่อนลบ');
    await this.workflows.delete({ id });
  }

  async revisionsOf(id: string): Promise<WorkflowRevision[]> {
    return (await this.revisions.find({ where: { workflowId: id }, order: { createdAt: 'DESC' }, take: 50 }))
      .map((r) => ({ id: r.id, createdBy: r.createdBy, createdAt: iso(r.createdAt)!, snapshot: r.snapshot }));
  }

  /** Pure rules + what needs IO: audiences commerce can evaluate, static webhook URLs that are public. */
  async issuesOf(row: MarketingWorkflowRow): Promise<WorkflowIssue[]> {
    const issues = validateWorkflow(inputOf(row));
    const evaluable = new Set((await this.segments.evaluableSegments()).map((s) => s.id));
    for (const s of row.steps ?? []) {
      if (s.type === 'audience' && [...(s.segmentIds ?? []), ...(s.excludeSegmentIds ?? [])].some((x) => !evaluable.has(x)))
        issues.push({ stepId: s.id, code: 'audience_segment', message: 'segment นี้ใช้กับ workflow ของ commerce ไม่ได้' });
      if (s.type === 'webhook' && s.url && !s.url.includes('{{')) {
        await assertPublicHttpUrl(s.url).catch(() => issues.push({ stepId: s.id, code: 'webhook_blocked', message: 'URL นี้ชี้ไปที่เครือข่ายภายในหรือหาไม่เจอ' }));
      }
    }
    return issues;
  }

  async row(id: string): Promise<MarketingWorkflowRow> {
    const row = await this.workflows.findOneBy({ id });
    if (!row) throw new NotFoundException('ไม่พบ workflow');
    return row;
  }

  private async assertActivatable(row: MarketingWorkflowRow) {
    const issues = await this.issuesOf(row);
    if (issues.length) throw new UnprocessableEntityException({ message: 'workflow ยังไม่พร้อมเปิดใช้', issues });
  }

  private async toDto(r: MarketingWorkflowRow): Promise<Workflow> {
    return { ...inputOf(r), id: r.id, status: r.status, activatedAt: iso(r.activatedAt), createdBy: r.createdBy ?? null, updatedBy: r.updatedBy ?? null,
      createdAt: iso(r.createdAt)!, updatedAt: iso(r.updatedAt)!, issues: await this.issuesOf(r) };
  }
}
