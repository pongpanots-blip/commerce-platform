import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, ILike, IsNull } from 'typeorm';
import { z } from 'zod';
import type { GrowthPlanInput, GrowthTask } from '@cp/growth';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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
import { bangkokRange, JoshInsights, PERIODS } from '../modules/integration/connector/josh/josh-insights';
import { SystemHealthReport } from '../modules/integration/connector/josh/system-health';
import { parseRestaurantFilters, RestaurantPlaces } from '../modules/integration/connector/josh/restaurant-places';
import { JoshErpLogs } from '../modules/integration/connector/josh/josh-erp-logs';
import { JoshPushCampaigns } from '../modules/integration/connector/josh/josh-push-campaigns';
import { JoshProducts, PRODUCT_ISSUES } from '../modules/integration/connector/josh/josh-products';
import { JoshOrders, SYNC_STATES } from '../modules/integration/connector/josh/josh-orders';
import { COMPANY_ISSUES, JoshCustomers } from '../modules/integration/connector/josh/josh-customers';
import { JoshPrices } from '../modules/integration/connector/josh/josh-prices';
import { JagotaShadow } from '../modules/integration/connector/josh/jagota/jagota-shadow';
import { JagotaGateway } from '../modules/integration/connector/josh/jagota/jagota-gateway';
import { JoshPromotions } from '../modules/integration/connector/josh/josh-promotions';
import { JoshActions } from '../modules/integration/connector/josh/josh-actions';
import { joshAdminCall } from '../modules/integration/connector/josh/josh-admin-call.controller';
import { JoshMarketingWorkflows } from '../modules/integration/connector/josh/josh-marketing-workflows';
import { JagotaSyncHistoryImport } from '../modules/integration/connector/josh/jagota/jagota-sync-history';
import { BACKOFFICE_VIEWS, JoshBackoffice } from '../modules/integration/connector/josh/josh-backoffice';
import { JoshApiLogs } from '../modules/integration/connector/josh/josh-api-logs';
import { PriceShadow } from '../modules/integration/connector/josh/pricing/price-shadow';
import { StaffPrices } from '../modules/integration/connector/josh/pricing/staff-prices';
import { wrapWinbackResponse } from '../modules/integration/connector/josh/winback/josh-winback';
import { WinbackReports } from '../modules/integration/winback/winback-reports';
import { GrowthService } from '../modules/integration/growth/growth.service';
import { GrowthDataService } from '../modules/integration/growth/growth-data.service';
import { assertReviewable, planListSchema, planSchema, taskSchema } from '../modules/integration/growth/growth.validation';
import { analysisInput, MarketAnalystService } from './market-analyst.service';

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/** josh admin routes behind marketing_list / marketing_save; `off` = what a new one is created with. */
const MARKETING_KINDS: Record<'workflow' | 'coupon' | 'segment' | 'campaign' | 'product_set' | 'promotion_page', { path: string; update: 'PATCH' | 'PUT'; off?: Record<string, unknown> }> = {
  workflow: { path: '/marketing-workflows', update: 'PATCH' },
  coupon: { path: '/coupon', update: 'PATCH', off: { is_active: false } },
  segment: { path: '/user-segments', update: 'PATCH', off: { is_active: false } },
  campaign: { path: '/campaigns', update: 'PATCH', off: { is_active: false } },
  product_set: { path: '/admin/promotion-product-sets', update: 'PATCH' },
  promotion_page: { path: '/promotion-pages', update: 'PUT', off: { is_active: false } },
};

/** josh lists come as an array, `{ data }`, `{ data: { items } }` or `{ items }`. */
function rowsOf(answer: unknown): Record<string, unknown>[] {
  const a = answer as { data?: unknown; items?: unknown } | null;
  const d = a?.data as { items?: unknown; data?: unknown } | undefined;
  for (const c of [a, d, d?.items, d?.data, a?.items]) if (Array.isArray(c)) return c as Record<string, unknown>[];
  return [];
}
const CONFIRM = z.string().max(100).optional()
  .describe('Leave empty first: you get a preview + confirmCode. Show the preview to the user; only after they explicitly agree, call again with the same arguments and this confirmCode.');
/** Same arguments → same hash, whatever order the client sent them in. */
const argsHash = (args: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(Object.keys(args).sort().map((k) => [k, args[k]]))).digest('hex');
const AREAS = ['กรุงเทพมหานคร', 'กรุงเทพฯ และปริมณฑล', 'ทั่วประเทศไทย'] as const;
const SECTORS = ['ทุกกลุ่ม · น้ำหนักเท่ากัน', 'ร้านอาหาร', 'โรงแรม / จัดเลี้ยง', 'ร้านค้าปลีก', 'โรงงานอาหาร'] as const;
const PERIOD_INPUT = {
  period: z.enum(PERIODS).default('this_month').describe('Bangkok time. this_month = 1st of the month until now; compared with the same length right before it'),
  fromDate: z.string().max(10).optional().describe('custom only: YYYY-MM-DD'),
  toDate: z.string().max(10).optional().describe('custom only: YYYY-MM-DD (inclusive)'),
};
const NO_REPLICA = { available: false, reason: 'Shop data is read from josh\'s read replica, which is not configured on this server (JOSH_DATABASE_URL). Tell the user it is not connected yet.' };
const productName = (p: JoshCatalogProduct) =>
  p.translations?.find((t) => t.language_code === 'th')?.product_name ?? p.translations?.[0]?.product_name ?? p.sku;

