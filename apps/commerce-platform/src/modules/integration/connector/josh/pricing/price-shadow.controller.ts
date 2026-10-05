import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, ServiceUnavailableException } from '@nestjs/common';
import { PriceShadow } from './price-shadow';

/** Shadow mode for "commerce owns prices" (admin only, the guard default). Reads josh, writes only commerce's own check rows. */
@Controller('reports/price-shadow')
export class PriceShadowController {
  constructor(private readonly shadow: PriceShadow) {}

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

  @Post('recheck/:joshOrderItemId') @HttpCode(HttpStatus.OK)
  recheck(@Param('joshOrderItemId', ParseUUIDPipe) id: string) { this.replica(); return this.shadow.recheck(id); }
}
