import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { QueuePageQuery, queuePage } from '../queue-page';
import { OrderingService } from './ordering.service';

/** Supplier order rounds and SKU logistics (stage 4f). Merchandise may read the rounds. Republish stays admin. Staff edits go through the product form. */
@Controller()
export class OrderingController {
  constructor(private readonly ordering: OrderingService) {}

  /** `page`/`limit` → `{ items, total, page, limit }` (20/100); neither → the bare array (first 1000). */
  @Get('order-periods') @StaffRoles('merchandising')
  periods(@Query() q: QueuePageQuery, @Query('supCode') supCode?: string) { return this.ordering.periods(supCode, queuePage(q)); }

  @Post('order-periods/:supCode/republish') @HttpCode(HttpStatus.OK)
  republish(@Param('supCode') supCode: string) { return this.ordering.republish(supCode); }

  @Get('product-logistics/:sku') logistics(@Param('sku') sku: string) { return this.ordering.getLogistics(sku); }
}
