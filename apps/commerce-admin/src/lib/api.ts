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

// Same shapes as josh libs/shared-api competitor-prices.api.ts (af81a227), so the two compare 1:1.
export type ScrapingField = { key: string; label: string; selector: string; attribute?: string };
export type ScrapingConfig = {
  startUrls: string[]; pathPrefixes: string[]; mode: 'html' | 'browser'; itemSelector: string;
  fields: ScrapingField[]; currency: string; vatIncluded: boolean; priceContext: string;
  selectedFields?: string[];
  /** Detect repeated product cards from links instead of CSS field selectors. */
  autoCards?: boolean;
  /** 'browser' = follow next link / next button / load more / scroll in one session. */
  pagination?: 'none' | 'browser';
  /** Run only at night (server window, default 00:00–06:00 Bangkok); long runs pause and resume next night. */
  nightOnly?: boolean;
  /** Pages the site reported at discovery, for 'X of ~Y' progress. */
  expectedPages?: number;
  collectionAllowed: boolean; intervalHours: number; maxPages: number; delayMs: number;
};
export type ScrapingSourceInput = { name: string; origin: string; config: ScrapingConfig; enabled: boolean; revision?: number };
/** Our own member account on a site. Password is write-only; prices read while logged in are member prices. */
export type ScrapingLogin = { url: string; username: string; password?: string };
export interface ScrapingSource extends ScrapingSourceInput {
  id: string; revision: number; configVersion: string;
  login: { url: string; username: string; hasPassword: boolean } | null;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'limited'; lastError: string | null; lastRunAt: string | null;
  /** reading · waiting_for_night · queued (starts within seconds) · retrying (dropped, retrying itself) · gave_up (dropped 3×, use runNow) */
  activity: 'reading' | 'waiting_for_night' | 'queued' | 'retrying' | 'gave_up' | null;
  progress: { pages: number; pending: number; successful: number; failed: number; items: number };
}
export type ScrapingPreview = { url: string; observedAt: string; found: number; links: number; sitemap: boolean; message: string;
  items: { url: string; name: string; sku: string; fields: Record<string, string>; price: number | null; currency: string }[];
};
/** Result of reading two listing pages in a browser: `works` = page 2 had new items, so runs page through by themselves. */
export type ScrapingPaging = { pages: { page: number; found: number; fresh: number }[]; totalPages: number | null; works: boolean };
export type ScrapingDiscovery = { ready: boolean; proposal: ScrapingSourceInput | null; preview: ScrapingPreview | null; paging?: ScrapingPaging | null;
  fields: { key: string; label: string; examples: string[]; required: boolean; recommended: boolean }[];
  scannedPages: { url: string; title: string; mode: 'html' | 'browser'; found: number; error: string | null }[]; warnings: string[];
};
/** Master switch for all background collection (trial period). Off = no scheduled starts; running sessions stop after their current page. */
export type ScrapingAutomation = { enabled: boolean; updatedAt: string | null; updatedBy: string | null };
export interface ScrapedItem {
  id: string; sourceId: string; url: string; pageUrl: string; name: string; sku: string;
  fields: Record<string, string>; priceIncVat: number | null; weightKg: number | null; currency: string;
  observedAt: string; configCurrent: boolean; source?: { id: string; name: string };
}

