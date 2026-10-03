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
