import { Injectable, Logger } from '@nestjs/common';
import { DataSource, ILike, IsNull } from 'typeorm';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompetitorPricesService } from '../modules/integration/competitor-prices/competitor-prices.service';
import { JoshCatalogProduct } from '../modules/integration/connector/josh/josh-catalog-product.entity';
import { AuditLog } from '../modules/core/audit/infrastructure/audit-log.entity';
import { ScrapingService } from '../modules/platform/scraping/application/scraping.service';
import { MarketingResearchService } from '../modules/platform/marketing-research/application/marketing-research.service';
import type { McpStaff } from './mcp-oauth.provider';

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const productName = (p: JoshCatalogProduct) =>
  p.translations?.find((t) => t.language_code === 'th')?.product_name ?? p.translations?.[0]?.product_name ?? p.sku;

/**
 * Read-only tools for AI connectors. Every tool only reads; an AI can look up
 * and summarize, never change anything. What a caller sees follows the staff
 * role behind the token: marketing tools for `marketing` + `admin`, ERP/ops
 * tools for `admin` only — same split as commerce-admin.
 */
@Injectable()
export class McpTools {
  constructor(
    private readonly db: DataSource,
    private readonly competitor: CompetitorPricesService,
    private readonly scraping: ScrapingService,
    private readonly research: MarketingResearchService,
  ) {}

  /** A fresh server per request (stateless transport) with the tools this staff member may use. */
  server(staff: McpStaff, clientId: string): McpServer {
    const server = new McpServer(
      { name: 'commerce-platform', version: '1.0.0' },
      { instructions: 'Commerce Platform (Jagota / Josh). Read-only: look up and summarize competitor prices, scraped competitor catalogs, marketing research and the Josh catalog' +
        (staff.role === 'admin' ? ', plus ERP intake, webhook delivery failures and stock per warehouse.' : '.') +
        ' Prices are THB including VAT. Answer in the user\'s language.' },
    );
    // Every tool call is recorded in audit_logs: who, which AI client, which tool, with what arguments.
    const register = server.registerTool.bind(server);
    server.registerTool = ((name: string, config: never, cb: (args: unknown, extra: unknown) => unknown) =>
      register(name, config, (async (args: unknown, extra: unknown) => {
        await this.audit(staff, clientId, name, args);
        return cb(args, extra);
      }) as never)) as typeof server.registerTool;
    this.marketing(server, staff);
    if (staff.role === 'admin') this.ops(server);
    return server;
  }

  private async audit(staff: McpStaff, clientId: string, tool: string, args: unknown) {
    try {
      await this.db.getRepository(AuditLog).insert({
        actorId: staff.userId, action: 'mcp.tool_call', entityType: 'mcp_tool', entityId: null,
        context: { tool, args: args as Record<string, unknown>, clientId, email: staff.email, role: staff.role },
      });
    } catch (error) {
      // Read-only tools: an audit outage is logged loudly but does not block the answer.
      Logger.error(`MCP audit write failed (${tool} by ${staff.email}): ${error instanceof Error ? error.message : error}`, 'Mcp');
    }
  }

