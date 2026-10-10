import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EventDefinition } from '@cp/marketing-workflow';
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
  constructor(@InjectRepository(MarketingEventDefinitionRow) protected readonly rows: Repository<MarketingEventDefinitionRow>) {}

  async byName(now = Date.now()): Promise<Map<string, EventDefinition>> {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.map;
    const map = new Map((await this.rows.find({ order: { name: 'ASC' } })).map((r) => [r.name, toDefinition(r)] as const));
    this.cache = { at: now, map };
    return map;
  }

  invalidate(): void { this.cache = null; }
}
