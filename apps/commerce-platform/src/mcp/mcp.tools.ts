import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, ILike, IsNull } from 'typeorm';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CompetitorPricesService } from '../modules/integration/competitor-prices/competitor-prices.service';
import { JoshCatalogProduct } from '../modules/integration/connector/josh/josh-catalog-product.entity';
import { AuditLog } from '../modules/core/audit/infrastructure/audit-log.entity';
import { ScrapingService } from '../modules/platform/scraping/application/scraping.service';
import { MarketingResearchService } from '../modules/platform/marketing-research/application/marketing-research.service';
import { MCP_WRITE_SCOPE, McpOAuthProvider, McpStaff } from './mcp-oauth.provider';
import { CreateResearchTopicDto } from '../modules/platform/marketing-research/dto/research.dto';
import { RESEARCH_KINDS, RESEARCH_SOURCES } from '../modules/platform/marketing-research/research.types';
import { WebhookSubscriptionService } from '../modules/integration/webhook-subscription/application/webhook-subscription.service';
import { ErpIngestService } from '../modules/integration/connector/erp/ingest/erp-ingest.service';
import { ErpIngestRecord } from '../modules/integration/connector/erp/erp-ingest-record.entity';
import { WebhookDelivery } from '../modules/integration/webhook-subscription/infrastructure/webhook-delivery.entity';
import { InventoryLedgerService } from '../modules/commerce/inventory/application/inventory-ledger.service';
import { Warehouse } from '../modules/commerce/warehouse/infrastructure/warehouse.entity';
import { InventoryLevel } from '../modules/commerce/inventory/infrastructure/inventory-level.entity';

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const CONFIRM = z.string().max(100).optional()
  .describe('Leave empty first: you get a preview + confirmCode. Show the preview to the user; only after they explicitly agree, call again with the same arguments and this confirmCode.');
