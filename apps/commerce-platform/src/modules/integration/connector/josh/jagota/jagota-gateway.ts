import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ErpCreateOrderRequest } from './erp-order-request';
import { JagotaOrderSend } from './jagota-order-send.entity';

/** josh jagota-order.types `ERP_REFERENCE_ALREADY_USED`: ERP already holds this reference — the earlier send reached it. */
export const ERP_REFERENCE_ALREADY_USED = 'Magento Order Id is already used';
/** josh JAGOTA_ORDER_CREATE_TIMEOUT_MS — ERP's own doc asks callers for ≥ 30s on add-order-create. */
export const ORDER_CREATE_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 8_000;
/** A `sending` row older than this is an abandoned attempt (commerce restarted mid-call) and may be taken over. */
const SENDING_LEASE_SECONDS = 90;
const TOKEN_TTL_MS = 23 * 3600_000;

export type ErpCreateOrderResponse = { error?: boolean; message?: string; data?: unknown };

/** josh `erpCreateFailureReason`: ERP puts the refusal in `message` or in `data.status`; null when it did not refuse. */
export function erpFailureReason(response: ErpCreateOrderResponse | null): string | null {
  if (!response) return 'no response from ERP';
  if (response.error !== true) return null;
  if (response.message?.trim()) return response.message.trim();
  if (typeof response.data === 'string' && response.data.trim()) return response.data.trim();
  const status = (response.data as { status?: string } | undefined)?.status;
  return status?.trim() || 'ERP refused the order without a reason';
}

/** Same rule josh uses: accepted, or ERP already holds the reference. */
export function erpAccepted(response: ErpCreateOrderResponse | null): boolean {
  if (!response) return false;
  return response.error === false || (erpFailureReason(response) ?? '').includes(ERP_REFERENCE_ALREADY_USED);
}

export type GatewayAnswer =
  /** commerce called Jagota (or replays the answer it already got): josh treats `response` exactly like Jagota's own. */
  | { attempted: true; replayed: boolean; response: ErpCreateOrderResponse | null }
  /** another send of this reference is running right now — josh records a failure and retries later (never falls back). */
  | { attempted: false; reason: 'in_flight' };

/**
 * Step 2 of "orders reach Jagota through commerce": josh builds the ERP request exactly as today
 * (gates, quotations, its sync rows and retries stay in josh) and asks commerce to send it.
 * Commerce owns the Jagota call: login token, 30s timeout, one row per reference (dedupe), and
 * the record of what was sent. Off unless JAGOTA_GATEWAY_ENABLED=true and the Jagota API is
 * configured; while off it answers 503 and josh sends directly as before.
 */
@Injectable()
export class JagotaGateway {
  private readonly logger = new Logger(JagotaGateway.name);
  private token: { value: string; expires: number } | null = null;
  private login: Promise<string> | null = null;

  constructor(@InjectRepository(JagotaOrderSend) private readonly sends: Repository<JagotaOrderSend>) {}

  private get baseUrl() { return process.env.JAGOTA_NODEAPI_BASE_URL?.trim().replace(/\/$/, '') || ''; }

  get enabled() {
    return process.env.JAGOTA_GATEWAY_ENABLED === 'true' && !!this.baseUrl
      && !!process.env.JAGOTA_NODEAPI_USERNAME?.trim() && !!process.env.JAGOTA_NODEAPI_PASSWORD?.trim();
  }

