import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../../../shared-kernel/presentation/auth.decorators';
import { StorefrontApiKeyGuard } from '../../../../../storefront/storefront-api-key.guard';
import type { ErpCreateOrderRequest } from './erp-order-request';
import { JagotaGateway } from './jagota-gateway';
import { JagotaSyncHistoryImport } from './jagota-sync-history';
import { joshOnly } from '../system-health';

/** josh → commerce → Jagota `add-order-create` and `create-customer` (josh's storefront API key, like its other commerce calls). */
@Public()
@Controller('v1/storefront/jagota')
@UseGuards(StorefrontApiKeyGuard)
export class JagotaGatewayController {
  constructor(private readonly gateway: JagotaGateway) {}

  @Post('order-create') @HttpCode(HttpStatus.OK)
  createOrder(@Body() body: { request?: ErpCreateOrderRequest }) { return this.gateway.createOrder(body?.request as ErpCreateOrderRequest); }

  @Post('customer-create') @HttpCode(HttpStatus.OK)
  createCustomer(@Body() body: { request?: Record<string, unknown> }) { return this.gateway.createCustomer(body?.request as Record<string, unknown>); }
}

/** What commerce sent to Jagota for josh (admin only, the guard default). */
@Controller('reports/jagota-gateway')
export class JagotaGatewayReportController {
  constructor(private readonly gateway: JagotaGateway) {}

  @Get('summary') summary(@Query('days') days?: string) {
    const d = days ? Number(days) : 7;
    if (!Number.isInteger(d) || d < 1 || d > 90) throw new BadRequestException('days must be 1-90');
    return this.gateway.summary(d);
  }

  @Get() list(@Query('status') status?: string, @Query('page') page = '1') {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
    return this.gateway.list(status || undefined, p);
  }

  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string) { return this.gateway.detail(id); }
}

/** josh's ERP send history copied into commerce (admin only, the guard default). */
@Controller('reports/jagota-sync-history')
export class JagotaSyncHistoryController {
  constructor(private readonly history: JagotaSyncHistoryImport) {}

  @Get('summary') summary(@Query('days') days?: string) {
    const d = days ? Number(days) : 7;
    if (!Number.isInteger(d) || d < 1 || d > 90) throw new BadRequestException('days must be 1-90');
    return this.history.summary(d);
  }

  @Get() list(@Query('status') status?: string, @Query('q') q?: string, @Query('page') page = '1') {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1) throw new BadRequestException('page must be a positive integer');
    return this.history.list({ status: status?.slice(0, 20) || undefined, q: q?.trim().slice(0, 64) || undefined, page: p });
  }

  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string) { return this.history.detail(id); }

  /** Import now instead of waiting for the cron. Reads josh, writes only commerce's copy. */
  @Post('run') @HttpCode(HttpStatus.OK)
  run() {
    if (!this.history.available) throw joshOnly('copier');
    return this.history.importNew();
  }
}