/** Same arguments → same hash, whatever order the client sent them in. */
const argsHash = (args: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(Object.keys(args).sort().map((k) => [k, args[k]]))).digest('hex');
const AREAS = ['กรุงเทพมหานคร', 'กรุงเทพฯ และปริมณฑล', 'ทั่วประเทศไทย'] as const;
const SECTORS = ['ทุกกลุ่ม · น้ำหนักเท่ากัน', 'ร้านอาหาร', 'โรงแรม / จัดเลี้ยง', 'ร้านค้าปลีก', 'โรงงานอาหาร'] as const;
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
    private readonly oauth: McpOAuthProvider,
    private readonly webhooks: WebhookSubscriptionService,
    private readonly ingest: ErpIngestService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  /** A fresh server per request (stateless transport) with the tools this staff member may use. */
  server(staff: McpStaff, clientId: string, scopes: string[] = []): McpServer {
    const canWrite = scopes.includes(MCP_WRITE_SCOPE);
    const server = new McpServer(
      { name: 'commerce-platform', version: '1.0.0' },
      { instructions: 'Commerce Platform (Jagota / Josh). Read-only: look up and summarize competitor prices, scraped competitor catalogs, marketing research and the Josh catalog' +
        (staff.role === 'admin' ? ', plus ERP intake, webhook delivery failures and stock per warehouse.' : '.') +
        (canWrite ? ' A few tools change data; each one first returns a preview and a confirmCode — always show the preview and get the user\'s explicit OK before calling it again with the code.' : ' This connection is read-only.') +
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
    if (canWrite) this.writes(server, staff, clientId);
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
          pairId: r.id, sku: r.ourProduct.sku, product: r.ourProduct.name, competitor: r.sourceName, competitorProduct: r.competitorName, url: r.sourceUrl,
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

  /**
   * Two-step write: without confirmCode → preview + one-time code (10 min, bound to this staff,
   * AI client, tool and exact arguments); with it → do it. A changed argument needs a new preview.
   */
  private async twoStep(staff: McpStaff, clientId: string, tool: string, args: Record<string, unknown>,
    preview: () => Promise<unknown>, run: () => Promise<unknown>) {
    const { confirmCode, ...rest } = args;
    const hash = argsHash(rest);
    if (!confirmCode) {
      const shown = await preview();
      return json({ status: 'needs_confirmation', willDo: shown, confirmCode: await this.oauth.issueConfirm(staff.userId, clientId, tool, hash),
        next: 'Show "willDo" to the user. Only if they explicitly agree, call this tool again with exactly the same arguments plus confirmCode.' });
    }
    if (!(await this.oauth.consumeConfirm(String(confirmCode), staff.userId, clientId, tool, hash))) {
      return { ...json({ status: 'rejected', reason: 'confirmCode is invalid, expired, already used, or the arguments changed. Call again without confirmCode for a new preview.' }), isError: true };
    }
    const result = await run();
    await this.db.getRepository(AuditLog).insert({
      actorId: staff.userId, action: 'mcp.write', entityType: 'mcp_tool', entityId: null,
      context: { tool, args: rest, clientId, email: staff.email, role: staff.role },
    });
    return json({ status: 'done', result });
  }

  private writes(server: McpServer, staff: McpStaff, clientId: string) {
    const actor = { sub: staff.userId, role: staff.role };

    server.registerTool('research_create_topic', {
      title: 'Create a research topic (needs confirmation)',
      description: 'Save a new marketing research question. Free sources tat (TAT restaurant data) and osm (OpenStreetMap) work today.',
      inputSchema: {
        title: z.string().min(1).max(400), kind: z.enum(RESEARCH_KINDS), area: z.enum(AREAS).default('กรุงเทพมหานคร'),
        days: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(30), sector: z.enum(SECTORS).default('ทุกกลุ่ม · น้ำหนักเท่ากัน'),
        sources: z.array(z.enum(RESEARCH_SOURCES)).min(1).max(7).default(['tat', 'osm']), followHourly: z.boolean().default(false),
        confirmCode: CONFIRM,
      },
      annotations: WRITE,
    }, async (args) => this.twoStep(staff, clientId, 'research_create_topic', args,
      async () => ({ action: 'create research topic', ...args, confirmCode: undefined }),
      async () => {
        const { confirmCode: _c, ...fields } = args;
        const dto = plainToInstance(CreateResearchTopicDto, fields);
        const errors = await validate(dto);
        if (errors.length) throw new Error(errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; '));
        const topic = await this.research.create(dto, actor);
        return { topicId: topic.id, title: topic.title };
      }));

    server.registerTool('research_request_run', {
      title: 'Run a research topic now (needs confirmation)',
      description: 'Queue one run of an existing research topic (yours, or any if admin). Read the result later with research_report.',
      inputSchema: { topicId: z.string().uuid(), confirmCode: CONFIRM },
      annotations: WRITE,
    }, async (args) => this.twoStep(staff, clientId, 'research_request_run', args,
      async () => {
        const topic = await this.research.detail(args.topicId, actor);
        return { action: 'queue a research run', topic: topic.title, sources: topic.sources, youCanManage: topic.canManage };
      },
      async () => {
        const run = await this.research.requestRun(args.topicId, randomUUID(), actor);
        return { runId: run.id, status: run.status };
      }));

    server.registerTool('competitor_record_price', {
      title: 'Record a competitor price (needs confirmation)',
      description: 'Save a competitor pack price (THB incl. VAT) the user saw on the source page, for one tracked pair (pairId from competitor_prices). Does not verify matches — a person still does that.',
      inputSchema: {
        pairId: z.string().uuid(), priceIncVat: z.number().positive().max(9999999999.99),
        observedAt: z.string().datetime({ offset: true }).optional().describe('when the user saw this price; default now'),
        confirmCode: CONFIRM,
      },
      annotations: { ...WRITE, destructiveHint: true }, // replaces the pair's current observation
    }, async (args) => {
      const pair = async () => {
        const row = (await this.competitor.list()).find((r) => r.id === args.pairId);
        if (!row) throw new Error('pair not found — use competitor_prices to get a pairId');
        return row;
      };
      return this.twoStep(staff, clientId, 'competitor_record_price', args,
        async () => {
          const row = await pair();
          return { action: 'record competitor price', sku: row.ourProduct.sku, product: row.ourProduct.name, competitor: row.sourceName,
            competitorProduct: row.competitorName, packKg: row.competitorWeightKg, currentPrice: row.competitorPackPriceIncVat,
            newPrice: args.priceIncVat, newPerKg: Math.round((args.priceIncVat / row.competitorWeightKg) * 100) / 100,
            ourPerKg: row.ourPricePerKgIncVat, observedAt: args.observedAt ?? 'now' };
        },
        async () => {
          const row = await pair();
          const saved = await this.competitor.capture(row.id, {
            revision: row.revision, priceIncVat: args.priceIncVat,
            observedAt: new Date(args.observedAt ?? Date.now()).toISOString(),
          });
          return { competitorPerKg: saved.competitorPricePerKgIncVat, differencePerKg: saved.differencePerKgIncVat, comparable: saved.comparisonReady, why: saved.comparisonReason };
        });
    });

    const sourceView = async (id: string) => {
      const source = await this.scraping.source(id);
      return { source, shown: { name: source.name, origin: source.origin, enabled: source.enabled, status: source.status,
        everyHours: source.config.intervalHours, maxPages: source.config.maxPages, collectionAllowed: source.config.collectionAllowed } };
    };

    server.registerTool('scraping_update_source', {
      title: 'Change a competitor website schedule (needs confirmation)',
      description: 'Turn automatic collection on/off and/or change how often it runs (24 = daily, 168 = weekly, 720 = monthly). sourceId from scraping_sources.',
      inputSchema: {
        sourceId: z.string().uuid(), enabled: z.boolean().optional(),
        intervalHours: z.number().int().min(1).max(8760).optional(), confirmCode: CONFIRM,
      },
      annotations: WRITE,
    }, async (args) => {
      if (args.enabled === undefined && args.intervalHours === undefined) return { ...json({ status: 'rejected', reason: 'give enabled and/or intervalHours' }), isError: true };
      return this.twoStep(staff, clientId, 'scraping_update_source', args,
        async () => {
          const { shown } = await sourceView(args.sourceId);
          return { action: 'change collection settings', website: shown.name, now: { enabled: shown.enabled, everyHours: shown.everyHours },
            after: { enabled: args.enabled ?? shown.enabled, everyHours: args.intervalHours ?? shown.everyHours },
            warning: shown.status === 'running' ? 'a collection run is in progress; saving settings stops it' : undefined };
        },
        async () => {
          const { source } = await sourceView(args.sourceId);
          const saved = await this.scraping.save({ name: source.name, origin: source.origin, revision: source.revision,
            enabled: args.enabled ?? source.enabled, config: { ...source.config, intervalHours: args.intervalHours ?? source.config.intervalHours } } as never, source.id);
          return { website: saved.name, enabled: saved.enabled, everyHours: saved.config.intervalHours, status: saved.status };
        });
    });

    server.registerTool('scraping_run', {
      title: 'Start or stop collecting a competitor website now (needs confirmation)',
      description: 'start = begin a fresh collection run now (visits the competitor site); stop = pause the current run and turn automatic collection off.',
      inputSchema: { sourceId: z.string().uuid(), action: z.enum(['start', 'stop']), confirmCode: CONFIRM },
      annotations: { ...WRITE, openWorldHint: true }, // start reaches out to a public website
    }, async (args) => this.twoStep(staff, clientId, 'scraping_run', args,
      async () => {
        const { shown } = await sourceView(args.sourceId);
        return { action: args.action === 'start' ? `start collecting ${shown.origin} now (up to ${shown.maxPages} pages)` : 'stop collecting and turn automatic collection off',
          website: shown.name, status: shown.status,
          note: args.action === 'start' && !shown.collectionAllowed ? 'collection permission is not confirmed for this site — this will be refused' : undefined };
      },
      async () => {
        const { source } = await sourceView(args.sourceId);
        const saved = args.action === 'start'
          ? await this.scraping.start(source.id, { revision: source.revision, restart: true })
          : await this.scraping.stop(source.id, source.revision);
        return { website: saved.name, status: saved.status, enabled: saved.enabled };
      }));

    if (staff.role !== 'admin') return;

    server.registerTool('stock_adjust', {
      title: 'Adjust stock in a warehouse commerce owns (admin, needs confirmation)',
      description: 'Manual stock change for warehouses whose stock commerce owns (stock_source = commerce). ERP-owned warehouses are refused — change those in the ERP. set = counted quantity; add = signed change (+receive, −damage).',
      inputSchema: {
        sku: z.string().min(1).max(64), warehouseCode: z.string().min(1).max(64),
        mode: z.enum(['set', 'add']), quantity: z.number().int().min(-1_000_000).max(1_000_000),
        reason: z.enum(['COUNT', 'RECEIVE', 'DAMAGE', 'RETURN', 'CORRECTION']), note: z.string().max(200).optional(),
        confirmCode: CONFIRM,
      },
      annotations: { ...WRITE, destructiveHint: true },
    }, async (args) => {
      const target = async () => {
        const [product] = await this.db.query(`SELECT id, sku, name FROM products WHERE sku = $1 AND deleted_at IS NULL LIMIT 1`, [args.sku]);
        if (!product) throw new Error(`no product with SKU ${args.sku}`);
        const warehouse = await this.db.getRepository(Warehouse).findOneBy({ code: args.warehouseCode });
        if (!warehouse) throw new Error(`no warehouse with code ${args.warehouseCode}`);
        if (warehouse.stockSource !== 'commerce') throw new Error(`warehouse ${warehouse.code} takes its stock from the ERP — adjust it in the ERP, the feed brings it here`);
        return { product: product as { id: string; sku: string; name: string }, warehouse };
      };
      return this.twoStep(staff, clientId, 'stock_adjust', args,
        async () => {
          const { product, warehouse } = await target();
          const level = await this.db.getRepository(InventoryLevel).findOneBy({ productId: product.id, warehouseId: warehouse.id });
          const now = level ? Number(level.quantity) : 0;
          const after = args.mode === 'set' ? args.quantity : now + args.quantity;
          return { action: 'adjust stock', sku: product.sku, product: product.name, warehouse: `${warehouse.code} ${warehouse.name}`,
            now, after, reserved: level ? Number(level.reserved) : 0, reason: args.reason, note: args.note,
            problem: after < 0 ? 'would go negative — will be refused' : undefined };
        },
        async () => {
          const { product, warehouse } = await target();
          return this.db.transaction((manager) => this.ledger.adjustOwnStock(manager, {
            productId: product.id, sku: product.sku, warehouse, mode: args.mode, quantity: args.quantity, reason: args.reason, ref: `mcp:${staff.userId}`,
          }));
        });
    });

    server.registerTool('webhook_retry_delivery', {
      title: 'Resend a failed event to a platform (admin, needs confirmation)',
      description: 'Dead-letter retry: resend one failed delivery (id from webhook_failures), e.g. after the SKU was added in josh.',
      inputSchema: { deliveryId: z.string().uuid(), confirmCode: CONFIRM },
      annotations: WRITE,
    }, async (args) => this.twoStep(staff, clientId, 'webhook_retry_delivery', args,
      async () => {
        const d = await this.db.getRepository(WebhookDelivery).findOneBy({ id: args.deliveryId });
        if (!d) throw new Error('delivery not found');
        return { action: 'resend event', eventType: d.eventType, target: d.targetUrl, status: d.status, lastError: d.error,
          sku: (d.payload as { data?: { sku?: string } })?.data?.sku ?? null };
      },
      async () => {
        const d = await this.webhooks.retryDelivery(args.deliveryId);
        return { deliveryId: d.id, status: d.status };
      }));

    server.registerTool('erp_replay_ingest', {
      title: 'Re-apply a failed ERP record (admin, needs confirmation)',
      description: 'Run a failed ERP intake record (id from erp_intake_summary) through its applier again. qty/price/moq feed rows are retried with webhook_retry_delivery instead.',
      inputSchema: { recordId: z.string().uuid(), confirmCode: CONFIRM },
      annotations: WRITE,
    }, async (args) => this.twoStep(staff, clientId, 'erp_replay_ingest', args,
      async () => {
        const r = await this.db.getRepository(ErpIngestRecord).findOneBy({ id: args.recordId });
        if (!r) throw new Error('ERP record not found');
        return { action: 're-apply ERP record', type: r.entityType, externalId: r.externalId, status: r.status, lastError: r.error,
          note: r.status === 'failed' ? undefined : `status is ${r.status}: nothing will change` };
      },
      async () => {
        const r = await this.ingest.apply(args.recordId);
        return { recordId: r.id, status: r.status, error: r.error };
      }));
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
        `SELECT id, entity_type AS type, external_id AS "externalId", status, error, created_at AS "at" FROM erp_ingest_records
         WHERE created_at >= $1 AND status = 'failed' ORDER BY created_at DESC LIMIT 20`, [since]);
      return json({ since, counts, recentFailures: failures });
    });

    server.registerTool('webhook_failures', {
      title: 'Undelivered events to platforms (admin)',
      description: 'Events commerce could not deliver to subscribed platforms (e.g. josh shop): dead-lettered after retries.',
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
      annotations: READ_ONLY,
    }, async ({ limit }) => json(await this.db.query(
      `SELECT d.id, d.event_type AS "eventType", d.status, d.status_code AS "statusCode", d.attempts, d.error, d.target_url AS "target",
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
