import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { StaffRequest } from '../../../../../shared-kernel/presentation/auth.decorators';
import { AuditLog } from '../../../../core/audit/infrastructure/audit-log.entity';

/**
 * Every ERP route commerce accepts (contract §5) — the simulator can only call these,
 * never an arbitrary URL. `GET /erp/products` and the two probes stay on josh.
 */
export const SIMULATOR_ROUTES = [
  'PUT /erp/products/qty', 'PUT /erp/products/price', 'PUT /erp/products/moq',
  'POST /erp/products', 'POST /erp/products/bulk', 'PUT /erp/products/image',
  'POST /erp/customers', 'PUT /erp/customers', 'POST /erp/companies',
  'POST /erp/orders/status', 'PUT /erp/orders/status', 'POST /erp/invoices/status', 'PUT /erp/invoices/status',
  'POST /erp/quotations', 'PUT /erp/quotations', 'POST /erp/quotations/status', 'PUT /erp/quotations/status',
  'POST /erp/order-periods', 'PUT /erp/order-periods',
] as const;

/**
 * Off on production unless ERP_SIMULATOR_ENABLED=true: a send is a real ERP call — it is
 * stored, published and delivered to every subscribed platform (josh) like the ERP's own.
 */
/** One HTTP call to commerce itself, timed, with the answer parsed when it is JSON. */
async function selfCall(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const started = Date.now();
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let response: unknown = text;
  try { response = JSON.parse(text); } catch { /* not JSON — show as text */ }
  return { status: res.status, ok: res.ok, ms: Date.now() - started, response };
}

/** josh's storefront key (josh sends X-Api-Key); none → dev fail-open only, the guard decides. */
const storefrontHeaders = (): Record<string, string> => {
  const key = (process.env.STOREFRONT_API_KEYS ?? '').split(',').map((k) => k.trim()).find(Boolean);
  return key ? { 'x-api-key': key } : {};
};

export interface JoshOrderInput {
  customer?: { name?: string; email?: string; phone?: string; taxId?: string };
  lines?: { productId?: string; qty?: number; unitPrice?: number }[];
  /** what josh reports after the customer pays: paid → order confirmed → pushed to ERP */
  payment?: 'paid' | 'failed' | 'none';
}

export const isErpSimulatorEnabled = () => process.env.NODE_ENV !== 'production' || process.env.ERP_SIMULATOR_ENABLED === 'true';

/**
 * Both directions of the ERP flow, through the real HTTP paths:
 *   ERP → commerce → josh: `send` calls commerce's own /api/erp/* with the X-ERP-Key.
 *   josh → commerce → ERP: `joshOrder` makes josh's calls (storefront customer, checkout,
 *   payment result) with josh's storefront key; a paid order is confirmed and pushed to the
 *   ERP by ErpOrderPushSubscriber (a mock unless the ERP integration has liveMode on).
 *
 * ERP webhook simulator (moved from josh's /api/erp/testing passthrough console): staff
 * pick a route and a payload; commerce calls its OWN /api/erp/* over HTTP with the real
 * X-ERP-Key, so the run goes through the exact path an ERP call takes — guard, DTO,
 * ingest/relay, outbox, delivery to platforms. The shipment-based builders (order/invoice
 * from a josh shipment, courier, 3PL, credit-back preview) read shop data and stay in josh.
 */
// Admin only (the global staff guard's default — no @StaffRoles widening).
@Controller('erp-simulator')
export class ErpSimulatorController {
  constructor(private readonly db: DataSource) {}

  private assertEnabled() {
    if (!isErpSimulatorEnabled()) throw new NotFoundException(); // looks like the route doesn't exist
  }

  @Get('routes')
  routes() {
    this.assertEnabled();
    return { routes: SIMULATOR_ROUTES, erpKeyConfigured: !!process.env.ERP_WEBHOOK_KEY?.trim() };
  }

  @Post('send')
  @HttpCode(HttpStatus.OK)
  async send(@Body() body: { route?: string; payload?: unknown }, @Req() req: StaffRequest) {
    this.assertEnabled();
    const route = SIMULATOR_ROUTES.find((r) => r === body?.route);
    if (!route) throw new BadRequestException(`route must be one of: ${SIMULATOR_ROUTES.join(', ')}`);
    if (body.payload === undefined) throw new BadRequestException('payload is required');

    const [method, path] = route.split(' ');
    const sentAt = new Date().toISOString();
    const erpKey = process.env.ERP_WEBHOOK_KEY?.trim();
    const { status, ms, response } = await selfCall(method, path, erpKey ? { 'x-erp-key': erpKey } : {}, body.payload);

    await this.db.getRepository(AuditLog).insert({
      actorId: req.staff.userId, action: 'erp.simulator.send', entityType: 'erp_route', entityId: null,
      after: body.payload as object, context: { route, status },
    });
    return { route, status, ms, sentAt, response };
  }

