import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { EventRule } from '@cp/marketing-workflow';
import type { Types } from '../domain/event-filter';
import { compileRule, segmentIdsIn, typesOf, type RuleContext } from '../domain/event-rule';
import { usableUsers } from '../infrastructure/device-links';
import { EventsStore } from '../infrastructure/events.store';
import { MarketingDynamicSegmentRow } from '../infrastructure/marketing-dynamic-segment.entity';
import { EventCatalogService } from './event-catalog.service';

/** Live evaluation of event rules for one customer or a count over all customers (spec §11). Consent first (§5.1). */
@Injectable()
export class EventRuleService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectRepository(MarketingDynamicSegmentRow) private readonly segments: Repository<MarketingDynamicSegmentRow>,
    private readonly catalog: EventCatalogService,
    private readonly store: EventsStore,
  ) {}

  async context(now = new Date()): Promise<RuleContext> {
    const [catalog, coverageStart, ids] = await Promise.all([this.catalog.byName(), this.store.coverageStart(), this.segments.find({ select: { id: true } })]);
    return { catalog, coverageStart, segmentIds: new Set(ids.map((s) => s.id)), now };
  }

  async typesOf(eventName: string): Promise<Types> {
    const def = (await this.catalog.byName()).get(eventName);
    return def ? typesOf(def) : {};
  }

  async matches(rule: EventRule, userId: string, m: EntityManager = this.db.manager): Promise<boolean> {
    if (!(await usableUsers(m, [userId])).has(userId)) return false;
    const params: unknown[] = [userId];
    const sql = compileRule(rule, await this.refs(rule), '$1::uuid', params);
    const [r] = await m.query(`SELECT (${sql}) AS ok`, params);
    return !!r?.ok;
  }

  async segmentMatches(segmentId: string, userId: string, m: EntityManager = this.db.manager): Promise<boolean> {
    const s = await m.getRepository(MarketingDynamicSegmentRow).findOneBy({ id: segmentId });
    return s ? this.matches(s.rule, userId, m) : false;
  }

  /** Customers (with consent) matching now. 5 s statement timeout: preview must never load the database. */
  async count(rule: EventRule): Promise<number> {
    const params: unknown[] = [];
    const sql = compileRule(rule, await this.refs(rule), 'u.id', params);
    return this.db.transaction(async (m) => {
      await m.query(`SET LOCAL statement_timeout = '5s'`);
      const [r] = await m.query(`SELECT count(*)::int AS n FROM segment_customers u JOIN josh_customers c ON c.id = u.id
        WHERE (c.data->>'pdpa_consent')::boolean IS TRUE AND ${sql}`, params);
      return r?.n ?? 0;
    });
  }

  private async refs(rule: EventRule) {
    const ids = segmentIdsIn(rule);
    const rows = ids.length ? await this.segments.findBy({ id: In(ids) }) : [];
    return { catalog: await this.catalog.byName(), segments: new Map(rows.map((r) => [r.id, r.rule] as const)) };
  }
}