export const scrapingApi = {
  automation: () => enveloped(api.get<Envelope<ScrapingAutomation>>('/scraping/automation')),
  setAutomation: (enabled: boolean) => enveloped(api.put<Envelope<ScrapingAutomation>>('/scraping/automation', { enabled })),
  sources: () => enveloped(api.get<Envelope<ScrapingSource[]>>('/scraping/sources')),
  discover: (website: string, collectionAllowed: boolean, login?: ScrapingLogin) =>
    enveloped(api.post<Envelope<ScrapingDiscovery>>('/scraping/discover', { website, collectionAllowed, ...(login ? { login } : {}) })),
  /** Omit `password` to keep the stored one. Resets the run: a login changes which prices are read. */
  saveLogin: (sourceId: string, login: ScrapingLogin) => enveloped(api.put<Envelope<ScrapingSource>>(`/scraping/sources/${sourceId}/login`, login)),
  clearLogin: (sourceId: string) => enveloped(api.del<Envelope<ScrapingSource>>(`/scraping/sources/${sourceId}/login`)),
  save: (input: ScrapingSourceInput, id?: string) =>
    enveloped(id ? api.put<Envelope<ScrapingSource>>(`/scraping/sources/${id}`, input) : api.post<Envelope<ScrapingSource>>('/scraping/sources', input)),
  preview: (input: ScrapingSourceInput & { sampleUrl: string }) => enveloped(api.post<Envelope<ScrapingPreview>>('/scraping/preview', input)),
  /** `firstLook`: paged sites read their first 20 pages now in the background (night-only sites continue at night). */
  start: (source: ScrapingSource, restart: boolean, firstLook = false) =>
    enveloped(api.post<Envelope<ScrapingSource>>(`/scraping/sources/${source.id}/start`, { revision: source.revision, restart, ...(firstLook ? { firstLook } : {}) })),
  /** Old link-crawl source → whole-listing paging; answers at once, a first look runs in the background. */
  enablePaging: (source: ScrapingSource) =>
    enveloped(api.post<Envelope<ScrapingSource>>(`/scraping/sources/${source.id}/paging`, { revision: source.revision, restart: true })),
  /** A night-only site waiting for tonight (or one that gave up) continues now in the background. */
  runNow: (source: ScrapingSource) =>
    enveloped(api.post<Envelope<ScrapingSource>>(`/scraping/sources/${source.id}/run-now`, { revision: source.revision, restart: false })),
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

export interface SimProduct { id: string; sku: string; name: string; price: string | null; stock: number }
export interface JoshOrderResult { orderId: string | null; steps: { step: string; call: string; request?: unknown; status: number; ms: number; response: unknown }[] }
export interface JoshOrderTrace {
  order: { id: string; code: string | null; status: string; total: number; currency: string; created_at: string };
  reservations: { sku: string | null; qty: number; status: string; fail_reason: string | null }[];
  payments: { status: string; amount: number; updated_at: string }[];
  events: { type: string; status: string; created_at: string; published_at: string | null }[];
  erp: { integration: boolean; liveMode: boolean; erpOrderRef: string | null; pushedAt: string | null };
}
export const erpSimulatorApi = {
  routes: () => api.get<{ routes: string[]; erpKeyConfigured: boolean }>('/erp-simulator/routes'),
  send: (route: string, payload: unknown) => api.post<ErpSimulatorResult>('/erp-simulator/send', { route, payload }),
  joshProducts: (search: string) => api.get<{ items: SimProduct[] }>(`/erp-simulator/josh/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  joshOrder: (body: { customer: { name: string; email?: string; phone?: string }; payment: 'paid' | 'failed' | 'none';
    lines: { productId: string; qty: number; unitPrice: number }[] }) => api.post<JoshOrderResult>('/erp-simulator/josh/order', body),
  joshOrderTrace: (id: string) => api.get<JoshOrderTrace>(`/erp-simulator/josh/orders/${id}`),
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

/** josh `RestaurantPlaceListItemDto` / `RestaurantPlaceListResponseDto`, same field names. */
export interface RestaurantRow {
  id: string; name: string; nameTh: string | null; nameEn: string | null; district: string | null; category: string | null;
  lat: number; lng: number; rating: number | null; reviewCount: number | null; priceRange: string | null; isEnriched: boolean;
  popularTimesToday: number[] | null; estimatedTables: number | null; winbackAccountId: string | null; winbackCustomerCode: string | null;
}
export interface RestaurantList {
  items: RestaurantRow[]; page: number; limit: number;
  summary: { totalCount: number; topCategories: { name: string; count: number }[]; topDistricts: { name: string; count: number }[] };
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

export interface JoshErpLogRow { id: string; endpoint: string; method: string; statusCode: number; isSuccess: boolean; durationMs: number; summary?: string; createdAt: string }
export const joshErpLogApi = {
  list: (f: Record<string, string | number | undefined>) => api.get<{ items: JoshErpLogRow[]; total: number; page: number; limit: number }>(`/reports/erp-logs?${query(f)}`),
  get: (id: string) => api.get<Record<string, unknown>>(`/reports/erp-logs/${id}`),
};

// josh winback manager reports — josh's `{data, meta}` camelCase envelope, same as josh GET /api/winback/*.
type WbEnvelope<T> = { data: T; meta?: { total: number; page: number; limit: number; totalPages: number } };
export interface WbOverview {
  counts: { total: number; unassigned: number; placeCandidates: number; byHealth: Record<string, number>; byStage: Record<string, number>; byLifecycle: Record<string, number> };
  provinces: { province: string; count: number }[];
  revenueRisk: { revenueAtRisk: number; dormantMonthlyRevenue: number; recoverableRevenue: number; recoveryProbability: number };
}
export interface WbRep { salesUserId: string; name: string | null; email: string | null; leadCount: number; openCount: number; signedCount: number; rejectedCount: number; visits: number; calls: number; activities: number }
export interface WbPerson { salesUserId: string; name: string | null; gmv: number; orderCount: number; target: number | null; achievementPct: number | null }
export interface WbLead { accountId: string; displayName: string; assignedSalesUserName: string | null; stage: string; stageEnteredAt: string; lastActivityAt: string | null; lastActivityType: string | null; lastNote: string | null; unloggedAppointments: { activityId: string; scheduledAt: string }[] }
export const winbackApi = {
  overview: () => api.get<WbEnvelope<WbOverview>>('/reports/winback/overview'),
  teamStats: () => api.get<WbEnvelope<{ reps: WbRep[] }>>('/reports/winback/team-stats'),
  dashboard: () => api.get<WbEnvelope<{ gmv: number; target: { set: boolean; baht: number }; achievement: { pct: number | null }; orders: { total: number; aov: number }; byPerson: WbPerson[] }>>('/reports/winback/dashboard'),
  scorecard: () => api.get<WbEnvelope<{ reactivation: { total: number; won: number; rate: number }; timing: { avgDaysToFirstContact: number | null; avgDaysToFirstOrder: number | null } }>>('/reports/winback/scorecard'),
  leadSignals: () => api.get<WbEnvelope<{ leads: WbLead[]; stageMedianDays: Record<string, number> }>>('/reports/winback/lead-signals?limit=50'),
};

// josh push campaigns (read-only) — josh's own field names.
export interface PushCampaign {
  id: string; name: string; status: string; title: string; body: string; audience: { include: Record<string, string[]>; exclude: Record<string, string[]> };
  ab_enabled: boolean; scheduled_at: string | null; sent_at: string | null; created_at: string; last_error: string | null;
  stats: { queued: number; sent: number; skipped: number; failed: number; clicked: number };
}
export interface PushDelivery {
  deliveryStats: null | { totals: { attempted: number; sent: number; skipped: number; failed: number; clicked: number; deliveryRate: number; clickRate: number };
    byTypeChannel: { channel: string; attempted: number; sent: number; skipped: number; failed: number; clicked: number; clickRate: number }[];
    topSkipAndFailReasons: { reason: string; count: number }[] };
  note?: string;
}
export const pushCampaignApi = {
  overview: () => api.get<{ campaigns: number; scheduled: number; sentToday: number; totalQueued: number; totalSent: number }>('/reports/push-campaigns/overview'),
  list: () => api.get<PushCampaign[]>('/reports/push-campaigns'),
  delivery: (id: string) => api.get<PushDelivery>(`/reports/push-campaigns/${id}/delivery`),
};

// josh catalog, read-only — josh's column names.
export interface JoshProductRow {
  product_inventory_id: string; product_inventory_sku: string; product_status: string; name_th: string | null; name_en: string | null;
  category_id: string | null; category_name_th: string | null; category_path: string | null; brand_name: string | null;
  selling_unit_price: number | null; ordering_price: number | null; original_price: number | null; product_inventory_quantity: number | null;
  low_stock_threshold: number | null; moq: number | null; selling_unit: string | null; pack_size: string | null; order_taking_flag: string | null;
  sup_code: string | null; storage_temperature: string | null; country_code_source: string | null;
  erp_pending_source: string | null; erp_pending_at: string | null; updated_at: string; image_count: number; image_url: string | null;
}
export interface JoshProductDetail extends JoshProductRow {
  vat_type: string | null; created_at: string; description_th: string | null; description_en: string | null; media: { source: string; media_type: string; sort_order: number }[];
  pendingChanges: { field: string; column: string | null; current: unknown; pending: unknown; changed: boolean | null }[];
}
export type ProductIssueKey = 'pending_approval' | 'no_image' | 'no_category' | 'no_price' | 'out_of_stock' | 'low_stock';
export const joshProductApi = {
  summary: () => api.get<Record<ProductIssueKey | 'total', number> & { byStatus: { status: string; n: number }[] }>('/reports/products/summary'),
  categories: () => api.get<{ id: string; category_name_th: string | null; category_path: string | null }[]>('/reports/products/categories'),
  list: (f: Record<string, string | number | undefined>) => api.get<{ items: JoshProductRow[]; total: number; page: number; limit: number }>(`/reports/products?${query(f)}`),
  detail: (idOrSku: string) => api.get<JoshProductDetail>(`/reports/products/${encodeURIComponent(idOrSku)}`),
};

// josh orders / customers / prices, read-only — josh column names.
export type JoshRow = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const joshOrderApi = {
  summary: (f: Record<string, string | undefined>) => api.get<JoshRow>(`/reports/orders/summary?${query(f)}`),
  list: (f: Record<string, string | number | undefined>) => api.get<{ items: JoshRow[]; total: number }>(`/reports/orders?${query(f)}`),
  detail: (idOrNumber: string) => api.get<JoshRow>(`/reports/orders/${encodeURIComponent(idOrNumber)}`),
};
export const joshCustomerApi = {
  summary: () => api.get<JoshRow>('/reports/customers/summary'),
  list: (f: Record<string, string | number | undefined>) => api.get<{ items: JoshRow[]; total: number }>(`/reports/customers?${query(f)}`),
  detail: (id: string) => api.get<JoshRow>(`/reports/customers/${id}`),
};
export const joshPriceApi = {
  branches: (search: string) => api.get<JoshRow[]>(`/reports/prices/branches?${query({ search })}`),
  forBranch: (branchId: string, search: string) => api.get<{ branch: JoshRow; note: string; items: JoshRow[] }>(`/reports/prices/branches/${branchId}?${query({ search })}`),
  quotations: (customerCode: string) => api.get<JoshRow[]>(`/reports/prices/quotations?${query({ customerCode })}`),
};

// Orders → Jagota through commerce, shadow mode (compare only, nothing sent).
export interface ShadowDiff { path: string; josh: unknown; commerce: unknown }
export interface ShadowCheck {
  id: string; joshSyncId: string; orderReference: string | null; joshSyncStatus: string | null; joshSentAt: string; matched: boolean;
  diffs: ShadowDiff[]; note: string | null; checkedAt: string; joshRequest?: unknown; commerceRequest?: unknown;
}
export const jagotaShadowApi = {
  summary: (days: number) => api.get<{ days: number; checked: number; matched: number; mismatched: number; could_not_build: number; matchRate: number | null;
    first_at: string | null; last_at: string | null; topFields: { field: string; n: number }[] }>(`/reports/jagota-shadow/summary?days=${days}`),
  list: (filter: string, page: number) => api.get<{ items: ShadowCheck[]; total: number }>(`/reports/jagota-shadow?filter=${filter}&page=${page}`),
  detail: (id: string) => api.get<ShadowCheck>(`/reports/jagota-shadow/${id}`),
  run: () => api.post<{ checked: number }>('/reports/jagota-shadow/run', {}),
  recheck: (joshSyncId: string) => api.post<ShadowCheck>(`/reports/jagota-shadow/recheck/${encodeURIComponent(joshSyncId)}`, {}),
};

export interface JagotaSend { id: string; orderReference: string; status: 'sending' | 'sent' | 'failed'; attempts: number; lastError: string | null;
  docBook: string | null; docNo: string | null; durationMs: number | null; createdAt: string; updatedAt: string; request?: unknown; response?: unknown }
export const jagotaGatewayApi = {
  summary: (days: number) => api.get<{ enabled: boolean; days: number; total: number; sent: number; failed: number; sending: number; retried: number;
    avg_ms: number | null; last_at: string | null }>(`/reports/jagota-gateway/summary?days=${days}`),
  list: (status: string, page: number) => api.get<{ items: JagotaSend[]; total: number }>(`/reports/jagota-gateway?status=${status}&page=${page}`),
  detail: (id: string) => api.get<JagotaSend>(`/reports/jagota-gateway/${id}`),
};

export interface JagotaSyncRow { id: string; orderId: string; orderNumber: string | null; shipmentId: string | null; paymentMethod: string; paymentSuccess: boolean;
  syncStatus: string; docBook: string | null; docNo: string | null; errorMessage: string | null; createdAt: string; requestJson?: unknown; jagotaResponseJson?: unknown }
export const jagotaHistoryApi = {
  summary: (days: number) => api.get<{ days: number; total: number; recent: number; first_at: string | null; last_at: string | null; last_import_at: string | null;
    byStatus: { sync_status: string; n: number }[] }>(`/reports/jagota-sync-history/summary?days=${days}`),
  list: (f: { status: string; q: string; page: number }) => api.get<{ items: JagotaSyncRow[]; total: number }>(
    `/reports/jagota-sync-history?status=${encodeURIComponent(f.status)}&q=${encodeURIComponent(f.q)}&page=${f.page}`),
  detail: (id: string) => api.get<JagotaSyncRow>(`/reports/jagota-sync-history/${id}`),
  run: () => api.post<{ added: number; refreshed: number }>('/reports/jagota-sync-history/run', {}),
};

export interface PromotionRow { id: string; name: string; badge_text: string | null; badge_text_en: string | null; is_active: boolean; start_date: string; end_date: string;
  campaign_id: string | null; campaign_name: string | null; max_units: number | null; sold_units: number; audience: string; audience_companies: number;
  value: Record<string, unknown> | null; product_set_ids: string[]; sku_count: number; state: 'running' | 'scheduled' | 'ended' | 'sold_out' | 'off'; updated_at: string }
export const promotionsApi = {
  list: (f: { state: string; search: string }) => api.get<PromotionRow[]>(`/reports/promotions?state=${encodeURIComponent(f.state)}&search=${encodeURIComponent(f.search)}`),
  detail: (id: string) => api.get<PromotionRow & { skus: { sku: string; name_th: string | null; badge_text: string | null; value: unknown; quantity_rules: unknown }[] }>(`/reports/promotions/${id}`),
  productSets: () => api.get<{ id: string; name: string; is_active: boolean; products: number }[]>('/reports/promotions/product-sets'),
  shadow: (days: number) => api.get<{ days: number; lines: number; same_mechanic: number; matched: number; sameMechanicRate: number | null }>(`/reports/promotions/shadow?days=${days}`),
  /** Body in josh's CreatePromotionMechanicDto shape; josh validates it. */
  create: (mechanic: Record<string, unknown>) => api.post<unknown>('/josh/promotions', { mechanic }),
  update: (id: string, changes: Record<string, unknown>) => api.post<unknown>(`/josh/promotions/${id}/update`, { changes }),
  remove: (id: string) => api.post<unknown>(`/josh/promotions/${id}/remove`, {}),
};

export interface BackofficeColumn { key: string; label: string; kind: 'text' | 'money' | 'number' | 'date' | 'datetime' | 'bool' | 'status' | 'code' | 'phone' | 'email' }
export interface BackofficeList { key: string; title: string; joshPage: string; columns: BackofficeColumn[]; byStatus: { status: string | null; n: number }[];
  items: Record<string, unknown>[]; total: number; page: number; limit: number }
export const backofficeApi = {
  list: (view: string, f: { search?: string; status?: string; page: number }) => {
    const p = new URLSearchParams({ page: String(f.page) });
    if (f.search) p.set('search', f.search);
    if (f.status) p.set('status', f.status);
    return api.get<BackofficeList>(`/reports/backoffice/${encodeURIComponent(view)}?${p}`);
  },
};

export interface ApiLogRow { id: string; method: string; url: string; statusCode: number; isSuccess: boolean; durationMs: number; message: string; createdAt: string;
  source: string; requestId: string | null; userId: string | null }
export interface ApiLogDetail extends ApiLogRow { errorMessage?: string; response?: unknown; payload?: unknown; query?: unknown; ip?: string; steps: { label: string; ms: number }[] }
export interface ApiLogStats { from: string; to: string; bucketMs: number; buckets: { start: string; count: number; errors: number; avgMs: number; maxMs: number }[];
  topEndpoints: { method: string; route: string; count: number; errors: number; avgMs: number; maxMs: number }[] }
export const apiLogsApi = {
  list: (q: Record<string, string>) => api.get<{ items: ApiLogRow[]; total: number; page: number; limit: number }>(`/reports/api-logs?${new URLSearchParams(q)}`),
  stats: (q: Record<string, string>) => api.get<ApiLogStats>(`/reports/api-logs/stats?${new URLSearchParams(q)}`),
  detail: (id: string) => api.get<ApiLogDetail>(`/reports/api-logs/${encodeURIComponent(id)}`),
};

/** Ask josh to act (josh's own services and rules do the work; off on josh unless COMMERCE_ACTIONS_ENABLED). */
export const joshActionsApi = {
  reviewCredit: (id: string, b: { status: string; approved_credit_limit?: number; approved_term_days?: number; reject_reason?: string; accounting_remark?: string }) =>
    api.post<unknown>(`/josh/credit-applications/${id}/review`, b),
  approveAccess: (id: string, role: string) => api.post<unknown>(`/josh/admin-access/${id}/approve`, { role }),
  rejectAccess: (id: string, reason: string) => api.post<unknown>(`/josh/admin-access/${id}/reject`, { reason }),
  setCouponActive: (id: string, isActive: boolean) => api.post<unknown>(`/josh/coupons/${id}/active`, { isActive }),
  approveProducts: (ids: string[]) => api.post<unknown>('/josh/products/approve', { ids }),
  rejectProducts: (ids: string[]) => api.post<unknown>('/josh/products/reject', { ids }),
  /** josh field names (ProductService.update), e.g. product_name_th, selling_unit_price, category_id. */
  updateProduct: (id: string, fields: Record<string, unknown>) => api.post<unknown>(`/josh/products/${id}/update`, { fields }),
};

export interface PriceShadowRow { id: string; joshOrderItemId: string; orderNumber: string | null; sku: string | null; quantity: number; orderedAt: string;
  joshUnitPrice: string; joshSource: string | null; joshMechanicId: string | null; commerceUnitPrice: string | null; commerceSource: string | null;
  commerceMechanicId: string | null; matched: boolean; diffs: string[]; note: string | null }
export const priceShadowApi = {
  summary: (days: number) => api.get<{ days: number; checked: number; matched: number; mismatched: number; could_not_price: number; changed_after: number;
    matchRate: number | null; first_at: string | null; last_at: string | null; mismatchBySource: { josh_source: string | null; commerce_source: string | null; n: number }[] }>(`/reports/price-shadow/summary?days=${days}`),
  list: (filter: string, page: number) => api.get<{ items: PriceShadowRow[]; total: number }>(`/reports/price-shadow?filter=${filter}&page=${page}`),
  run: () => api.post<{ checked: number }>('/reports/price-shadow/run', {}),
  recheck: (id: string) => api.post<PriceShadowRow>(`/reports/price-shadow/recheck/${id}`, {}),
};

export interface StaffPriceRow { id: string; kind: 'customer' | 'contract'; companyId: string | null; branchId: string | null; productInventoryId: string; sku: string | null;
  price: number; contractRef: string | null; startDate: string; endDate: string | null; joshId: string | null; status: 'synced' | 'pending' | 'failed';
  syncError: string | null; updatedBy: string | null; updatedAt: string }
export interface StaffPriceInput { kind?: 'customer' | 'contract'; companyId?: string; branchId?: string; sku?: string; price?: number; contractRef?: string; startDate?: string; endDate?: string | null }
export const staffPricesApi = {
  summary: () => api.get<{ rows: { kind: string; status: string; n: number }[] }>('/staff-prices/summary'),
  list: (f: { kind: string; scopeId?: string; search?: string; status?: string; page: number }) => {
    const p = new URLSearchParams({ kind: f.kind, page: String(f.page) });
    for (const k of ['scopeId', 'search', 'status'] as const) if (f[k]) p.set(k, f[k]!);
    return api.get<{ items: StaffPriceRow[]; total: number; limit: number }>(`/staff-prices?${p}`);
  },
  create: (b: StaffPriceInput) => api.post<StaffPriceRow>('/staff-prices', b),
  update: (id: string, b: StaffPriceInput) => api.patch<StaffPriceRow>(`/staff-prices/${id}`, b),
  remove: (id: string) => api.del<unknown>(`/staff-prices/${id}`),
  retry: (id: string) => api.post<StaffPriceRow>(`/staff-prices/${id}/retry`, {}),
  importFromJosh: () => api.post<{ added: number; changedInJosh: number; removedInJosh: number }>('/staff-prices/import', {}),
};
