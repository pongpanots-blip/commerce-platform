// Thin fetch wrapper for the Commerce Platform API.
// Base URL is configurable; dev defaults to the platform's local port (3100), production builds to
// same-origin /api (nginx on commerce.joshapp.io routes /api to the platform).
const env = (import.meta as unknown as { env: Record<string, string | boolean> }).env;
const BASE = (env?.VITE_COMMERCE_API as string) || (env?.DEV ? 'http://localhost:3100/api' : '/api');

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
  /** Who is signed in, for display only — read from the JWT payload, not verified (the API verifies). */
  claims(): { sub?: string; email?: string; role?: string } | null {
    const token = this.get();
    try {
      const part = token?.split('.')[1];
      return part ? JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) : null;
    } catch {
      return null;
    }
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
      // FormData sets its own multipart boundary.
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
  if (res.status === 403 && body?.error?.code === 'PASSWORD_CHANGE_REQUIRED') {
    // a password someone else set — the app shows the change-password screen until it is changed
    window.dispatchEvent(new Event('cp-password-change-required'));
  }
  if (!res.ok) {
    const message =
      body?.error?.message || body?.message || `${res.status} ${res.statusText}`;
    throw Object.assign(new Error(Array.isArray(message) ? message.join(', ') : String(message)), { status: res.status, details: body?.error ?? body });
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
  error?: string | null;
  createdAt: string;
  updatedAt?: string;
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
  description?: string | null;
  fulfillmentMode?: string;
  leadTimeDays?: number | null;
  createdAt?: string;
  updatedAt?: string;
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
  details: {
    oldestPendingWebhookAt: string | null;
    syncJobs24h: { total: number; completed: number; failed: number };
    customersNew7d: number;
    integrationsActive: number;
    warehouses: number;
    inventoryUpdatedAt: string | null;
  };
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

// commerce-admin staff accounts (admin / marketing) — commerce's own logins, not josh's.
export type StaffRole = 'admin' | 'marketing';
export interface StaffAccount { id: string; email: string; name: string | null; role: StaffRole; status: 'active' | 'disabled'; createdAt: string }
export const staffApi = {
  list: () => api.get<StaffAccount[]>('/admin/staff'),
  create: (data: { email: string; name?: string; role: StaffRole }) => api.post<{ account: StaffAccount; temporaryPassword: string }>('/admin/staff', data),
  update: (id: string, data: Partial<Pick<StaffAccount, 'name' | 'role' | 'status'>>) => api.patch<StaffAccount>(`/admin/staff/${id}`, data),
  resetPassword: (id: string) => api.post<{ temporaryPassword: string }>(`/admin/staff/${id}/reset-password`, {}),
  me: () => api.get<{ userId: string; email: string; role: StaffRole; mustChangePassword?: boolean }>('/admin/auth/me'),
  changeOwnPassword: (currentPassword: string, newPassword: string) => api.post<{ changed: boolean }>('/admin/auth/password', { currentPassword, newPassword }),
};

export const customersApi = {
  get: (id: string) => api.get<Customer>(`/customers/${id}`),
  update: (id: string, data: Partial<Customer>) => api.patch<Customer>(`/customers/${id}`, data),
};

export const productsApi = {
  get: (id: string) => api.get<Product>(`/products/${id}`),
  update: (id: string, data: Partial<Product>) => api.patch<Product>(`/products/${id}`, data),
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
    /** On-demand Gemini summary of the evidence (POST runs/:id/summarize); worked off by the research cron. */
    analysis?: {
      status: 'queued' | 'running' | 'completed' | 'not_configured' | 'unavailable' | 'insufficient_data';
      summary: string; reason: string; sampleSize: number; generatedAt?: string;
      findings: { text: string; evidenceIds: string[] }[]; suggestions: { text: string; evidenceIds: string[] }[];
    };
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
  summarize: (id: string) =>
    enveloped(api.post<Envelope<ResearchRun>>(`/marketing-research/runs/${id}/summarize`, { requestId: crypto.randomUUID() })),
};

// ---- Product prices (stage 4a: base price / ERP box price / MOQ and the MER queue, owned by commerce) ----
export interface PriceRow { sku: string; selling_unit_price: string | null; ordering_price: string | null; moq: number | null; source: string; updated_by: string | null; updated_at: string }
export interface PricePending {
  sku: string; selling_unit_price: string | null; ordering_price: string | null; moq: number | null; changed_at: string | null; received_at: string;
  current_selling_unit_price: string | null; current_ordering_price: string | null; current_moq: number | null;
}
const q = (search: string) => (search ? `?search=${encodeURIComponent(search)}` : '');
export const productPricesApi = {
  ownership: () => api.get<{ prices?: boolean; productContent?: boolean; productMaster?: boolean; productImages?: boolean; ordering?: boolean }>('/ownership'),
  list: (search: string) => api.get<PriceRow[]>(`/product-prices${q(search)}`),
  pending: (search: string) => api.get<PricePending[]>(`/product-prices/pending${q(search)}`),
  approve: (skus: string[]) => api.post<{ approved: number }>('/product-prices/pending/approve', { skus }),
  reject: (skus: string[]) => api.post<{ rejected: number }>('/product-prices/pending/reject', { skus }),
  edit: (sku: string, body: { sellingUnitPrice?: number; orderingPrice?: number; moq?: number }) =>
    api.patch<unknown>(`/product-prices/${encodeURIComponent(sku)}`, body),
};

// ---- Product content (stage 4b: names / descriptions, ingredients, cost … owned by commerce; edited in the product form) ----
export const productContentsApi = {
  get: (sku: string) => api.get<{ sku: string; fields: Record<string, unknown>; updated_at: string }>(`/product-contents/${encodeURIComponent(sku)}`),
};

// ---- ERP product master (stage 4d: units / pack / status / category … and their MER queue, owned by commerce) ----
export interface MasterPending { sku: string; patch: Record<string, unknown>; current: Record<string, unknown>; changed_at: string | null; received_at: string }
export const productMastersApi = {
  pending: (search: string) => api.get<MasterPending[]>(`/product-masters/pending${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  approve: (skus: string[]) => api.post<{ approved: number }>('/product-masters/pending/approve', { skus }),
  reject: (skus: string[]) => api.post<{ rejected: number }>('/product-masters/pending/reject', { skus }),
  get: (sku: string) => api.get<{ sku: string; fields: Record<string, unknown> }>(`/product-masters/${encodeURIComponent(sku)}`),
};

// ---- Ordering / logistics (stage 4f: ERP supplier order rounds and SKU logistics fields, owned by commerce) ----
export interface OrderPeriodRow { sup_code: string; erp_order_period: string; date_from: string; date_to: string; close_at: string | null; status: string; synced_at: string }
export const orderingApi = {
  periods: (supCode: string) => api.get<OrderPeriodRow[]>(`/order-periods${supCode ? `?supCode=${encodeURIComponent(supCode)}` : ''}`),
  republish: (supCode: string) => api.post<{ supCode: string; periods: unknown[] }>(`/order-periods/${encodeURIComponent(supCode)}/republish`, {}),
  logistics: (sku: string) => api.get<{ sku: string; fields: Record<string, unknown> }>(`/product-logistics/${encodeURIComponent(sku)}`),
};

// ---- Product galleries (stage 4e: owned by commerce; files in josh's media bucket) ----
export const productImagesApi = {
  get: (sku: string) => api.get<{ sku: string; images: string[] }>(`/product-images/${encodeURIComponent(sku)}`),
  upload: (sku: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('images', f);
    return request<{ sku: string; images: string[] }>(`/product-images/${encodeURIComponent(sku)}/upload`, { method: 'POST', body: form });
  },
  set: (sku: string, images: string[]) => api.put<{ sku: string; images: string[] }>(`/product-images/${encodeURIComponent(sku)}`, { images }),
};

// ---- Stock moves (stage 3: commerce-owned warehouses, through the ledger) ----
export interface StockWarehouse { id: string; code: string; name: string; stockSource: 'erp' | 'commerce'; sellable: boolean }
export interface StockAdjustResult { status: string; previousQuantity: number; quantity: number; reserved: number }
export const stockApi = {
  warehouses: () => api.get<StockWarehouse[]>('/stock/warehouses'),
  adjust: (body: { sku: string; warehouseCode: string; mode: 'set' | 'add'; quantity: number; reason: string; note?: string }) =>
    api.post<StockAdjustResult>('/stock/adjustments', body),
  transfer: (body: { sku: string; fromWarehouseCode: string; toWarehouseCode: string; quantity: number; note?: string }) =>
    api.post<{ from: StockAdjustResult & { warehouse: string }; to: StockAdjustResult & { warehouse: string } }>('/stock/transfers', body),
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
  totals: Record<string, number> & { refunds: { n: number | null; amount: number | null; note?: string } };
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
export interface RestaurantDetail extends RestaurantRow {
  source: string | null; openingHours: unknown; popularTimes: unknown; enrichedAt: string | null;
  serviceOptions: { dineIn: boolean | null; takeaway: boolean | null; delivery: boolean | null };
}
export interface TargetgroupRow {
  cust_code: string; total_skus_ordered: number; ot_skus_ordered: number; ot_skus_with_active_period: number;
  max_shipments_per_week: number; delivery_weekdays: number[] | null;
}
const query = (p: Record<string, string | number | boolean | undefined>) =>
  new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)])).toString();
export const marketApi = {
  restaurants: (f: Record<string, string | number | boolean | undefined>) => api.get<RestaurantList>(`/reports/restaurants?${query(f)}`),
  restaurant: (id: string) => api.get<RestaurantDetail>(`/reports/restaurants/${encodeURIComponent(id)}`),
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
  vat_type: string | null; created_at: string; description_th: string | null; description_en: string | null;
  ingredients: string | null; allergens: string | null; expiration_info: string | null; usage_direction: string | null; best_paired_food: string | null;
  maximum_shelf_life: string | null; is_organic: string | null; product_short_code: string | null; buying_price: number | null; reorder_quantity: number | null;
  unit_ratio: string | null; sub_packing_unit: string | null; product_unit: string | null; expected_restock_at: string | null;
  delivery_dates: { day: string }[] | null;
  media: { id: string; source: string; media_type: string; sort_order: number }[];
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

export interface WorkflowRow { id: string; name: string; status: 'draft' | 'active' | 'paused'; trigger_type: string; schedule: unknown; cooldown_days: number | null;
  holdout_percent: number | null; conversion_window_days: number | null; updated_at: string; enrolled: number; running: number; failed: number; converted: number;
  holdout: number; last_run_at: string | null; failed_runs: number }
export const workflowsApi = {
  list: (days: number) => api.get<WorkflowRow[]>(`/reports/marketing-workflows?days=${days}`),
  detail: (id: string) => api.get<Record<string, unknown> & { enrollmentsByStatus: { status: string; n: number }[];
    recentRuns: { fired_at: string; source: string; status: string; skip_reason: string | null; audience_count: number | null; enrolled_count: number | null; error_message: string | null }[];
    recentFailures: { created_at: string; step_id: string; action_kind: string; detail: unknown }[] }>(`/reports/marketing-workflows/${id}`),
  create: (workflow: Record<string, unknown>) => api.post<WorkflowRow>(`/josh/marketing-workflows`, { workflow }),
  setState: (id: string, action: 'activate' | 'pause') => api.post<unknown>(`/josh/marketing-workflows/${id}/${action}`, {}),
  /** josh's UpdateMarketingWorkflowDto fields; josh validates. */
  update: (id: string, workflow: Record<string, unknown>) => api.post<unknown>(`/josh/marketing-workflows/${id}/update`, { workflow }),
};

/**
 * Call one of josh's own admin routes through commerce (POST /josh/admin-call): josh runs it as you,
 * with josh's validation; the answer is josh's. `path` is josh's path without /api, e.g. `/coupon`.
 */
export const joshAdmin = {
  call: <T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown,
    opts: { query?: Record<string, string | number | boolean>; files?: { field: string; filename: string; contentType?: string; base64: string }[] } = {}) =>
    api.post<T>('/josh/admin-call', { method, path, body, query: opts.query, files: opts.files }),
  get: <T = unknown>(path: string, query?: Record<string, string | number | boolean>) => joshAdmin.call<T>('GET', path, undefined, { query }),
  /** Real multipart (videos, bulk images, any size josh's own route takes): `fields` are josh's form fields, `files` keep josh's field names. */
  upload: <T = unknown>(method: 'POST' | 'PATCH' | 'PUT', path: string, fields: Record<string, unknown>, files: { field: string; file: File }[],
    query?: Record<string, string | number | boolean>) => {
    const form = new FormData();
    form.append('request', JSON.stringify({ method, path, query, body: fields }));
    for (const f of files) form.append(f.field, f.file, f.file.name);
    return request<T>('/josh/admin-call/upload', { method: 'POST', body: form });
  },
};

/** A josh binary answer (CSV / PDF export) as admin-call returns it. */
export interface JoshFileAnswer { file: { contentType: string; filename: string | null; base64: string } }
export const isJoshFile = (v: unknown): v is JoshFileAnswer =>
  !!v && typeof v === 'object' && typeof (v as JoshFileAnswer).file?.base64 === 'string';
export function joshFileBlob(a: JoshFileAnswer): Blob {
  const bin = atob(a.file.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: a.file.contentType });
}

export interface LivechatLogRow { id: string; direction: 'to_cs_crm' | 'to_shop'; route: string; visitorId: string | null; text: string | null; status: number; createdAt: string }
export const livechatApi = {
  list: (visitorId: string, page: number) => api.get<{ items: LivechatLogRow[]; total: number }>(`/reports/livechat?visitorId=${encodeURIComponent(visitorId)}&page=${page}`),
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
  createSupplier: (supplier: Record<string, string>) => api.post<unknown>('/josh/suppliers', { supplier }),
  updateSupplier: (id: string, supplier: Record<string, string>) => api.post<unknown>(`/josh/suppliers/${id}/update`, { supplier }),
  removeSupplier: (id: string) => api.post<unknown>(`/josh/suppliers/${id}/remove`, {}),
  uploadDoc: (d: { category: string; title?: string; filename: string; content: string }) => api.post<unknown>('/josh/internal-docs', d),
  removeDoc: (id: string) => api.post<unknown>(`/josh/internal-docs/${id}/remove`, {}),
  updateCustomer: (kind: 'users' | 'branches' | 'companies', id: string, changes: Record<string, unknown>) => api.post<unknown>(`/josh/customers/${kind}/${id}/update`, { changes }),
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
