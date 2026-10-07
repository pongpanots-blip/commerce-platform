import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { JagotaShadow } from './jagota-shadow';
import { joshOnly } from '../system-health';

/** Shadow mode for orders → Jagota through commerce (admin only, the guard default). Sends nothing. */
@Controller('reports/jagota-shadow')
export class JagotaShadowController {
  constructor(private readonly shadow: JagotaShadow) {}

  private replica() {
    if (!this.shadow.available) throw joshOnly('jagotaShadow');
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

  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string) { return this.shadow.detail(id); }

  /** Check new josh sends now instead of waiting for the cron. Reads josh, writes only commerce's own check rows. */
  @Post('run') @HttpCode(HttpStatus.OK)
  async run() { this.replica(); return { checked: await this.shadow.checkNew() }; }

  @Post('recheck/:joshSyncId') @HttpCode(HttpStatus.OK)
  recheck(@Param('joshSyncId') id: string) { this.replica(); return this.shadow.recheck(id.slice(0, 64)); }
}
