import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import { OrderQuoteShadow } from './order-quote-shadow';

/** Checkout shadow quote results (admin only, the guard default). Writes nothing to josh. */
@Controller('reports/order-quote-shadow')
export class OrderQuoteShadowController {
  constructor(private readonly shadow: OrderQuoteShadow) {}

  private replica() {
    if (!this.shadow.available) throw new ServiceUnavailableException('josh\'s read replica is not connected on this server (JOSH_DATABASE_URL).');
  }

  @Get('summary') summary(@Query('days') days?: string) {
    const d = days ? Number(days) : 7;
    if (!Number.isInteger(d) || d < 1 || d > 90) throw new BadRequestException('days must be 1-90');
    return this.shadow.summary(d);
  }

  @Get() list(@Query('filter') filter = 'mismatched', @Query('page') page = '1') {
    if (!['all', 'mismatched', 'matched'].includes(filter)) throw new BadRequestException('filter must be all, mismatched or matched');
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
    return this.shadow.list(filter as 'all' | 'mismatched' | 'matched', p);
  }

  @Post('run') @HttpCode(HttpStatus.OK)
  async run() { this.replica(); return { checked: await this.shadow.checkNew() }; }

  @Post('recheck/:orderId') @HttpCode(HttpStatus.OK)
  recheck(@Param('orderId', ParseUUIDPipe) id: string) { this.replica(); return this.shadow.recheck(id); }
}
