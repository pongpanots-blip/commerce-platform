import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { OrderingService } from './ordering.service';

/** Supplier order rounds and SKU logistics (stage 4f) — admin (the guard's default). Staff edits go through the product form. */
@Controller()
export class OrderingController {
  constructor(private readonly ordering: OrderingService) {}

  @Get('order-periods') periods(@Query('supCode') supCode?: string) { return this.ordering.periods(supCode); }

  @Post('order-periods/:supCode/republish') @HttpCode(HttpStatus.OK)
  republish(@Param('supCode') supCode: string) { return this.ordering.republish(supCode); }

  @Get('product-logistics/:sku') logistics(@Param('sku') sku: string) { return this.ordering.getLogistics(sku); }
}