  /** Products josh would see (storefront catalog, same call josh makes). */
  @Get('josh/products')
  async joshProducts(@Query('search') search?: string) {
    this.assertEnabled();
    const q = new URLSearchParams({ pageSize: '20', ...(search?.trim() ? { search: search.trim().slice(0, 100) } : {}) });
    const res = await selfCall('GET', `/v1/storefront/catalog/products?${q}`, storefrontHeaders());
    if (!res.ok) throw new BadRequestException(`storefront catalog answered ${res.status}: ${JSON.stringify(res.response).slice(0, 300)}`);
    return res.response;
  }

  /** Place an order the way josh does. Stops at the first step that fails; every step is returned. */
  @Post('josh/order')
  @HttpCode(HttpStatus.OK)
  async joshOrder(@Body() body: JoshOrderInput, @Req() req: StaffRequest) {
    this.assertEnabled();
    const name = body?.customer?.name?.trim();
    const lines = (body?.lines ?? []).filter((l) => l?.productId && Number(l.qty) > 0);
    if (!name) throw new BadRequestException('customer.name is required');
    if (!lines.length) throw new BadRequestException('at least one line with productId and qty > 0');
    const payment = body.payment ?? 'paid';
    if (!['paid', 'failed', 'none'].includes(payment)) throw new BadRequestException('payment must be paid, failed or none');

    const headers = storefrontHeaders();
    const steps: { step: string; call: string; request?: unknown; status: number; ms: number; response: unknown }[] = [];
    const run = async (step: string, method: string, path: string, extra: Record<string, string>, request?: unknown) => {
      const r = await selfCall(method, path, { ...headers, ...extra }, request);
      steps.push({ step, call: `${method} /api${path}`, request, status: r.status, ms: r.ms, response: r.response });
      return r;
    };

    const customer = { name, email: body.customer?.email?.trim() || undefined, phone: body.customer?.phone?.trim() || undefined, taxId: body.customer?.taxId?.trim() || undefined };
    const c = await run('customer', 'POST', '/v1/storefront/customers', {}, customer);
    let orderId: string | null = null;
    if (c.ok) {
      const checkout = { customerId: (c.response as { customerId: string }).customerId, currency: 'THB',
        lines: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitPrice: Number(l.unitPrice ?? 0) })) };
      const o = await run('checkout', 'POST', '/v1/storefront/checkout', { 'idempotency-key': `erp-sim-${randomUUID()}` }, checkout);
      const out = o.response as { orderId?: string; status?: string };
      orderId = out?.orderId ?? null;
      if (o.ok && orderId && payment !== 'none' && out.status === 'pending_payment') {
        await run('payment', 'POST', `/v1/storefront/checkout/${orderId}/payment-result`, {}, { result: payment });
      }
    }

    await this.db.getRepository(AuditLog).insert({
      actorId: req.staff.userId, action: 'erp.simulator.josh_order', entityType: 'order', entityId: orderId,
      after: { customer, lines, payment } as object, context: { steps: steps.map((s) => ({ step: s.step, status: s.status })) },
    });
    return { orderId, steps };
  }

  /** Where a simulated (or any) order is now: order, stock reservations, payment, and whether the ERP got it. */
  @Get('josh/orders/:id')
  async joshOrderTrace(@Param('id', ParseUUIDPipe) id: string) {
    this.assertEnabled();
    const [order] = await this.db.query(`SELECT id, code, status, total::float AS total, currency, created_at FROM orders WHERE id = $1`, [id]);
    if (!order) throw new NotFoundException(`order ${id} not found`);
    const [reservations, payments, [erp], [mapping], events] = await Promise.all([
      this.db.query(`SELECT r.status, r.qty::float AS qty, r.fail_reason, p.sku FROM reservations r LEFT JOIN products p ON p.id = r.product_id WHERE r.order_id = $1 ORDER BY p.sku`, [id]),
      this.db.query(`SELECT status, amount::float AS amount, updated_at FROM payments WHERE order_id = $1 ORDER BY created_at`, [id]),
      this.db.query(`SELECT id, (config->>'liveMode') = 'true' AS live_mode FROM integrations WHERE type = 'erp' AND status = 'active' LIMIT 1`),
      this.db.query(`SELECT m.external_id, m.created_at FROM order_mappings m JOIN integrations i ON i.id = m.integration_id AND i.type = 'erp' WHERE m.platform_id = $1 LIMIT 1`, [id]),
      this.db.query(`SELECT type, status, created_at, published_at FROM outbox_messages WHERE aggregate_id = $1 ORDER BY created_at`, [id]),
    ]);
    return {
      order, reservations, payments, events,
      erp: { integration: !!erp, liveMode: !!erp?.live_mode, erpOrderRef: mapping?.external_id ?? null, pushedAt: mapping?.created_at ?? null },
    };
  }
}
