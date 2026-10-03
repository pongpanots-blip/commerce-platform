import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { StorefrontApiKeyGuard } from '../storefront-api-key.guard';
import { OrderService } from '../../modules/commerce/order/application/order.service';
import { Public } from '../../shared-kernel/presentation/auth.decorators';

@ApiTags('storefront-orders')
@ApiSecurity('apiKey')
// Own auth (or health) — skip the global staff guard.
@Public()
@Controller('v1/storefront/orders')
@UseGuards(StorefrontApiKeyGuard)
export class StorefrontOrdersController {
  constructor(private readonly orders: OrderService) {}

  /** Stitched single view: order + per-line fulfillment + promised dates. */
  @Get(':id')
  async byId(@Param('id', ParseUUIDPipe) id: string) {
    const full = await this.orders.getFull(id);
    const promisedByLine = new Map(
      full.reservations.map((r) => [r.orderLineId, r.promisedDate]));
    const fulfillmentByLine = new Map(
      full.fulfillments.map((f) => [f.orderLineId, f]));
    return {
      orderId: full.order.id,
      status: full.order.status,
      currency: full.order.currency,
      total: full.order.total,
      payment: full.payment ? { id: full.payment.id, status: full.payment.status } : null,
      lines: full.lines.map((l) => ({
        orderLineId: l.id,
        productId: l.productId,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        fulfillment: {
          mode: fulfillmentByLine.get(l.id)?.mode ?? null,
          status: fulfillmentByLine.get(l.id)?.status ?? null,
          promisedDate: promisedByLine.get(l.id) ?? null,
        },
      })),
    };
  }

  @Get()
  list(
    @Query('customerId', ParseUUIDPipe) customerId: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.orders.findMany({
      page: Number(page) || 1, pageSize: Math.min(100, Number(pageSize) || 20),
      where: { customerId }, order: { createdAt: 'DESC' },
    });
  }
}