  async createOrder(request: ErpCreateOrderRequest): Promise<GatewayAnswer> {
    if (!this.enabled) throw new ServiceUnavailableException('Jagota gateway is off on this server (JAGOTA_GATEWAY_ENABLED / JAGOTA_NODEAPI_*).');
    const reference = typeof request?.MAGENTO_ORDER_NO === 'string' ? request.MAGENTO_ORDER_NO.trim() : '';
    if (!reference || reference.length > 64 || !Array.isArray(request.orderItems) || !request.orderItems.length) {
      throw new BadRequestException('request must be the add-order-create body (MAGENTO_ORDER_NO, orderItems)');
    }

    // Claim the reference: new, or a failed / abandoned earlier attempt. A sent one is replayed, a running one is in flight.
    const claimed: { id: string }[] = await this.sends.query(
      `INSERT INTO jagota_order_sends (order_reference, status, request, attempts) VALUES ($1, 'sending', $2, 1)
       ON CONFLICT (order_reference) DO UPDATE SET status = 'sending', request = EXCLUDED.request,
              attempts = jagota_order_sends.attempts + 1, last_error = NULL, updated_at = now()
        WHERE jagota_order_sends.status = 'failed'
           OR (jagota_order_sends.status = 'sending' AND jagota_order_sends.updated_at < now() - make_interval(secs => $3))
       RETURNING id`, [reference, request, SENDING_LEASE_SECONDS]);
    if (!claimed.length) {
      const existing = await this.sends.findOneByOrFail({ orderReference: reference });
      if (existing.status === 'sent') return { attempted: true, replayed: true, response: existing.response as ErpCreateOrderResponse };
      return { attempted: false, reason: 'in_flight' };
    }

    const started = Date.now();
    const response = await this.post<ErpCreateOrderResponse>('/order/add-order-create', request, ORDER_CREATE_TIMEOUT_MS);
    const ok = erpAccepted(response);
    const stock = ((response?.data as { orderInfo?: { stockProductOrder?: { DOC_BOOK?: string; DOC_NO?: string }[] } } | undefined)
      ?.orderInfo?.stockProductOrder ?? [])[0];
    await this.sends.update({ id: claimed[0].id }, {
      status: ok ? 'sent' : 'failed', response: response as Record<string, unknown> | null,
      lastError: ok ? null : erpFailureReason(response)?.slice(0, 500) ?? null,
      docBook: stock?.DOC_BOOK ?? null, docNo: stock?.DOC_NO ?? null,
      durationMs: Date.now() - started, updatedAt: new Date(),
    });
    this.logger.log(`Jagota add-order-create ${reference} for josh → ${ok ? 'accepted' : `failed: ${erpFailureReason(response)}`} (${Date.now() - started}ms)`);
    return { attempted: true, replayed: false, response };
  }

  /** Jagota POST with the B2B token (cached in memory, one login at a time, refreshed once on 401). null = no answer. */
  private async post<T>(path: string, body: unknown, timeoutMs: number, retried = false): Promise<T | null> {
    const token = await this.authToken();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: '*/*', 'content-type': 'application/json', ...(token ? { token } : {}) },
      });
    } catch (error) {
      this.logger.warn(`Jagota ${path} failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
    if (res.status === 401 && !retried) {
      this.token = null;
      return this.post<T>(path, body, timeoutMs, true);
    }
    // ERP answers refusals with a JSON body on 4xx/5xx too; josh records that body, so do we.
    return (await res.json().catch(() => null)) as T | null;
  }

  private async authToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    this.login ??= this.doLogin().finally(() => { this.login = null; });
    return this.login;
  }

  private async doLogin(): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/login/b2b`, {
        method: 'POST', signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS), headers: { 'content-type': 'application/json', accept: '*/*' },
        body: JSON.stringify({ username: process.env.JAGOTA_NODEAPI_USERNAME?.trim(), password: process.env.JAGOTA_NODEAPI_PASSWORD?.trim() }),
      });
      const payload = (await res.json().catch(() => null)) as { token?: string; data?: { token?: string; data?: { token?: string } } } | null;
      const raw = (payload?.data?.token ?? payload?.data?.data?.token ?? payload?.token ?? '').trim();
      if (!res.ok || !raw) { this.logger.warn(`Jagota login failed (HTTP ${res.status})`); return ''; }
      const value = raw.startsWith('Bearer ') ? raw : `Bearer ${raw}`;
      this.token = { value, expires: Date.now() + TOKEN_TTL_MS };
      return value;
    } catch (error) {
      this.logger.warn(`Jagota login failed: ${error instanceof Error ? error.message : error}`);
      return '';
    }
  }

  async summary(days = 7) {
    const [row] = await this.sends.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'sent')::int AS sent,
        count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'sending')::int AS sending,
        count(*) FILTER (WHERE attempts > 1)::int AS retried, round(avg(duration_ms))::int AS avg_ms, max(updated_at) AS last_at
      FROM jagota_order_sends WHERE updated_at >= now() - make_interval(days => $1)`, [days]);
    return { enabled: this.enabled, days, ...row };
  }

  list(status?: string, page = 1, limit = 50) {
    if (status && !['sending', 'sent', 'failed'].includes(status)) throw new BadRequestException('status must be sending, sent or failed');
    return this.sends.findAndCount({
      where: status ? { status: status as JagotaOrderSend['status'] } : {}, order: { updatedAt: 'DESC' }, skip: (page - 1) * limit, take: limit,
      select: ['id', 'orderReference', 'status', 'attempts', 'lastError', 'docBook', 'docNo', 'durationMs', 'createdAt', 'updatedAt'],
    }).then(([items, total]) => ({ items, total, page, limit }));
  }

  detail(id: string) { return this.sends.findOneByOrFail({ id }); }
}
