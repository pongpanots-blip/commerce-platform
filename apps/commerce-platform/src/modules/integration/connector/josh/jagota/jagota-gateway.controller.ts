import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../../../shared-kernel/presentation/auth.decorators';
import { StorefrontApiKeyGuard } from '../../../../../storefront/storefront-api-key.guard';
import type { ErpCreateOrderRequest } from './erp-order-request';
import { JagotaGateway } from './jagota-gateway';

/** josh → commerce → Jagota `add-order-create` (josh's storefront API key, like its other commerce calls). */
@Public()
@Controller('v1/storefront/jagota')
@UseGuards(StorefrontApiKeyGuard)
export class JagotaGatewayController {
  constructor(private readonly gateway: JagotaGateway) {}

  @Post('order-create') @HttpCode(HttpStatus.OK)
  createOrder(@Body() body: { request?: ErpCreateOrderRequest }) { return this.gateway.createOrder(body?.request as ErpCreateOrderRequest); }
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
