import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Post, Req } from '@nestjs/common';
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
export const isErpSimulatorEnabled = () => process.env.NODE_ENV !== 'production' || process.env.ERP_SIMULATOR_ENABLED === 'true';

/**
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
    const started = Date.now();
    const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(process.env.ERP_WEBHOOK_KEY?.trim() ? { 'x-erp-key': process.env.ERP_WEBHOOK_KEY.trim() } : {}) },
      body: JSON.stringify(body.payload),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let response: unknown = text;
    try { response = JSON.parse(text); } catch { /* not JSON — show as text */ }

    await this.db.getRepository(AuditLog).insert({
      actorId: req.staff.userId, action: 'erp.simulator.send', entityType: 'erp_route', entityId: null,
      after: body.payload as object, context: { route, status: res.status },
    });
    return { route, status: res.status, ms: Date.now() - started, sentAt, response };
  }
}
