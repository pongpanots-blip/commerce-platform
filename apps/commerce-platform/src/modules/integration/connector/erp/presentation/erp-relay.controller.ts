import { Body, Controller, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { Public } from '../../../../../shared-kernel/presentation/auth.decorators';
import { ErpKeyGuard } from './erp-key.guard';
import { ERP_RELAY_EVENTS as E, ErpRelayService, orderPeriodSnapshotKey } from '../ingest/erp-relay.service';

/**
 * Same paths, method, X-ERP-Key and `{ received: true }` as josh's ERP routes
 * (contract §5), so nginx can send them here first with josh as backup.
 * Not here — nginx keeps them on josh: `GET /erp/products` (the ERP reading
 * josh's catalog) and the ops probes `POST /erp/delivery-calendar/probe` +
 * `POST /erp/sku-order-period/probe` (josh calls Jagota and answers with the
 * result; queuing them here would only hide that answer).
 */
@UseGuards(ErpKeyGuard)
@Public()
@Controller('erp')
export class ErpRelayController {
  constructor(private readonly relay: ErpRelayService) {}

  private async send(type: (typeof E)[keyof typeof E], route: string, body: unknown, snapshotKey: string | null = null) {
    await this.relay.relay(type, route, body, snapshotKey);
    return { received: true };
  }

  @Post('products') @HttpCode(HttpStatus.OK) product(@Body() b: unknown) { return this.send(E.productUpsert, 'POST /erp/products', b); }
  @Post('products/bulk') @HttpCode(HttpStatus.OK) productBulk(@Body() b: unknown) { return this.send(E.productBulk, 'POST /erp/products/bulk', b); }
  @Put('products/image') @HttpCode(HttpStatus.OK) productImage(@Body() b: unknown) { return this.send(E.productImage, 'PUT /erp/products/image', b); }

  @Post('customers') @HttpCode(HttpStatus.OK) customerPost(@Body() b: unknown) { return this.send(E.customer, 'POST /erp/customers', b); }
  @Put('customers') @HttpCode(HttpStatus.OK) customerPut(@Body() b: unknown) { return this.send(E.customer, 'PUT /erp/customers', b); }
  @Post('companies') @HttpCode(HttpStatus.OK) company(@Body() b: unknown) { return this.send(E.company, 'POST /erp/companies', b); }

  @Post('orders/status') @HttpCode(HttpStatus.OK) orderPost(@Body() b: unknown) { return this.send(E.orderStatus, 'POST /erp/orders/status', b); }
  @Put('orders/status') @HttpCode(HttpStatus.OK) orderPut(@Body() b: unknown) { return this.send(E.orderStatus, 'PUT /erp/orders/status', b); }
  @Post('invoices/status') @HttpCode(HttpStatus.OK) invoicePost(@Body() b: unknown) { return this.send(E.invoiceStatus, 'POST /erp/invoices/status', b); }
  @Put('invoices/status') @HttpCode(HttpStatus.OK) invoicePut(@Body() b: unknown) { return this.send(E.invoiceStatus, 'PUT /erp/invoices/status', b); }
  @Post('quotations') @HttpCode(HttpStatus.OK) quotationPost(@Body() b: unknown) { return this.send(E.quotation, 'POST /erp/quotations', b); }
  @Put('quotations') @HttpCode(HttpStatus.OK) quotationPut(@Body() b: unknown) { return this.send(E.quotation, 'PUT /erp/quotations', b); }
  @Post('quotations/status') @HttpCode(HttpStatus.OK) quotationStatusPost(@Body() b: unknown) { return this.send(E.quotationStatus, 'POST /erp/quotations/status', b); }
  @Put('quotations/status') @HttpCode(HttpStatus.OK) quotationStatusPut(@Body() b: unknown) { return this.send(E.quotationStatus, 'PUT /erp/quotations/status', b); }

  @Post('order-periods') @HttpCode(HttpStatus.OK) orderPeriodsPost(@Body() b: unknown) { return this.send(E.orderPeriods, 'POST /erp/order-periods', b, orderPeriodSnapshotKey(b)); }
  @Put('order-periods') @HttpCode(HttpStatus.OK) orderPeriodsPut(@Body() b: unknown) { return this.send(E.orderPeriods, 'PUT /erp/order-periods', b, orderPeriodSnapshotKey(b)); }
}
