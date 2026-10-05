// Thin fetch wrapper for the Commerce Platform API.
// Base URL is configurable; defaults to the platform's local dev port (3100).
const BASE =
  (import.meta as unknown as { env: Record<string, string> }).env
    ?.VITE_COMMERCE_API || 'http://localhost:3100/api';

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Staff session. sessionStorage: gone when the tab closes; the token itself
// expires after 12h (platform JwtModule). Wrapped — storage can throw.
const TOKEN_KEY = 'cp_admin_token';
export const session = {
  get(): string | null {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token: string) {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* private mode: stays in memory for this load */ }
  },
  clear() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

export async function login(email: string, password: string): Promise<{ role: string }> {
  const res = await request<{ accessToken: string; role: string }>('/admin/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  session.set(res.accessToken);
  return { role: res.role };
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = session.get();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (res.status === 401 && path !== '/admin/auth/login') {
    // Expired or missing session — back to the login screen.
    session.clear();
    window.dispatchEvent(new Event('cp-session-expired'));
  }
  if (!res.ok) {
    const message =
      body?.error?.message || body?.message || `${res.status} ${res.statusText}`;
    throw new Error(Array.isArray(message) ? message.join(', ') : String(message));
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  put: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  base: BASE,
};

// ---- Domain types (mirrors of platform entities used by the UI) ----
export interface Integration {
  id: string;
  name: string;
  type: string;
  slug: string | null;
  status: string;
  config: Record<string, unknown>;
  signingSecret: string | null;
  createdAt: string;
}
export interface WebhookEvent {
  id: string;
  integrationId: string;
  signatureValid: boolean;
  status: string;
  attempts: number;
  payload: unknown;
  createdAt: string;
}
export interface SyncJob {
  id: string;
  integrationId: string;
  operation: string;
  status: string;
  result: unknown;
  createdAt: string;
}
export interface Customer {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
}
export interface Product {
  id: string;
  sku: string;
  name: string;
  status: string;
}
export interface InventoryLevel {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  reserved: string;
}
export interface WebhookSubscription {
  id: string;
  name: string;
  targetUrl: string;
  eventTypes: string[];
  secret: string | null;
  active: boolean;
  description: string | null;
  createdAt: string;
}
export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventType: string;
  targetUrl: string;
  status: string;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  createdAt: string;
}
export const EVENT_TYPES = [
  'customer.created',
  'customer.updated',
  'product.updated',
  'order.created',
  'order.confirmed',
  'order.cancelled',
  'inventory.updated',
  'price.updated',
  'supplier.updated',
  // ERP hub: canonical feed events
  'inventory.qty.changed',
  'product.price.changed',
  'product.moq.changed',
  // ERP hub: ERP calls relayed verbatim (for platforms running ERP logic, e.g. josh)
  'erp.product.upserted',
  'erp.products.bulk_upserted',
  'erp.product.image_updated',
  'erp.customer.upserted',
  'erp.company.upserted',
  'erp.order.status_changed',
  'erp.invoice.status_changed',
  'erp.quotation.pushed',
  'erp.quotation.status_changed',
  'erp.order_periods.pushed',
];

export interface AdminStats {
  integrations: number;
  webhooksPending: number;
  webhooksFailed: number;
  outboxBacklog: number;
  syncJobsRecent: number;
  customers: number;
  products: number;
  inventoryLevels: number;
}

export interface OrderRow {
  id: string; customerId: string; code: string | null; status: string;
  currency: string; total: string; idempotencyKey: string | null; createdAt: string;
}
export interface OrderLineRow {
  id: string; orderId: string; productId: string; qty: string; unitPrice: string; lineTotal: string;
}
export interface FulfillmentRow {
  id: string; orderId: string; orderLineId: string; source: string; mode: string;
  status: string; reservationId: string | null;
}
export interface ReservationRow {
  id: string; orderId: string; orderLineId: string; productId: string; sku: string;
  qty: string; mode: string; status: string; externalRef: string | null;
  idempotencyKey: string; expiresAt: string | null; promisedDate: string | null;
  failReason: string | null; createdAt: string;
}
export interface PaymentRow {
  id: string; orderId: string; status: string; method: string | null;
  amount: string; currency: string; createdAt: string;
}
export interface OrderFull {
  order: OrderRow; lines: OrderLineRow[]; fulfillments: FulfillmentRow[];
  reservations: ReservationRow[]; payment: PaymentRow | null;
}
export interface ErpStubStockRow { id: string; sku: string; qty: number; }

export type ErpIngestEntityType = 'product' | 'stock' | 'customer' | 'sale_order' | 'product_qty' | 'product_price' | 'product_moq';
export type ErpIngestStatus = 'received' | 'applied' | 'failed' | 'skipped' | 'stale' | 'ignored';
export interface ErpIngestRecordRow {
  id: string;
  integrationId: string;
  entityType: ErpIngestEntityType;
  externalId: string | null;
  rawPayload: unknown;
  parsedPayload: Record<string, unknown> | null;
  status: ErpIngestStatus;
  error: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export const erpIngestApi = {
  list: (params: { entityType?: string; status?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params.entityType) qs.set('entityType', params.entityType);
    if (params.status) qs.set('status', params.status);
    qs.set('page', String(params.page ?? 1));
    qs.set('pageSize', String(params.pageSize ?? 20));
    return api.get<Paginated<ErpIngestRecordRow>>(`/admin/erp-ingest?${qs.toString()}`);
  },
  apply: (id: string) => api.post<ErpIngestRecordRow>(`/admin/erp-ingest/${id}/apply`, {}),
};

export const ordersApi = {
  full: (id: string) => api.get<OrderFull>(`/orders/${id}/full`),
  checkout: (id: string) =>
    request<unknown>(`/orders/${id}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    }),
  pay: (paymentId: string) => api.post<PaymentRow>(`/payments/${paymentId}/pay`, {}),
  failPay: (paymentId: string) => api.post<PaymentRow>(`/payments/${paymentId}/fail`, {}),
  releaseReservations: (orderId: string) => api.post(`/reservations/${orderId}/release`, {}),
};

// ---- Marketing research + web scraping (moved from josh) ----
// These endpoints keep josh's envelope: { status, data, message } with HTTP 200
// even on failure — a non-empty `message` is the error. `enveloped` unwraps it.
interface Envelope<T> { status: number; data: T; message: string }
async function enveloped<T>(p: Promise<Envelope<T>>): Promise<T> {
  const res = await p;
  if (res.message) throw new Error(res.message);
  return res.data;
}

export type ResearchKind = 'sales' | 'competitor' | 'procurement' | 'trend';
export const RESEARCH_KINDS: ResearchKind[] = ['sales', 'competitor', 'procurement', 'trend'];
export const RESEARCH_AREAS = ['กรุงเทพมหานคร', 'กรุงเทพฯ และปริมณฑล', 'ทั่วประเทศไทย'];
export const RESEARCH_SECTORS = ['ทุกกลุ่ม · น้ำหนักเท่ากัน', 'ร้านอาหาร', 'โรงแรม / จัดเลี้ยง', 'ร้านค้าปลีก', 'โรงงานอาหาร'];
export interface ResearchSourceStatus { id: string; ready: boolean; reason: string }
export interface ResearchTopic {
  id: string; title: string; kind: ResearchKind; area: string; days: number; sector: string;
  sources: string[]; followHourly: boolean; createdBy: string; version: number;
  nextRunAt: string | null; archivedAt: string | null; createdAt: string; updatedAt: string; canManage: boolean;
}
export interface ResearchRun {
  id: string; topicId: string; status: string; message: string; attempts: number;
  findingsCount: number;
  report: {
    summary?: string; findings?: { text: string; evidenceIds: string[] }[];
    evidence?: { id: string; source: string; url: string; excerpt: string; collectedAt: string }[];
    suggestions?: string[]; limitations?: string[];
  } | null;
  keptAt: string | null; createdAt: string; finishedAt: string | null;
}
export interface ResearchTopicInput {
  title: string; kind: ResearchKind; area: string; days: number; sector: string; sources: string[]; followHourly: boolean;
}

export const marketingResearchApi = {
  sources: () => enveloped(api.get<Envelope<ResearchSourceStatus[]>>('/marketing-research/sources')),
  list: (page = 1, limit = 20) =>
    enveloped(api.get<Envelope<{ items: ResearchTopic[]; totalCount: number; page: number; limit: number }>>(`/marketing-research/topics?page=${page}&limit=${limit}`)),
  create: (input: ResearchTopicInput) => enveloped(api.post<Envelope<ResearchTopic>>('/marketing-research/topics', input)),
  update: (topic: ResearchTopic, input: ResearchTopicInput) =>
    enveloped(api.patch<Envelope<ResearchTopic>>(`/marketing-research/topics/${topic.id}`, { ...input, version: topic.version })),
  archive: (topic: ResearchTopic) => enveloped(api.post<Envelope<ResearchTopic>>(`/marketing-research/topics/${topic.id}/archive`, { version: topic.version })),
  runs: (topicId: string) => enveloped(api.get<Envelope<ResearchRun[] | { items: ResearchRun[] }>>(`/marketing-research/topics/${topicId}/runs`)),
  requestRun: (topicId: string) =>
    enveloped(api.post<Envelope<ResearchRun>>(`/marketing-research/topics/${topicId}/runs`, { requestId: crypto.randomUUID() })),
  keepRun: (id: string) => enveloped(api.post<Envelope<ResearchRun>>(`/marketing-research/runs/${id}/keep`, {})),
};

export interface ScrapingConfig {
  startUrls?: string[]; pathPrefixes?: string[]; mode: 'html' | 'browser'; itemSelector?: string;
  fields?: { key: string; label: string; selector: string; attribute?: string }[];
  currency?: string; vatIncluded?: boolean; priceContext: string; collectionAllowed?: boolean;
  intervalHours: number; maxPages?: number; delayMs?: number;
  /** Detect repeated product cards from links instead of CSS field selectors. */
  autoCards?: boolean;
  /** 'browser' = follow next link / next button / load more / scroll in one session. */
  pagination?: 'none' | 'browser';
}
export interface ScrapingSource {
  id: string; name: string; origin: string; config: ScrapingConfig; revision: number; enabled: boolean;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'limited'; lastError: string | null; lastRunAt: string | null;
  progress: { pages?: number; pending?: number; successful: number; failed: number; items: number };
}
export interface ScrapedItem {
  id: string; sourceId: string; url: string; pageUrl: string; name: string; sku: string;
  fields: Record<string, string>; priceIncVat: number | null; weightKg: number | null; currency: string;
  observedAt: string; configCurrent: boolean; source?: { id: string; name: string };
}

export const scrapingApi = {
  sources: () => enveloped(api.get<Envelope<ScrapingSource[]>>('/scraping/sources')),
  discover: (website: string, collectionAllowed: boolean) =>
    enveloped(api.post<Envelope<unknown>>('/scraping/discover', { website, collectionAllowed })),
  save: (input: Pick<ScrapingSource, 'name' | 'origin' | 'enabled' | 'config'> & { revision?: number }, id?: string) =>
    enveloped(id ? api.put<Envelope<ScrapingSource>>(`/scraping/sources/${id}`, input) : api.post<Envelope<ScrapingSource>>('/scraping/sources', input)),
  start: (source: ScrapingSource) =>
    enveloped(api.post<Envelope<ScrapingSource>>(`/scraping/sources/${source.id}/start`, { revision: source.revision, restart: true })),
  stop: (source: ScrapingSource) =>
    enveloped(api.post<Envelope<ScrapingSource>>(`/scraping/sources/${source.id}/stop`, { revision: source.revision, restart: false })),
  items: (sourceId: string, search: string, page: number) => {
    const qs = new URLSearchParams({ page: String(page) });
    if (sourceId) qs.set('sourceId', sourceId);
    if (search) qs.set('search', search);
    return enveloped(api.get<Envelope<{ items: ScrapedItem[]; total: number; page: number; pageSize: number }>>(`/scraping/items?${qs}`));
  },
};

// ---- Competitor price comparison (MER, moved from josh) — same envelope ----
export interface CompetitorCatalogProduct {
  id: string; sku: string; name: string; brand: string | null; country: string | null; storage: string | null;
  packSize: string | null; sellingUnit: string | null; sellingUnitPriceIncVat: number; updatedAt: string; syncedAt: string; removed: boolean;
}
export interface CompetitorPriceInput {
  catalogItemId?: string; revision?: number;
  sku: string; ourWeightKg: number; sourceUrl: string; competitorName: string; competitorSku: string;
  competitorWeightKg: number; sourceContext: string; vatIncluded: boolean; collectionAllowed: boolean; autoRefresh: boolean;
}
export type CompetitorPriceComparison = Omit<CompetitorPriceInput, 'sku'> & {
  id: string; revision: number; ourProductVersion: string; ourProduct: CompetitorCatalogProduct;
  sourceName: string; ourPricePerKgIncVat: number | null; ourPackPriceIncVat: number | null;
  competitorPackPriceIncVat: number | null; competitorPricePerKgIncVat: number | null;
  differencePerKgIncVat: number | null; differenceForOurWeightIncVat: number | null; differencePercent: number | null;
  comparisonReady: boolean; comparisonReason: string | null; verified: boolean;
  matchNote: string; verifiedAt: string | null; verifiedBy: string | null;
  canRefresh: boolean; refreshReason: string | null; observedAt: string | null;
  captureMethod: 'manual' | 'automatic' | null; lastError: string | null;
};
/** `per_kg`: our SKU sells by the kilo. `same`: pack weights within 5%. A person still confirms every pair. */
export type CompetitorSkuSuggestion = CompetitorCatalogProduct & {
  similarityPercent: number; weightMatch: 'same' | 'different' | 'unknown' | 'per_kg'; ourWeightKg: number | null;
};
export type ScrapedCatalogItem = ScrapedItem & { source: { id: string; name: string; config: ScrapingConfig } };

export const competitorPricesApi = {
  list: () => enveloped(api.get<Envelope<CompetitorPriceComparison[]>>('/competitor-prices')),
  catalog: (sku: string) => enveloped(api.get<Envelope<CompetitorCatalogProduct>>(`/competitor-prices/catalog/${encodeURIComponent(sku)}`)),
  suggestions: (catalogItemId: string) => enveloped(api.get<Envelope<{ catalogItem: { id: string; name: string; weightKg: number | null }; suggestions: CompetitorSkuSuggestion[] }>>(`/competitor-prices/suggestions/${catalogItemId}`)),
  catalogItem: (id: string) => enveloped(api.get<Envelope<ScrapedCatalogItem>>(`/competitor-prices/catalog-items/${id}`)),
  save: (input: CompetitorPriceInput, id?: string) => enveloped(id
    ? api.put<Envelope<CompetitorPriceComparison>>(`/competitor-prices/${id}`, input)
    : api.post<Envelope<CompetitorPriceComparison>>('/competitor-prices', input)),
  verify: (row: CompetitorPriceComparison, matchNote: string) => enveloped(api.post<Envelope<CompetitorPriceComparison>>(
    `/competitor-prices/${row.id}/verify`, { matchNote, revision: row.revision, ourProductVersion: row.ourProductVersion })),
  capture: (row: CompetitorPriceComparison, priceIncVat: number, observedAt: string) => enveloped(api.post<Envelope<CompetitorPriceComparison>>(
    `/competitor-prices/${row.id}/price`, { priceIncVat, observedAt, revision: row.revision })),
  refresh: (id: string) => enveloped(api.post<Envelope<CompetitorPriceComparison>>(`/competitor-prices/${id}/refresh`, {})),
  remove: (id: string) => enveloped(api.del<Envelope<{ id: string }>>(`/competitor-prices/${id}`)),
};

// ---- Inventory per warehouse (read model) ----
export interface WarehouseStockSummary { code: string; name: string; stockSource: 'erp' | 'commerce'; skus: number; onHand: number; reserved: number }
export interface WarehouseStockRow {
  id: string; sku: string; name: string; warehouseCode: string; stockSource: 'erp' | 'commerce';
  quantity: number; reserved: number; available: number; updatedAt: string;
  lastSource: string | null; lastReason: string | null; lastStatus: string | null; lastChangedAt: string | null;
}
export const inventoryOverviewApi = {
  get: (warehouse: string, search: string, page: number) => {
    const qs = new URLSearchParams({ page: String(page) });
    if (warehouse) qs.set('warehouse', warehouse);
    if (search) qs.set('search', search);
    return api.get<{ warehouses: WarehouseStockSummary[]; items: WarehouseStockRow[]; total: number; page: number; pageSize: number }>(`/inventory-overview?${qs}`);
  },
};

// ---- AI connectors (MCP) ----
export interface McpConnection {
  clientId: string; clientName: string; staffUserId: string; staffEmail: string;
  firstSeenAt: string; liveSessions: number; canWrite: boolean; lastUsedAt: string | null; toolCalls: number;
}
export interface McpActivity { id: string; at: string; isWrite: boolean; tool: string; args: Record<string, unknown> | null; staffEmail: string; clientName: string }
export const mcpApi = {
  connections: () => api.get<{ enabled: boolean; mcpUrl: string | null; role: string; connections: McpConnection[] }>('/mcp-connections'),
  activity: (limit = 50) => api.get<McpActivity[]>(`/mcp-connections/activity?limit=${limit}`),
  revoke: (c: McpConnection) => api.post<{ revoked: number }>(`/mcp-connections/${encodeURIComponent(c.clientId)}/revoke`, { staffUserId: c.staffUserId }),
};

// Webhook Subscriptions & Deliveries
export interface WebhookDeliveryFull {
  id: string;
  subscriptionId: string;
  eventType: string;
  targetUrl: string;
  status: string;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  payload?: unknown;
  createdAt: string;
}

export interface ErpSimulatorResult { route: string; status: number; ms: number; sentAt: string; response: unknown }

export const erpSimulatorApi = {
  routes: () => api.get<{ routes: string[]; erpKeyConfigured: boolean }>('/erp-simulator/routes'),
  send: (route: string, payload: unknown) => api.post<ErpSimulatorResult>('/erp-simulator/send', { route, payload }),
};

export const webhookApi = {
  subscriptions: () => api.get<WebhookSubscription[]>('/webhook-subscriptions'),
  subscription: (id: string) => api.get<WebhookSubscription>(`/webhook-subscriptions/${id}`),
  createSubscription: (data: {
    name: string;
    targetUrl: string;
    eventTypes: string[];
    secret?: string;
    description?: string;
  }) => api.post<WebhookSubscription>('/webhook-subscriptions', data),
  updateSubscription: (id: string, data: Partial<WebhookSubscription>) =>
    api.patch<WebhookSubscription>(`/webhook-subscriptions/${id}`, data),
  deleteSubscription: (id: string) => api.del<void>(`/webhook-subscriptions/${id}`),
  deliveries: () => api.get<WebhookDeliveryFull[]>('/webhook-subscriptions/deliveries'),
  getEvent: (id: string) => api.get<WebhookEvent>(`/webhooks/events/${id}`),
  replayEvent: (webhookEventId: string) =>
    api.post<{ replayed: string }>(`/webhooks/replay/${webhookEventId}`, {}),
  /** Dead-letter: give a failed OUTBOUND delivery a fresh retry budget. */
  retryDelivery: (deliveryId: string) =>
    api.post<WebhookDeliveryFull>(`/webhook-subscriptions/deliveries/${deliveryId}/retry`, {}),
};

// Shop reports (josh read replica) — same numbers the MCP tools answer with.
export const REPORT_PERIODS = ['today', 'yesterday', 'this_week', 'last_7_days', 'this_month', 'last_month', 'last_30_days', 'custom'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
export interface PeriodParams { period: ReportPeriod; fromDate?: string; toDate?: string }
type Row = Record<string, string | number | null>;
export interface SalesReport {
  period: string;
  totals: Record<string, number> & { refunds: { n: number; amount: number } };
  vsPreviousPeriod: { period: string; revenue_inc_vat: number; orders: number; revenue_change_percent: number | null; orders_change_percent: number | null };
  byDay?: { bucket: string; orders: number; revenue_inc_vat: number }[];
  byMonth?: { bucket: string; orders: number; revenue_inc_vat: number }[];
  topProducts: { sku: string; name: string; qty: number; revenue_inc_vat: number }[];
}
export interface TrafficReport {
  period: string;
  note: string;
  totals: Record<string, number>;
  vsPreviousPeriod: { period: string; sessions: number; visitors: number; sessions_change_percent: number | null };
  byPlatform: { platform: string; sessions: number; visitors: number }[];
  sessionsByDay: { day: string; sessions: number }[];
  funnelSessions: Record<string, number>;
  topSearches: { query: string; searches: number; no_results: number }[];
}
export interface HealthReport {
  period: string;
  now: { ok: boolean; problems: string[] };
  commerce: Record<string, number>;
  josh: { available?: false; reason?: string; counts?: Record<string, number>; jagotaOrderSyncErrors?: Row[]; notAvailable?: string };
}
const qs = (p: PeriodParams) => '?' + new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
export const reportsApi = {
  sales: (p: PeriodParams) => api.get<SalesReport>(`/reports/sales${qs(p)}`),
  traffic: (p: PeriodParams) => api.get<TrafficReport>(`/reports/traffic${qs(p)}`),
  health: (p: PeriodParams) => api.get<HealthReport>(`/reports/health${qs(p)}`),
};

/** GET a file with the staff token and save it (a plain <a href> can't send the Authorization header). */
export async function downloadFile(path: string, filename: string) {
  const token = session.get();
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export interface RestaurantRow {
  id: string; name: string; name_th: string | null; name_en: string | null; district: string | null; category: string | null;
  lat: number; lng: number; rating: number | null; review_count: number | null; price_range: string | null;
  is_enriched: boolean; dine_in: boolean | null; takeaway: boolean | null; delivery: boolean | null;
  popular_times_today: number[] | null; winback_account_id: string | null; winback_customer_code: string | null;
}
export interface RestaurantList {
  items: RestaurantRow[]; page: number; limit: number;
  summary: { total_count: number; top_categories: { name: string; count: number }[]; top_districts: { name: string; count: number }[] };
}
export interface TargetgroupRow {
  cust_code: string; total_skus_ordered: number; ot_skus_ordered: number; ot_skus_with_active_period: number;
  max_shipments_per_week: number; delivery_weekdays: number[] | null;
}
const query = (p: Record<string, string | number | boolean | undefined>) =>
  new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const marketApi = {
  restaurants: (f: Record<string, string | number | boolean | undefined>) => api.get<RestaurantList>(`/reports/restaurants?${query(f)}`),
  restaurantsCsv: (f: Record<string, string | number | boolean | undefined>) => downloadFile(`/reports/restaurants/export?${query(f)}`, 'restaurant-places.csv'),
  targetgroup: (f: { minShipmentsPerWeek?: number; custCode?: string; limit: number; offset: number }) =>
    api.get<{ total: number; items: TargetgroupRow[] }>(`/reports/order-targetgroup?${query(f)}`),
};
