import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, ServiceUnavailableException } from '@nestjs/common';
import { StaffRequest } from '../../../../../shared-kernel/presentation/auth.decorators';
import { StaffPriceKind } from './staff-price.entity';
import { StaffPriceInput, StaffPrices } from './staff-prices';

/**
 * Customer and branch contract prices owned by commerce (admin only, the guard default — josh's own
 * routes for them are AdminOnlyGuard too). Each change is written to josh by josh's services.
 */
@Controller('staff-prices')
export class StaffPricesController {
  constructor(private readonly prices: StaffPrices) {}

  private as(req: StaffRequest) { return { userId: req.staff.userId, email: req.staff.email }; }

  @Get('summary') summary() { return this.prices.summary(); }

  @Get() list(@Query('kind') kind?: string, @Query('scopeId') scopeId?: string, @Query('search') search?: string, @Query('status') status?: string, @Query('page') page = '1') {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
    return this.prices.list({ kind, scopeId, search, status }, p);
  }

  /** Pull josh's current prices in (rows josh created itself: ERP quotations, CS price requests). */
  @Post('import') @HttpCode(HttpStatus.OK)
  import() {
    if (!this.prices.available) throw new ServiceUnavailableException('josh\'s read replica is not connected on this server (JOSH_DATABASE_URL).');
    return this.prices.importFromJosh();
  }

  @Post() @HttpCode(HttpStatus.OK)
  create(@Body() b: StaffPriceInput & { kind?: StaffPriceKind }, @Req() req: StaffRequest) {
    return this.prices.create(b?.kind as StaffPriceKind, pick(b), this.as(req));
  }

  @Patch(':id') update(@Param('id') id: string, @Body() b: StaffPriceInput, @Req() req: StaffRequest) { return this.prices.update(id, pick(b), this.as(req)); }
  @Delete(':id') remove(@Param('id') id: string, @Req() req: StaffRequest) { return this.prices.remove(id, this.as(req)); }
  @Post(':id/retry') @HttpCode(HttpStatus.OK) retry(@Param('id') id: string, @Req() req: StaffRequest) { return this.prices.retry(id, this.as(req)); }
}

/** Only the fields a price has — nothing else from the body reaches josh. */
function pick(b: StaffPriceInput = {}): StaffPriceInput {
  const { companyId, branchId, productInventoryId, sku, price, contractRef, startDate, endDate } = b ?? {};
  return { companyId, branchId, productInventoryId, sku, price: price == null ? undefined : Number(price), contractRef, startDate, endDate };
}
