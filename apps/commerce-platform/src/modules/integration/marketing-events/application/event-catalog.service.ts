import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { EventDefinition, EventDefinitionInput } from '@cp/marketing-workflow';
import { definitionIssues } from '../domain/event-catalog';
import { eventRefsIn } from '../domain/event-rule';
import { MarketingEventDefinitionRow } from '../infrastructure/marketing-event-definition.entity';

const CACHE_MS = 60_000;
export const toDefinition = (r: MarketingEventDefinitionRow): EventDefinition => ({
  name: r.name, label: r.label, description: r.description ?? null, attributes: r.attributes ?? [], evidence: r.evidence, status: r.status,
  createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString(),
});

/** The catalog, cached per process for ingest and rule checks; writes invalidate it (spec §3, §14). */

@Injectable()
export class EventCatalogService {
  private cache: { at: number; map: Map<string, EventDefinition> } | null = null;
  constructor(
    @InjectRepository(MarketingEventDefinitionRow) protected readonly rows: Repository<MarketingEventDefinitionRow>,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  async byName(now = Date.now()): Promise<Map<string, EventDefinition>> {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.map;
    const map = new Map((await this.rows.find({ order: { name: 'ASC' } })).map((r) => [r.name, toDefinition(r)] as const));
    this.cache = { at: now, map };
    return map;
  }

  invalidate(): void { this.cache = null; }

  async list(): Promise<EventDefinition[]> { return [...(await this.byName(0)).values()]; }

  async create(input: EventDefinitionInput): Promise<EventDefinition> {
    const issues = definitionIssues(input);
    if (issues.length) throw new UnprocessableEntityException({ message: 'บันทึก event ไม่ได้', issues });
    if (await this.rows.findOneBy({ name: input.name })) throw new ConflictException('มี event ชื่อนี้แล้ว');
    const saved = await this.rows.save({ ...input, status: 'active' as const });
    this.invalidate();
    return toDefinition(saved as MarketingEventDefinitionRow);
  }

  /** Name and attribute types are fixed; attributes are added or archived, never removed (spec §14). */
  async update(name: string, input: EventDefinitionInput): Promise<EventDefinition> {
    const row = await this.rows.findOneBy({ name });
    if (!row) throw new NotFoundException('ไม่พบ event');
    const issues = definitionIssues(input, toDefinition(row));
    if (issues.length) throw new UnprocessableEntityException({ message: 'บันทึก event ไม่ได้', issues });
    const newlyArchived = input.attributes.filter((a) => a.archived && !row.attributes.find((o) => o.key === a.key)?.archived).map((a) => a.key);
    if (newlyArchived.length) await this.assertUnused(name, newlyArchived);
    const saved = await this.rows.save({ ...row, label: input.label, description: input.description, evidence: input.evidence, attributes: input.attributes });
    this.invalidate();
    return toDefinition(saved as MarketingEventDefinitionRow);
  }

  async archive(name: string): Promise<EventDefinition> {
    const row = await this.rows.findOneBy({ name });
    if (!row) throw new NotFoundException('ไม่พบ event');
    await this.assertUnused(name, null);
    const saved = await this.rows.save({ ...row, status: 'archived' as const });
    this.invalidate();
    return toDefinition(saved as MarketingEventDefinitionRow);
  }

  /** keys null = the whole event. Active workflows (trigger, wait, goal, rules) and every dynamic segment count as users. */
  private async assertUnused(name: string, keys: string[] | null): Promise<void> {
    const users: string[] = [];
    const uses = (json: unknown) => { const k = eventRefsIn(json).get(name); return !!k && (keys === null || keys.some((x) => k.has(x))); };
    for (const w of await this.db.query(`SELECT id, name, trigger_config, exit_on_goal, steps FROM marketing_workflows WHERE status = 'active'`)) {
      if (uses([w.trigger_config, w.exit_on_goal, w.steps])) users.push(`workflow: ${w.name}`);
    }
    for (const s of await this.db.query(`SELECT id, name, rule FROM marketing_dynamic_segments`)) if (uses(s.rule)) users.push(`dynamic segment: ${s.name}`);
    if (users.length) throw new ConflictException({ message: 'ยังมีที่ใช้อยู่', users });
  }
}