  private marketing(server: McpServer, staff: McpStaff) {
    server.registerTool('competitor_prices', {
      title: 'Competitor price comparison',
      description: 'Tracked pairs of our SKU vs a competitor product, with price per kg (THB incl. VAT) and the gap. differencePerKg > 0 means we are cheaper.',
      inputSchema: {
        filter: z.enum(['all', 'ready', 'we_are_cheaper', 'we_are_more_expensive', 'needs_review']).default('all')
          .describe('ready = comparable now; needs_review = match not verified yet'),
        search: z.string().max(100).optional().describe('SKU, product name or competitor name'),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: READ_ONLY,
    }, async ({ filter, search, limit }) => {
      const q = search?.toLowerCase();
      const rows = (await this.competitor.list()).filter((r) => {
        const gap = r.differencePerKgIncVat ?? 0;
        const keep = filter === 'all' || (filter === 'ready' && r.comparisonReady) || (filter === 'needs_review' && !r.verified)
          || (filter === 'we_are_cheaper' && r.comparisonReady && gap > 0) || (filter === 'we_are_more_expensive' && r.comparisonReady && gap < 0);
        return keep && (!q || `${r.ourProduct.sku} ${r.ourProduct.name} ${r.competitorName} ${r.sourceName}`.toLowerCase().includes(q));
      });
      return json({
        total: rows.length,
        pairs: rows.slice(0, limit).map((r) => ({
          sku: r.ourProduct.sku, product: r.ourProduct.name, competitor: r.sourceName, competitorProduct: r.competitorName, url: r.sourceUrl,
          ourPerKg: r.ourPricePerKgIncVat, theirPerKg: r.competitorPricePerKgIncVat, differencePerKg: r.differencePerKgIncVat,
          differencePercent: r.differencePercent, comparable: r.comparisonReady, why: r.comparisonReason, observedAt: r.observedAt,
        })),
      });
    });

    server.registerTool('scraped_catalog_search', {
      title: 'Search collected competitor products',
      description: 'Products and prices collected from competitor websites (latest observation per product page).',
      inputSchema: {
        query: z.string().max(200).default('').describe('product name or competitor SKU; empty = latest'),
        sourceId: z.string().uuid().optional().describe('limit to one website (see scraping_sources)'),
        page: z.number().int().min(1).max(1000).default(1),
      },
      annotations: READ_ONLY,
    }, async ({ query, sourceId, page }) => {
      const result = await this.scraping.listItems(sourceId, query, page);
      return json({
        total: result.total, page: result.page, pageSize: result.pageSize,
        items: result.items.map((i) => ({ name: i.name, sku: i.sku, website: i.source.name, priceIncVat: i.priceIncVat, currency: i.currency, weightKg: i.weightKg, url: i.url, observedAt: i.observedAt })),
      });
    });

    server.registerTool('scraping_sources', {
      title: 'Competitor websites being collected',
      description: 'Configured competitor websites with collection status, progress and last run.',
      inputSchema: {},
      annotations: READ_ONLY,
    }, async () => json((await this.scraping.listSources()).map((s) => ({
      id: s.id, name: s.name, origin: s.origin, enabled: s.enabled, status: s.status, everyHours: s.config.intervalHours,
      lastRunAt: s.lastRunAt, lastError: s.lastError, items: s.progress.items, pages: s.progress.pages,
    }))));

    server.registerTool('research_topics', {
      title: 'Marketing research topics',
      description: 'Research questions the marketing team saved (newest first). Use research_report for the findings of one topic.',
      inputSchema: { page: z.number().int().min(1).max(100).default(1) },
      annotations: READ_ONLY,
    }, async ({ page }) => {
      const result = await this.research.list({ page, limit: 20 } as never, { sub: staff.userId, role: staff.role });
      return json({ total: result.totalCount, topics: result.items.map((t) => ({ id: t.id, title: t.title, kind: t.kind, area: t.area, days: t.days, sector: t.sector, sources: t.sources, updatedAt: t.updatedAt })) });
    });

    server.registerTool('research_report', {
      title: 'Latest research report for a topic',
      description: 'Summary, findings and cited evidence from the most recent finished runs of one research topic.',
      inputSchema: { topicId: z.string().uuid(), runs: z.number().int().min(1).max(5).default(1) },
      annotations: READ_ONLY,
    }, async ({ topicId, runs }) => {
      const list = await this.research.runs(topicId, { page: 1, limit: 20 } as never);
      const finished = list.items.filter((r) => ['completed', 'partial'].includes(r.status)).slice(0, runs);
      const reports = await Promise.all(finished.map((r) => this.research.runDetail(r.id)));
      return json({
        runsTotal: list.totalCount,
        reports: reports.map((r) => ({ runId: r.id, status: r.status, finishedAt: r.finishedAt, report: r.report })),
        latestStatus: list.items[0] ? { status: list.items[0].status, message: list.items[0].message } : null,
      });
    });

    server.registerTool('catalog_products', {
      title: 'Josh catalog lookup',
      description: 'Our products (copy of the Josh catalog): SKU, Thai/English name, brand, unit and live selling price incl. VAT.',
      inputSchema: {
        query: z.string().min(1).max(100).describe('SKU (exact or prefix) or product name'),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_ONLY,
    }, async ({ query, limit }) => {
      const repo = this.db.getRepository(JoshCatalogProduct);
      const bySku = await repo.find({ where: { sku: ILike(`${query.replace(/[%_]/g, '')}%`), removedAt: IsNull() }, take: limit });
      const byName = bySku.length >= limit ? [] : await repo.createQueryBuilder('p')
        .where('p.removed_at IS NULL').andWhere(`p.translations::text ILIKE :q`, { q: `%${query.replace(/[%_]/g, '')}%` })
        .take(limit - bySku.length).getMany();
      const rows = [...bySku, ...byName.filter((p) => !bySku.some((s) => s.id === p.id))];
      return json(rows.map((p) => ({ sku: p.sku, name: productName(p), brand: p.brandName, status: p.status, sellingUnit: p.sellingUnit,
        sellingUnitPriceIncVat: p.sellingUnitPrice == null ? null : Number(p.sellingUnitPrice), packSize: p.packSize, updatedAt: p.joshUpdatedAt })));
    });
  }

  private ops(server: McpServer) {
    server.registerTool('erp_intake_summary', {
      title: 'ERP intake summary (admin)',
      description: 'What the ERP sent in the last N hours: counts by type and status, plus the most recent failures.',
      inputSchema: { hours: z.number().int().min(1).max(24 * 30).default(24) },
      annotations: READ_ONLY,
    }, async ({ hours }) => {
      const since = new Date(Date.now() - hours * 3600_000);
      const counts = await this.db.query(
        `SELECT entity_type AS type, status, count(*)::int AS count FROM erp_ingest_records WHERE created_at >= $1 GROUP BY 1, 2 ORDER BY 1, 2`, [since]);
      const failures = await this.db.query(
        `SELECT entity_type AS type, external_id AS "externalId", status, error, created_at AS "at" FROM erp_ingest_records
         WHERE created_at >= $1 AND status = 'failed' ORDER BY created_at DESC LIMIT 20`, [since]);
      return json({ since, counts, recentFailures: failures });
    });

    server.registerTool('webhook_failures', {
      title: 'Undelivered events to platforms (admin)',
      description: 'Events commerce could not deliver to subscribed platforms (e.g. josh shop): dead-lettered after retries.',
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
      annotations: READ_ONLY,
    }, async ({ limit }) => json(await this.db.query(
      `SELECT d.event_type AS "eventType", d.status, d.status_code AS "statusCode", d.attempts, d.error, d.target_url AS "target",
              d.payload->'data'->>'sku' AS sku, d.created_at AS "at"
       FROM webhook_deliveries d WHERE d.status = 'failed' AND d.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT $1`, [limit])));

    server.registerTool('stock_levels', {
      title: 'Stock per warehouse (admin)',
      description: 'On-hand and reserved quantity per warehouse for one SKU, as last reported by the ERP.',
      inputSchema: { sku: z.string().min(1).max(64) },
      annotations: READ_ONLY,
    }, async ({ sku }) => json(await this.db.query(
      `SELECT p.sku, p.name, w.code AS warehouse, w.name AS "warehouseName", l.quantity::float AS quantity, l.reserved::float AS reserved
       FROM inventory_levels l JOIN products p ON p.id = l.product_id JOIN warehouses w ON w.id = l.warehouse_id
       WHERE p.sku = $1 AND p.deleted_at IS NULL ORDER BY w.code`, [sku])));
  }
}
