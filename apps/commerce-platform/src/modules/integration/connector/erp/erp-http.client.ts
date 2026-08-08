import { Injectable, Logger } from '@nestjs/common';

export interface ErpClientConfig {
  baseUrl?: string;
  apiKey?: string;
  liveMode?: boolean;
}

export interface ErpReserveLine {
  sku: string;
  qty: number;
  idempotencyKey: string;
}

export interface ErpReserveResult {
  ok: boolean;
  reservationRef?: string;
  reason?: string;
}

export interface ErpOpResult {
  ok: boolean;
  error?: string;
}

export interface ErpOrderPayload {
  platformOrderId: string;
  customerCode: string | null;
  lines: { sku: string; qty: number; unitPrice: string }[];
  total: string;
  currency: string;
}

export interface ErpCustomerPayload {
  platformCustomerId: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId?: string | null;
}

export interface ErpCustomerResult {
  ok: boolean;
  customerCode?: string;
  error?: string;
}

export interface ErpProductRow {
  sku: string;
  name: string;
  basePrice: string;
  active: boolean;
}

export interface ErpStockRow {
  sku: string;
  qty: number;
}

/**
 * The ONE place that knows the real ERP's HTTP surface. Every method:
 *   1. if cfg.liveMode !== true → return a canned mock (same shape as live)
 *   2. else → perform the real call against cfg.baseUrl with X-Api-Key header.
 * Endpoint paths below are the agreed contract; when the real ERP goes live,
 * only cfg.liveMode flips — call sites and mappings never change.
 */
@Injectable()
export class ErpHttpClient {
  private readonly logger = new Logger(ErpHttpClient.name);

  async reserve(lines: ErpReserveLine[], cfg: ErpClientConfig): Promise<ErpReserveResult[]> {
    if (cfg.liveMode !== true) {
      this.mockLog('POST /api/v1/reservations');
      return lines.map((l) => ({ ok: true, reservationRef: `MOCK-RSV-${l.idempotencyKey}` }));
    }
    const body = { lines };
    const data = await this.post<{ results: ErpReserveResult[] }>('/api/v1/reservations', body, cfg);
    return data.results;
  }

  async confirmReservations(refs: string[], cfg: ErpClientConfig): Promise<ErpOpResult> {
    if (cfg.liveMode !== true) { this.mockLog('POST /api/v1/reservations/confirm'); return { ok: true }; }
    return this.post('/api/v1/reservations/confirm', { refs }, cfg);
  }

  async releaseReservations(refs: string[], cfg: ErpClientConfig): Promise<ErpOpResult> {
    if (cfg.liveMode !== true) { this.mockLog('POST /api/v1/reservations/release'); return { ok: true }; }
    return this.post('/api/v1/reservations/release', { refs }, cfg);
  }

  async createOrder(payload: ErpOrderPayload, cfg: ErpClientConfig): Promise<ErpOpResult & { erpOrderRef?: string }> {
    if (cfg.liveMode !== true) {
      this.mockLog('POST /api/v1/orders');
      return { ok: true, erpOrderRef: `MOCK-ORD-${payload.platformOrderId}` };
    }
    return this.post('/api/v1/orders', payload, cfg);
  }

  async cancelOrder(erpOrderRef: string, cfg: ErpClientConfig): Promise<ErpOpResult> {
    if (cfg.liveMode !== true) { this.mockLog(`POST /api/v1/orders/${erpOrderRef}/cancel`); return { ok: true }; }
    return this.post(`/api/v1/orders/${encodeURIComponent(erpOrderRef)}/cancel`, {}, cfg);
  }

  async upsertCustomer(payload: ErpCustomerPayload, cfg: ErpClientConfig): Promise<ErpCustomerResult> {
    if (cfg.liveMode !== true) {
      this.mockLog('PUT /api/v1/customers');
      return { ok: true, customerCode: `MOCK-CUST-${payload.platformCustomerId}` };
    }
    return this.send('PUT', '/api/v1/customers', payload, cfg);
  }

  async fetchProducts(sinceIso: string | null, cfg: ErpClientConfig): Promise<ErpProductRow[]> {
    if (cfg.liveMode !== true) { this.mockLog('GET /api/v1/products'); return []; }
    const q = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : '';
    const data = await this.send<{ items: ErpProductRow[] }>('GET', `/api/v1/products${q}`, undefined, cfg);
    return data.items;
  }

  async fetchStock(skus: string[], cfg: ErpClientConfig): Promise<ErpStockRow[]> {
    if (cfg.liveMode !== true) {
      this.mockLog('GET /api/v1/stock');
      return skus.map((sku) => ({ sku, qty: 0 }));
    }
    const data = await this.send<{ items: ErpStockRow[] }>(
      'GET', `/api/v1/stock?skus=${encodeURIComponent(skus.join(','))}`, undefined, cfg);
    return data.items;
  }

  private post<T>(path: string, body: unknown, cfg: ErpClientConfig): Promise<T> {
    return this.send<T>('POST', path, body, cfg);
  }

  private async send<T>(method: string, path: string, body: unknown, cfg: ErpClientConfig): Promise<T> {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': cfg.apiKey ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`ERP ${method} ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  private mockLog(op: string): void {
    this.logger.debug(`ERP liveMode off — returning mock for ${op}`);
  }
}
