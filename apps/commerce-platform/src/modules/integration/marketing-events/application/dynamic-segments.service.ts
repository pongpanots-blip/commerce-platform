import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { DynamicSegment, DynamicSegmentInput, EventRule } from '@cp/marketing-workflow';
import { ruleIssues } from '../domain/event-rule';
import { MarketingDynamicSegmentRow } from '../infrastructure/marketing-dynamic-segment.entity';
import { EventRuleService } from './event-rule.service';

const iso = (d: Date) => new Date(d).toISOString();

/** Named event rules for commerce workflows only (spec §11): never frozen, never sent to josh. */
@Injectable()
export class DynamicSegmentsService {
  constructor(
    @InjectRepository(MarketingDynamicSegmentRow) private readonly rows: Repository<MarketingDynamicSegmentRow>,
    @InjectDataSource() private readonly db: DataSource,
    private readonly rules: EventRuleService,
  ) {}

  async list(): Promise<DynamicSegment[]> { return Promise.all((await this.rows.find({ order: { name: 'ASC' } })).map((r) => this.toDto(r))); }
  async get(id: string): Promise<DynamicSegment> { return this.toDto(await this.row(id)); }

  async create(input: DynamicSegmentInput, actor: string): Promise<DynamicSegment> {
    return this.toDto(await this.rows.save({ ...input, createdBy: actor }) as MarketingDynamicSegmentRow);
  }

  async update(id: string, input: DynamicSegmentInput): Promise<DynamicSegment> {
    const row = await this.row(id);
    return this.toDto(await this.rows.save({ ...row, ...input }) as MarketingDynamicSegmentRow);
  }

  async remove(id: string): Promise<void> {
    await this.row(id);
    const users = (await this.db.query(`SELECT id, name, steps FROM marketing_workflows WHERE status = 'active'`))
      .filter((w: { steps: unknown }) => JSON.stringify(w.steps).includes(id)).map((w: { name: string }) => w.name);
    if (users.length) throw new ConflictException({ message: 'workflow ที่เปิดใช้อยู่ยังใช้ segment นี้', users });
    await this.rows.delete({ id });
  }

  async preview(rule: EventRule): Promise<{ count: number | null; issues: string[] }> {
    const issues = ruleIssues(rule, { ...(await this.rules.context()), segmentIds: null });
    return issues.length ? { count: null, issues } : { count: await this.rules.count(rule), issues };
  }

  private async row(id: string): Promise<MarketingDynamicSegmentRow> {
    const r = await this.rows.findOneBy({ id });
    if (!r) throw new NotFoundException('ไม่พบ dynamic segment');
    return r;
  }

  /** Drafts may be saved with issues; workflows refuse to activate on a segment that still has them (Task 9). */
  private async toDto(r: MarketingDynamicSegmentRow): Promise<DynamicSegment> {
    const issues = ruleIssues(r.rule, { ...(await this.rules.context()), segmentIds: null });
    return { id: r.id, name: r.name, description: r.description ?? null, rule: r.rule, createdBy: r.createdBy ?? null,
      createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt), issues };
  }
}