/**
 * Tools for AI connectors. Writes require an opted-in scope and confirmation.
 * What a caller sees follows the staff
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
    private readonly insights: JoshInsights,
    private readonly health: SystemHealthReport,
    private readonly restaurants: RestaurantPlaces,
    private readonly erpLogs: JoshErpLogs,
    private readonly winback: WinbackReports,
    private readonly push: JoshPushCampaigns,
    private readonly products: JoshProducts,
    private readonly joshOrders: JoshOrders,
    private readonly joshCustomers: JoshCustomers,
    private readonly joshPrices: JoshPrices,
    private readonly jagotaShadow: JagotaShadow,
    private readonly jagotaGateway: JagotaGateway,
    private readonly backoffice: JoshBackoffice,
    private readonly apiLogs: JoshApiLogs,
    private readonly priceShadow: PriceShadow,
    private readonly staffPrices: StaffPrices,
    private readonly jagotaHistory: JagotaSyncHistoryImport,
    private readonly promotions: JoshPromotions,
    private readonly workflows: JoshMarketingWorkflows,
    private readonly joshActions: JoshActions,
    private readonly growth: GrowthService,
    private readonly growthData: GrowthDataService,
    private readonly analyst: MarketAnalystService,
  ) {}

  /** A fresh server per request (stateless transport) with the tools this staff member may use. */
  server(staff: McpStaff, clientId: string, scopes: string[] = []): McpServer {
    const canWrite = scopes.includes(MCP_WRITE_SCOPE);
    const server = new McpServer(
      { name: 'commerce-platform', version: '1.0.0' },
      { instructions: 'Commerce Platform (Jagota / Josh). Read-only: look up and summarize competitor prices, scraped competitor catalogs, marketing research and the Josh catalog' +
        ', shop traffic' +
        (staff.role === 'admin' ? ', plus shop sales, system health/errors, ERP intake, webhook delivery failures and stock per warehouse.' : '.') +
        (canWrite ? ' A few tools change data; each one first returns a preview and a confirmCode — always show the preview and get the user\'s explicit OK before calling it again with the code.' : ' This connection is read-only.') +
        ' Growth tools connect evidence to a reviewed campaign draft. Market analysis combines the same read-only MCP tools with public web sources; recommendations do not create or activate campaigns.' +
        ' Do not invent prices, costs, profit, social coverage or evidence. Cite source dates and limitations; shop_traffic purchase events are not paid orders and do not prove GA4/GTM tracking coverage.' +
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
    this.growthReads(server, staff);
    if (staff.role === 'admin') this.ops(server);
    if (canWrite) this.writes(server, staff, clientId);
    return server;
  }

  /** The in-app analyst reads through the same audited MCP tools, without any write scope. */
  async openReadClient(staff: McpStaff): Promise<{ client: Client; close(): Promise<void> }> {
    const server = this.server(staff, 'in-app-marketing-analyst', []);
    const client = new Client({ name: 'in-app-marketing-analyst', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const close = async () => { await Promise.all([client.close(), server.close()]); };
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      return { client, close };
    } catch (error) {
      await Promise.allSettled([client.close(), server.close()]);
      throw error;
    }
  }

  private growthReads(server: McpServer, staff: McpStaff) {
    server.registerTool('growth_workspace', {
      title: 'Growth opportunities and evidence (marketing)',
      description: 'Read paid-order metrics, idle carts, reorder opportunities, source evidence with collection dates, availability and activation blockers. Missing costs or connections remain unknown; never replace them with guessed profit, price or coverage.',
      inputSchema: {}, annotations: READ_ONLY,
    }, async () => json({ ...(await this.growthData.workspace()), readiness: this.growth.readiness(), analysisReadiness: this.analyst.readiness() }));

    server.registerTool('growth_plans', {
      title: 'Growth campaign plans and review history (marketing)',
      description: 'Read one campaign plan by id, including version, full content, evidence, tasks, review/export status and canManage, or a paginated list. Reading a plan grants no edit permission. Dates use Bangkok time for month filters.',
      inputSchema: planListSchema.extend({ id: z.string().uuid().optional() }), annotations: READ_ONLY,
    }, async ({ id, ...filters }) => json(id ? await this.growth.detail(id, staff) : await this.growth.list(staff, filters)));

    server.registerTool('growth_results', {
      title: 'Growth workflow results and measurement limits (marketing)',
      description: 'Read a workflow funnel, attributed paid revenue, holdout comparison, failed operations and missing costs. Attribution is not proven incremental revenue; event counts and enrollment cohorts can cover different periods. Contribution remains unknown until actual costs exist.',
      inputSchema: { workflowId: z.string().uuid() }, annotations: READ_ONLY,
    }, async ({ workflowId }) => json(await this.growthData.results(workflowId, staff)));

    server.registerTool('market_analysis_reports', {
      title: 'Saved market analysis and source evidence (marketing)',
      description: 'List your saved market analyses, or read one report by id; admin can inspect another user\'s report by explicit id. Includes source dates, actual MCP tool trace, cited public-web evidence, hypotheses, recommendations and coverage limitations. Recommendations are not campaign drafts.',
      inputSchema: { id: z.string().uuid().optional() }, annotations: READ_ONLY,
    }, async ({ id }) => json(id ? await this.analyst.detail(id, staff) : await this.analyst.list(staff)));

    if (staff.role === 'admin') server.registerTool('growth_timeline', {
      title: 'Customer-company Growth timeline (admin)',
      description: 'Read the latest 100 order, contact-metadata and workflow events in 90 days for one company. Contacts exclude personal names and message text; company membership and replica freshness have stated limitations.',
      inputSchema: { companyId: z.string().uuid() }, annotations: READ_ONLY,
    }, async ({ companyId }) => json(await this.growthData.timeline(companyId, staff)));
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
    server.registerTool('segment_preview', {
      title: 'Preview who is in a customer segment (marketing)',
      description: 'Ask josh how many customers a segment rule matches (a count — no customer details), before saving it with marketing_save kind=segment. `rule` uses josh\'s user-segment fields (rule_type, rule_config / definition — copy the shape of an existing segment from marketing_list kind=segment). Nothing is saved.',
      inputSchema: { rule: z.record(z.string(), z.unknown()) },
      annotations: READ_ONLY,
    }, async ({ rule }) => json(await joshAdminCall(this.joshActions, { userId: staff.userId, email: staff.email, role: staff.role }, { method: 'POST', path: '/user-segments/preview', body: rule }, 'mcp')));

    server.registerTool('marketing_list', {
      title: 'Marketing setup on josh: coupons, segments, campaigns, product sets, promotion pages (marketing)',
      description: 'Lists what marketing has set up in josh, as josh returns it (josh field names): coupons, user segments, campaigns, product sets (the SKU groups promotions use) and promotion landing pages. Use the ids with marketing_save to change one. Promotions → josh_promotions; workflows → marketing_workflows.',
      inputSchema: { kind: z.enum(['coupon', 'segment', 'campaign', 'product_set', 'promotion_page']), search: z.string().max(100).optional() },
      annotations: READ_ONLY,
    }, async ({ kind, search }) => {
      const answer = await joshAdminCall(this.joshActions, { userId: staff.userId, email: staff.email, role: staff.role }, { method: 'GET', path: MARKETING_KINDS[kind].path, query: kind === 'coupon' ? { limit: 200 } : undefined }, 'mcp');
      const rows = rowsOf(answer).filter((r) => !search || JSON.stringify(r).toLowerCase().includes(search.toLowerCase()));
      return json({ kind, count: rows.length, items: rows.slice(0, 100) });
    });

    server.registerTool('marketing_workflows', {
      title: 'Marketing automations on josh (marketing)',
      description: 'josh marketing workflows (trigger → steps → LINE / push / email): status (draft / active / paused), trigger, schedule, and for the last `days` how many customers were enrolled, still running, failed, converted and held out, plus the last scheduled run. Pass id for one workflow with its steps, enrollments by status, recent runs and failed sends. Read-only; changes happen in commerce-admin › Marketing workflows.',
      inputSchema: { id: z.string().uuid().optional(), days: z.number().int().min(1).max(365).default(30) },
      annotations: READ_ONLY,
    }, async ({ id, days }) => {
      if (!this.workflows.available) return json(NO_REPLICA);
      return json(id ? await this.workflows.detail(id) : await this.workflows.list(days));
    });

    server.registerTool('josh_promotions', {
      title: 'Promotions on the josh shop (marketing)',
      description: 'josh promotion mechanics: name, badge, window, state (running / scheduled / ended / sold_out / off), units sold vs cap, audience, SKU count; pass id for one promotion with its SKUs. shadow = how often commerce, re-pricing josh order lines, picked the same promotion josh did (must be ~100% before commerce owns promotions). Read-only; changes happen in commerce-admin › โปรโมชัน.',
      inputSchema: {
        id: z.string().uuid().optional(),
        state: z.enum(['running', 'scheduled', 'ended', 'sold_out', 'off']).optional(),
        search: z.string().max(100).optional(),
      },
      annotations: READ_ONLY,
    }, async ({ id, state, search }) => {
      if (!this.promotions.available) return json(NO_REPLICA);
      if (id) return json(await this.promotions.detail(id));
      const [items, shadow] = await Promise.all([this.promotions.list({ state, search }), this.promotions.shadow(7)]);
      return json({ shadow, count: items.length, items: items.slice(0, 100) });
    });

    server.registerTool('shop_traffic', {
      title: 'Shop traffic (josh)',
      description: 'Visits (sessions), visitors, product views, searches, add-to-cart, checkout and purchase event counts on the josh shop for a period, by platform and by day, the funnel, and top searches (including zero results). Reads Josh analytics_events / analytics_funnel_daily and search aggregates; purchase events are not verified paid orders. These aggregates do not prove GA4/GTM installation, consent, tag coverage or attribution. Compared with the previous period of the same length.',
      inputSchema: PERIOD_INPUT,
      annotations: READ_ONLY,
    }, async ({ period, fromDate, toDate }) => {
      if (!this.insights.available) return json(NO_REPLICA);
      return json(await this.insights.traffic(bangkokRange(period, Date.now(), fromDate, toDate)));
    });

    server.registerTool('restaurant_places', {
      title: 'Restaurants (Market Explorer)',
      description: 'Restaurant master data in Thailand for prospecting: filter to get counts, top categories/districts and one page of places. Pass an id from the list for full detail, opening hours, service options, popular times, source and enrichment date. Ratings/reviews are public place data; estimatedTables is a rough review-volume heuristic, not verified seating capacity. Busy windows use today in Bangkok; unknown busy data does not match. Read-only, same data as commerce-admin › Market Explorer.',
      inputSchema: {
        id: z.string().uuid().optional().describe('restaurant place id from the list → full detail; other filters are ignored'),
        search: z.string().max(100).optional().describe('part of the Thai or English name'),
        district: z.string().max(100).optional().describe('exact district name as stored, e.g. วัฒนา'),
        category: z.string().max(100).optional().describe('part of the category, e.g. Japanese, ญี่ปุ่น, cafe'),
        minRating: z.number().min(0).max(5).optional(),
        maxRating: z.number().min(0).max(5).optional(),
        minReviewCount: z.number().int().min(0).max(1e9).optional(),
        maxReviewCount: z.number().int().min(0).max(1e9).optional(),
        priceRange: z.string().max(20).optional(),
        isEnriched: z.boolean().optional().describe('true = enriched places; false = places awaiting enrichment'),
        dineIn: z.boolean().optional().describe('true = requires dine-in service'),
        takeaway: z.boolean().optional().describe('true = requires takeaway service'),
        delivery: z.boolean().optional().describe('true = requires delivery service'),
        busyWindow: z.string().regex(/^\d{1,2}-\d{1,2}$/).optional().describe('"17-20" = busy (>60%) at some hour 17:00-20:00 today'),
        excludeHasTmpLead: z.boolean().optional().describe('true = only places sales has not linked to an account yet'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_ONLY,
    }, async ({ id, page, limit, ...filters }) => {
      if (!this.restaurants.available) return json(NO_REPLICA);
      if (id) {
        const place = await this.restaurants.detail(id);
        return place ? json(place) : { ...json({ error: 'restaurant_not_found', id }), isError: true };
      }
      return json(await this.restaurants.list(parseRestaurantFilters(filters), page, limit));
    });

    server.registerTool('push_campaigns', {
      title: 'Push campaigns (josh)',
      description: 'Marketing push / in-app campaigns sent from josh: KPIs and the latest campaigns (status, audience, sent/skipped/failed). Pass id for one campaign with its real delivery results per channel (push, in-app, email), clicks, by day and the top skip/fail reasons. Read-only — creating and sending stay in josh.',
      inputSchema: {
        id: z.string().uuid().optional().describe('one campaign → delivery results'),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_ONLY,
    }, async ({ id, limit }) => {
      if (!this.push.available) return json(NO_REPLICA);
      if (id) return json(await this.push.delivery(id));
      const [overview, rows] = await Promise.all([this.push.overview(), this.push.list()]);
      return json({ overview, campaigns: rows.slice(0, limit).map((r) => ({ id: r.id, name: r.name, status: r.status, title: r.title,
        audience: r.audience, ab_enabled: r.ab_enabled, scheduled_at: r.scheduled_at, sent_at: r.sent_at, stats: r.stats, last_error: r.last_error })) });
    });

    server.registerTool('josh_products', {
      title: 'Shop products (josh catalog)',
      description: 'The josh shop catalog, read-only: counts of products waiting for ERP change approval, without image, without category, without price, out of / low on stock; a filtered list; or one product (sku or id) with images and each pending ERP change next to the live value.',
      inputSchema: {
        sku: z.string().max(100).optional().describe('one product (SKU or id) → full detail'),
        issue: z.enum(Object.keys(PRODUCT_ISSUES) as [keyof typeof PRODUCT_ISSUES]).optional(),
        search: z.string().max(100).optional().describe('SKU or name'),
        status: z.string().max(20).optional().describe('active, draft, inactive …'),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: READ_ONLY,
    }, async ({ sku, issue, search, status, limit }) => {
      if (!this.products.available) return json(NO_REPLICA);
      if (sku) return json(await this.products.detail(sku));
      const [summary, list] = await Promise.all([this.products.summary(), this.products.list({ issue, search, status }, 1, limit)]);
      return json({ summary, total: list.total, products: list.items });
    });

    server.registerTool('competitor_prices', {
      title: 'Competitor price comparison',
      description: 'Compare our SKU with multiple competitors in THB/kg including VAT. Use view=matrix for one row per SKU with every retailer offer, context and observation time; filters/search select SKUs and retain all their offers. Missing/unverified/stale prices are not comparable; distinct member/promotion contexts do not establish a universal cheapest retailer. view=pairs preserves the individual-pair list. differencePerKg > 0 means we are cheaper. Matrix limit/page count SKU rows, never split a SKU across pages.',
      inputSchema: {
        view: z.enum(['pairs', 'matrix']).default('pairs'),
        page: z.number().int().min(1).max(1000).default(1),
        filter: z.enum(['all', 'ready', 'we_are_cheaper', 'we_are_more_expensive', 'needs_review']).default('all')
          .describe('ready = comparable now; needs_review = match not verified yet'),
        search: z.string().max(100).optional().describe('SKU, product name or competitor name'),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: READ_ONLY,
    }, async ({ view, page, filter, search, limit }) => {
      const q = search?.toLowerCase();
      const all = await this.competitor.list();
      const rows = all.filter((r) => {
        const gap = r.differencePerKgIncVat ?? 0;
        const keep = filter === 'all' || (filter === 'ready' && r.comparisonReady) || (filter === 'needs_review' && !r.verified)
          || (filter === 'we_are_cheaper' && r.comparisonReady && gap > 0) || (filter === 'we_are_more_expensive' && r.comparisonReady && gap < 0);
        return keep && (!q || `${r.ourProduct.sku} ${r.ourProduct.name} ${r.competitorName} ${r.sourceName}`.toLowerCase().includes(q));
      });
      const pair = (r: typeof all[number]) => ({
        pairId: r.id, sku: r.ourProduct.sku, product: r.ourProduct.name, competitor: r.sourceName, competitorProduct: r.competitorName, url: r.sourceUrl,
        ourPerKg: r.ourPricePerKgIncVat, theirPerKg: r.competitorPricePerKgIncVat, differencePerKg: r.differencePerKgIncVat,
        differencePercent: r.differencePercent, comparable: r.comparisonReady, why: r.comparisonReason, observedAt: r.observedAt,
        context: r.sourceContext, ourWeightKg: r.ourWeightKg, competitorWeightKg: r.competitorWeightKg,
      });
      if (view === 'matrix') {
        const sourceKey = (url: string) => new URL(url).hostname.replace(/^www\./, '');
        const shops = [...new Map(all.map(r => [sourceKey(r.sourceUrl), { key: sourceKey(r.sourceUrl), name: r.sourceName }])).values()];
        const wanted = new Set(rows.map(r => r.ourProduct.sku));
        const grouped = new Map<string, typeof all>();
        for (const r of all) if (wanted.has(r.ourProduct.sku)) {
          const offers = grouped.get(r.ourProduct.sku) ?? [];
          offers.push(r); grouped.set(r.ourProduct.sku, offers);
        }
        const products = [...grouped.values()].slice((page - 1) * limit, page * limit).map(offers => {
          const rates = new Set(offers.map(r => r.ourPricePerKgIncVat));
          const ourPerKg = rates.size === 1 ? offers[0].ourPricePerKgIncVat : null;
          const ourPriceReason = rates.size > 1 ? 'ราคาต่อกิโลของเราต่างกันระหว่างคู่สินค้า ต้องตรวจน้ำหนักก่อนเทียบ' : ourPerKg == null ? 'ยังยืนยันราคาต่อกิโลของเราไม่ได้' : null;
          return { sku: offers[0].ourProduct.sku, product: offers[0].ourProduct.name, ourPerKg, ourPriceReason,
            competitors: shops.map(shop => ({ ...shop, offers: offers.filter(r => sourceKey(r.sourceUrl) === shop.key).map(r => ({ ...pair(r),
              ...(ourPriceReason ? { comparable: false, differencePerKg: null, differencePercent: null, why: ourPriceReason } : {}) })) })) };
        });
        return json({ total: grouped.size, totalPairs: [...grouped.values()].reduce((n, members) => n + members.length, 0), page, pageSize: limit, shops, products,
          note: 'Latest stored observations, not price history; missing cells mean no tracked offer. Compare pack/grade/VAT/eligibility and source dates before acting.' });
      }
      return json({
        total: rows.length,
        pairs: rows.slice(0, limit).map(pair),
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
    const joshActor = { userId: staff.userId, email: staff.email, role: staff.role };
    this.growthWrites(server, staff, clientId);

    server.registerTool('marketing_save', {
      title: 'Create or edit marketing setup on josh — always switched off (needs confirmation)',
      description: 'Create (no id) or edit (with id) a marketing workflow, promotion, coupon, segment, campaign, product set, promotion page or push campaign draft. `data` uses josh\'s own field names and rules (josh validates and answers with its reason if something is wrong) — read an existing one first (marketing_workflows, josh_promotions, marketing_list) and copy its shape. Anything new is created switched off / as a draft; this tool never switches anything on, activates a workflow or sends a push — a person does that in commerce-admin after checking it.',
      inputSchema: {
        kind: z.enum(['workflow', 'promotion', 'coupon', 'segment', 'campaign', 'product_set', 'promotion_page', 'push_campaign']),
        id: z.string().uuid().optional().describe('edit this one; omit to create'),
        data: z.record(z.string(), z.unknown()).describe('josh fields to set'),
        confirmCode: CONFIRM,
      },
      annotations: WRITE,
    }, async (args) => {
      const { kind, id, data } = args;
      const switchesOn = Object.entries(data).find(([k, v]) => (['is_active', 'active'].includes(k) && v === true) || (k === 'status' && v === 'active'));
      if (switchesOn) return { ...json({ status: 'rejected', reason: `${switchesOn[0]}=${String(switchesOn[1])}: switching on / activating is done by a person in commerce-admin, not from MCP.` }), isError: true };
      if (kind === 'push_campaign' && id) return { ...json({ status: 'rejected', reason: 'push campaigns: MCP creates drafts only; edit / schedule / send in commerce-admin.' }), isError: true };
      const def = kind === 'promotion' || kind === 'push_campaign' ? null : MARKETING_KINDS[kind];
      const body = !id && def?.off ? { ...data, ...def.off } : data;
      return this.twoStep(staff, clientId, 'marketing_save', args,
        async () => ({ action: `${id ? 'edit' : 'create (switched off)'} ${kind}${id ? ` ${id}` : ''} in josh`, data: body, note: 'josh checks the data when it is saved; switching on stays in commerce-admin' }),
        async () => {
          if (kind === 'promotion') return this.joshActions.run('promotions', id ? 'update' : 'create', id ? { id, changes: body } : { mechanic: { ...body, is_active: false } }, joshActor, 'mcp');
          if (kind === 'push_campaign') return this.joshActions.run('push-campaigns', 'create', { campaign: body }, joshActor, 'mcp');
          return joshAdminCall(this.joshActions, joshActor, { method: id ? def!.update : 'POST', path: id ? `${def!.path}/${id}` : def!.path, body }, 'mcp');
        });
    });

    server.registerTool('marketing_workflow_pause', {
      title: 'Pause a marketing workflow (needs confirmation)',
      description: 'Stop a josh marketing workflow from enrolling and messaging customers (customers already in it get no further steps until it is switched on again in commerce-admin).',
      inputSchema: { id: z.string().uuid(), confirmCode: CONFIRM },
      annotations: WRITE,
    }, async (args) => this.twoStep(staff, clientId, 'marketing_workflow_pause', args,
      async () => ({ action: 'pause marketing workflow', workflow: await this.workflows.detail(args.id).then((w) => { const r = w as Record<string, unknown>; return { id: r.id, name: r.name, status: r.status }; }).catch(() => ({ id: args.id })) }),
      () => this.joshActions.run('marketing-workflows', 'pause', { id: args.id }, joshActor, 'mcp')));


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

  private growthWrites(server: McpServer, staff: McpStaff, clientId: string) {
    const current = async (id: string, version: number, reconcile = false) => {
      const plan = await this.growth.detail(id, staff);
      if (!plan.canManage) throw new ForbiddenException('Only the plan creator or admin may change this plan');
      if (plan.version !== version) throw new ConflictException('Plan changed; read its latest version before continuing');
      const uncertain = ['exporting', 'export_unknown'].includes(plan.status);
      if (uncertain !== reconcile) throw new ConflictException(uncertain ? 'Reconcile the previous export before changing or exporting again' : 'Plan has no export outcome to reconcile');
      return plan;
    };

    server.registerTool('growth_plan_save', {
      title: 'Create or revise a Growth campaign draft (needs confirmation)',
      description: 'Save a typed campaign plan with evidence citations, audience, variants, budget and guardrails. id without version creates an idempotent draft (id is the requestId); supply the latest version to revise a plan you own or an admin manages. Revision resets approval. This never sends messages or activates a workflow.',
      inputSchema: { id: z.string().uuid(), version: z.number().int().positive().optional(), plan: planSchema, confirmCode: CONFIRM },
      annotations: WRITE,
    }, async (args) => this.twoStep(staff, clientId, 'growth_plan_save', args,
      async () => ({ action: args.version === undefined ? 'create Growth draft' : 'revise Growth draft and reset approval', id: args.id,
        before: args.version === undefined ? null : await current(args.id, args.version), after: args.plan,
        note: 'Saved as draft; no messages sent or workflow activated' }),
      () => args.version === undefined ? this.growth.create(args.id, args.plan as GrowthPlanInput, staff) : this.growth.update(args.id, args.version, args.plan as GrowthPlanInput, staff)));

    server.registerTool('growth_plan_tasks', {
      title: 'Replace Growth plan tasks (needs confirmation)',
      description: 'Replace the complete task list of a plan you own or an admin manages, using its latest version. Task edits advance the version but preserve the approved campaign content. Preview includes the complete current plan and replacement tasks.',
      inputSchema: { id: z.string().uuid(), update: taskSchema, confirmCode: CONFIRM }, annotations: WRITE,
    }, async (args) => this.twoStep(staff, clientId, 'growth_plan_tasks', args,
      async () => ({ action: 'replace Growth tasks', plan: await current(args.id, args.update.version), tasksAfter: args.update.tasks }),
      () => this.growth.tasks(args.id, args.update.version, args.update.tasks as GrowthTask[], staff)));

    server.registerTool('growth_plan_action', {
      title: 'Review or export a Growth campaign draft (needs confirmation)',
      description: 'submit sends a complete draft for review; approve is admin-only; export creates a stopped Josh workflow draft from approved content. reconcile is admin-only and links a verified draft/paused workflow after an uncertain export (workflowId required only for reconcile). Every preview includes the complete saved plan, evidence and current version. Never activates or sends.',
      inputSchema: {
        id: z.string().uuid(), version: z.number().int().positive(),
        action: z.enum(staff.role === 'admin' ? ['submit', 'approve', 'export', 'reconcile'] : ['submit', 'export']),
        workflowId: z.string().uuid().optional(), confirmCode: CONFIRM,
      }, annotations: WRITE,
    }, async (args) => {
      if (['approve', 'reconcile'].includes(args.action) && staff.role !== 'admin') throw new ForbiddenException('admin only');
      if ((args.action === 'reconcile') !== !!args.workflowId) throw new BadRequestException('workflowId is required only for reconcile');
      return this.twoStep(staff, clientId, 'growth_plan_action', args,
        async () => {
          const plan = await current(args.id, args.version, args.action === 'reconcile');
          const expected = { submit: 'draft', approve: 'review', export: 'approved', reconcile: null }[args.action];
          if (expected && plan.status !== expected) throw new ConflictException(`Plan must be ${expected}`);
          if (args.action !== 'reconcile') assertReviewable(plan);
          if (args.action === 'export' && (!plan.approvedBy || !plan.approvedVersion)) throw new ConflictException('Approve this campaign content before exporting');
          return { action: args.action, plan, workflowId: args.workflowId, readiness: this.growth.readiness(),
            note: args.action === 'export' ? 'Creates a stopped workflow draft; unknown export outcomes must be reconciled before retrying' : 'No messages sent or workflow activated' };
        }, () => args.action === 'submit' || args.action === 'approve'
          ? this.growth.review(args.id, args.version, args.action === 'approve', staff)
          : args.action === 'export' ? this.growth.export(args.id, args.version, staff)
            : this.growth.reconcile(args.id, args.version, args.workflowId!, staff));
    });

    server.registerTool('market_analyse', {
      title: 'Analyse a market question using MCP and public web evidence (needs confirmation)',
      description: 'After confirmation, use the same role-scoped read-only MCP context (including shop_traffic) plus public web search to save a cited market analysis with recommendations. Keep prices, costs, social coverage and tracking coverage unknown unless evidenced. This saves a report, never creates a campaign draft, sends messages or activates workflows; use growth_plan_save explicitly after reviewing recommendations.',
      inputSchema: analysisInput.extend({ requestId: z.string().uuid(), area: analysisInput.shape.area.default('กรุงเทพมหานคร'),
        days: analysisInput.shape.days.default(30), confirmCode: CONFIRM }), annotations: { ...WRITE, openWorldHint: true },
    }, async (args) => this.twoStep(staff, clientId, 'market_analyse', args,
      async () => ({ action: 'save market analysis with recommendations', requestId: args.requestId, question: args.question, area: args.area, days: args.days,
        readiness: this.analyst.readiness(), note: 'Reads through your read-only MCP tools and public web; no campaign draft or live send' }),
      () => this.analyst.generate(args.requestId, { question: args.question, area: args.area, days: args.days }, staff, () => this.openReadClient(staff))));
  }

  private ops(server: McpServer) {
    server.registerTool('price_shadow', {
      title: 'Prices: commerce re-prices josh orders (trial, admin)',
      description: "Shadow mode before commerce owns product prices: each new josh order line is re-priced with josh's own price resolver (copied into commerce, run on josh's replica) for the same company, branch, quantity and order time, and compared with what josh charged (unit price inc. VAT, price source, promotion mechanic). Match rate, mismatches by source, latest mismatches; `changed_after` = price data edited after the order (not a bug). Read-only.",
      inputSchema: { days: z.number().int().min(1).max(90).default(7) },
      annotations: READ_ONLY,
    }, async ({ days }) => {
      const [summary, mismatches] = await Promise.all([this.priceShadow.summary(days), this.priceShadow.list('mismatched', 1, 20)]);
      return json({ summary, latestMismatches: mismatches.items });
    });

    server.registerTool('staff_prices', {
      title: 'Customer and contract prices owned by commerce (admin)',
      description: "Customer prices (one per company + product) and branch contract prices that commerce owns and writes to josh through josh's own services. Counts by status (synced = josh charges it, pending, failed = josh refused / unreachable, with josh's reason) and a filtered list. Read-only; edits happen in commerce-admin › ราคาลูกค้า / ราคาสัญญา.",
      inputSchema: {
        kind: z.enum(['customer', 'contract']).default('customer'),
        scopeId: z.string().uuid().optional().describe('company id (customer) or branch id (contract)'),
        sku: z.string().max(100).optional(), status: z.enum(['synced', 'pending', 'failed']).optional(),
        page: z.number().int().min(1).default(1),
      },
      annotations: READ_ONLY,
    }, async ({ kind, scopeId, sku, status, page }) => {
      const [summary, list] = await Promise.all([this.staffPrices.summary(), this.staffPrices.list({ kind, scopeId, search: sku, status }, page, 50)]);
      return json({ summary: summary.rows, total: list.total, items: list.items });
    });

    server.registerTool('josh_backoffice', {
      title: 'josh back-office lists (admin)',
      description: `josh staff lists, read-only from josh's replica, with counts by status: ${Object.entries(BACKOFFICE_VIEWS).map(([k, v]) => `${k} (${v.title})`).join(', ')}. Column names are josh's. Phones, emails and people's names are masked; files, card data and password hashes are never read.`,
      inputSchema: {
        list: z.enum(Object.keys(BACKOFFICE_VIEWS) as [string, ...string[]]),
        search: z.string().max(100).optional().describe('company, order / shipment / CN number, coupon code, name…'),
        status: z.string().max(40).optional().describe('one of the statuses in byStatus'),
        page: z.number().int().min(1).default(1),
      },
      annotations: READ_ONLY,
    }, async ({ list, search, status, page }) => {
      if (!this.backoffice.available) return json(NO_REPLICA);
      const r = await this.backoffice.list(list, { search, status }, page);
      return json({ list: r.key, title: r.title, byStatus: r.byStatus, total: r.total, page: r.page, items: r.items });
    });

    server.registerTool('josh_api_logs', {
      title: 'josh API log (admin)',
      description: "josh's general API log from its Mongo (josh's own query code): calls josh served and calls it made to Jagota / KBank, ERP inbound excluded (see josh_erp_logs). Without `id`: stats (traffic, errors, slowest routes) plus the matching rows for a window (default last 24h, max 7 days). With `id`: one call with payload, response and timing steps.",
      inputSchema: {
        id: z.string().max(40).optional(),
        status: z.enum(['all', '2xx', '4xx', '5xx']).optional(), source: z.enum(['all', 'internal', 'jagota', 'kbank', 'erp_webhook']).optional(),
        method: z.enum(['all', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(), q: z.string().max(100).optional().describe('text in the message / URL'),
        from: z.string().max(40).optional(), to: z.string().max(40).optional(), minDurationMs: z.number().int().min(0).optional(),
        sort: z.enum(['newest', 'slowest']).optional(), limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: READ_ONLY,
    }, async ({ id, ...q }) => {
      if (!this.apiLogs.available) return json({ available: false, reason: "josh's log Mongo is not connected on this server (JOSH_MONGO_URL)." });
      if (id) return json(await this.apiLogs.detail(id));
      const [stats, list] = await Promise.all([this.apiLogs.stats(q), this.apiLogs.list(q)]);
      return json({ stats, total: list.total, items: list.items });
    });

    server.registerTool('josh_orders', {
      title: 'Shop orders (josh, admin)',
      description: 'josh orders, read-only: counts by status, awaiting payment, and whether paid orders reached Jagota (ERP): failed, not sent, pending, sent. A filtered list, or one order (order number or id) with items, shipments, every Jagota send attempt and payments. Customer contact data is masked.',
      inputSchema: {
        order: z.string().max(64).optional().describe('order number or id → full detail'),
        sync: z.enum(Object.keys(SYNC_STATES) as [keyof typeof SYNC_STATES]).optional().describe('Jagota state'),
        payment: z.enum(['missing']).optional().describe('missing = paid / delivered status but no successful payment (not counted as sales)'),
        status: z.string().max(30).optional(), search: z.string().max(100).optional().describe('order number, customer code, PO or company'),
        from: z.string().max(40).optional(), to: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: READ_ONLY,
    }, async ({ order, limit, ...f }) => {
      if (!this.joshOrders.available) return json(NO_REPLICA);
      if (order) return json(await this.joshOrders.detail(order));
      const [summary, list] = await Promise.all([this.joshOrders.summary(f), this.joshOrders.list(f, 1, limit)]);
      return json({ summary, total: list.total, orders: list.items });
    });

    server.registerTool('josh_customers', {
      title: 'Shop customers / companies (josh, admin)',
      description: 'josh business customers, read-only: companies with credit limit / used / term, branches, users, KYC status (none, pending, approved, rejected) and credit-term applications. Filter by issue (KYC pending, over or near credit limit, no ERP code …). Pass companyId for one company. Identity numbers, phones, emails and family names are masked.',
      inputSchema: {
        companyId: z.string().uuid().optional(),
        issue: z.enum(Object.keys(COMPANY_ISSUES) as [keyof typeof COMPANY_ISSUES]).optional(),
        search: z.string().max(100).optional().describe('company name or ERP customer code'),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: READ_ONLY,
    }, async ({ companyId, issue, search, limit }) => {
      if (!this.joshCustomers.available) return json(NO_REPLICA);
      if (companyId) return json(await this.joshCustomers.detail(companyId));
      const [summary, list] = await Promise.all([this.joshCustomers.summary(), this.joshCustomers.list({ issue, search }, 1, limit)]);
      return json({ summary, total: list.total, companies: list.items });
    });

    server.registerTool('josh_prices', {
      title: 'Prices a customer branch sees (josh, admin)',
      description: 'What a josh customer branch pays per unit today, layer by layer in josh\'s order (company private price → branch contract → branch special → promotion → qty tiers → base) and which one wins; or the ERP quotations for a customer code. Without branchId: search branches by company / branch / ERP code.',
      inputSchema: {
        branchId: z.string().uuid().optional(), search: z.string().max(100).optional().describe('with branchId: SKU or product name; without: company / branch / ERP code'),
        customerCode: z.string().max(50).optional().describe('ERP quotations for this customer code'),
      },
      annotations: READ_ONLY,
    }, async ({ branchId, search, customerCode }) => {
      if (!this.joshPrices.available) return json(NO_REPLICA);
      if (customerCode) return json(await this.joshPrices.quotations(customerCode));
      if (branchId) return json(await this.joshPrices.forBranch(branchId, search));
      return json(await this.joshPrices.branches(search));
    });

    server.registerTool('jagota_shadow', {
      title: 'Orders → Jagota through commerce: trial results (admin)',
      description: 'Orders reaching Jagota through commerce. Step 1 (shadow): josh keeps sending; commerce rebuilds each request and compares field by field — match rate, fields that differ most, latest mismatches. Step 2 (live, branches josh routes via JAGOTA_VIA_COMMERCE_BRANCHES): what commerce actually sent — sent / failed / retried counts and the latest failures. Step 3 (history): the josh ERP send history (jagota_order_sync) copied into commerce — totals by sync status and the latest failed sends; pass orderNumber to see every send of one order. Read-only.',
      inputSchema: { days: z.number().int().min(1).max(90).default(7), orderNumber: z.string().max(64).optional().describe('josh order number or ERP doc no. — history of that order only') },
      annotations: READ_ONLY,
    }, async ({ days, orderNumber }) => {
      if (orderNumber) return json({ history: await this.jagotaHistory.list({ q: orderNumber, limit: 50 }) });
      const [summary, mismatches, live, liveFailures, history, historyFailures] = await Promise.all([this.jagotaShadow.summary(days), this.jagotaShadow.list('mismatched', 1, 20),
        this.jagotaGateway.summary(days), this.jagotaGateway.list('failed', 1, 20), this.jagotaHistory.summary(days), this.jagotaHistory.list({ status: 'failed', limit: 20 })]);
      return json({ shadow: { summary, latestMismatches: mismatches.items }, live: { summary: live, latestFailures: liveFailures.items },
        history: { summary: history, latestFailed: historyFailures.items } });
    });

    server.registerTool('shop_sales', {
      title: 'Shop sales (josh, admin)',
      description: 'Sales of the josh shop for a period: paid orders, revenue (THB incl. VAT, after discounts), average order, buying customers/companies, new customers, awaiting payment / cancelled / refunded, revenue by day (or month), top products, and the change vs the previous period.',
      inputSchema: PERIOD_INPUT,
      annotations: READ_ONLY,
    }, async ({ period, fromDate, toDate }) => {
      if (!this.insights.available) return json(NO_REPLICA);
      return json(await this.insights.sales(bangkokRange(period, Date.now(), fromDate, toDate)));
    });

    const RANGE = {
      from: z.string().max(40).optional().describe('ISO date or date-time; default: this month (josh dashboard default)'),
      to: z.string().max(40).optional().describe('ISO date or date-time'),
    };
    const iso = (v?: string) => { if (v && Number.isNaN(Date.parse(v))) throw new Error(`not a date: ${v}`); return v; };
    const winbackTool = <A>(fn: (a: A) => Promise<unknown>) => async (a: A) =>
      json(this.winback.available ? wrapWinbackResponse(await fn(a)) : NO_REPLICA);

    server.registerTool('winback_overview', {
      title: 'Win-back pipeline overview (admin)',
      description: 'Sales win-back CRM (josh winback): how many lapsed/at-risk customers and leads by health (dormant/watch/active_again), stage, source and lifecycle (tmp/lead), unassigned, restaurant places not yet leads, by province, and monthly revenue at risk / recoverable.',
      inputSchema: {}, annotations: READ_ONLY,
    }, winbackTool(() => this.winback.overview()));

    server.registerTool('winback_performance', {
      title: 'Win-back sales performance (admin)',
      description: 'Sales team results for a period: funnel and stage conversion, reactivation (won) rate, days to first contact / first order, activities by type and outcome, reject reasons, TMP→lead; GMV vs monthly target, AOV, customer segments and per-rep figures; per-rep lead/visit/call counts.',
      inputSchema: RANGE, annotations: READ_ONLY,
    }, winbackTool(async ({ from, to }: { from?: string; to?: string }) => {
      const [scorecard, dashboard, team] = await Promise.all([
        this.winback.scorecard(iso(from), iso(to)), this.winback.dashboard(iso(from), iso(to)), this.winback.teamStats(iso(from), iso(to)),
      ]);
      return { scorecard, dashboard, teamStats: team };
    }));

    server.registerTool('winback_follow_up', {
      title: 'Win-back leads needing attention (admin)',
      description: 'Leads nobody has worked for N days (aging) and per-lead facts for a sales meeting: stage, how long in stage, last activity and note, appointments that passed without being logged, plus median days per stage (team and per rep).',
      inputSchema: {
        days: z.number().int().min(0).max(365).default(3).describe('aging: no activity for at least this many days'),
        salesUserId: z.string().uuid().optional().describe('only this rep\'s leads'),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: READ_ONLY,
    }, winbackTool(async ({ days, salesUserId, limit }: { days: number; salesUserId?: string; limit: number }) => {
      const [aging, signals] = await Promise.all([this.winback.aging(days), this.winback.leadSignals(salesUserId, limit)]);
      return { aging, leadSignals: signals };
    }));

    server.registerTool('josh_erp_logs', {
      title: 'ERP calls received by josh (admin)',
      description: 'What the ERP sent to josh (josh /api/erp/*) and whether josh accepted it: list by endpoint (e.g. products/qty, orders/status), ok/fail, time window (max 7 days, default last 24h; josh keeps 14 days), free-text search on codes (PRODUCT_CODE, ORDER_NO, CUST_CODE...). Pass id to get one call with its request/response payload.',
      inputSchema: {
        id: z.string().max(40).optional().describe('one log id from a previous list → full payload'),
        endpoint: z.string().max(100).optional().describe('e.g. products/qty, products/price, orders/status, customers'),
        status: z.enum(['ok', 'fail', 'all']).default('all'),
        from: z.string().max(40).optional().describe('ISO date-time'),
        to: z.string().max(40).optional().describe('ISO date-time'),
        q: z.string().max(100).optional().describe('search, e.g. a product code or order number'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: READ_ONLY,
    }, async ({ id, page, limit, ...filters }) => {
      if (!this.erpLogs.configured) return json({ available: false, reason: 'josh\'s log database is not connected on this server (JOSH_MONGO_URL).' });
      if (id) return json((await this.erpLogs.get(id)) ?? { found: false, note: 'josh keeps ERP logs 14 days' });
      return json(await this.erpLogs.list(filters, page, limit));
    });

    server.registerTool('system_health', {
      title: 'System health and errors (admin)',
      description: 'Is anything broken right now, and what failed in a period: commerce → platform delivery (stuck queue, dead-letters, relay), ERP intake failures, and josh-side failures (payments, Jagota order sync, marketing runs, push campaigns).',
      inputSchema: PERIOD_INPUT,
      annotations: READ_ONLY,
    }, async ({ period, fromDate, toDate }) => {
      return json(await this.health.report(bangkokRange(period, Date.now(), fromDate, toDate).current));
    });

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
