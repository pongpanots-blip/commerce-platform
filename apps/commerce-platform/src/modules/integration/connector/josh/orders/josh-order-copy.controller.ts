import { Controller, Get, HttpCode, HttpStatus, Logger, Param, ParseUUIDPipe, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Public } from '../../../../../shared-kernel/presentation/auth.decorators';
import { StorefrontApiKeyGuard } from '../../../../../storefront/storefront-api-key.guard';
import { TrustedStorefrontKey } from '../../../../../storefront/trusted-storefront-key';
import { JoshOrderCopyService } from './josh-order-copy';
import { joshOnly } from '../system-health';

/** josh, right after a checkout (ORDERS_COPY_TO_COMMERCE): "copy this order now". Answers at once; josh never waits on the copy. */
@Public()
@Controller('v1/storefront/josh-orders')
@UseGuards(StorefrontApiKeyGuard)
@TrustedStorefrontKey()
export class JoshOrderPlacedController {
  private readonly logger = new Logger(JoshOrderPlacedController.name);
  constructor(private readonly copies: JoshOrderCopyService) {}

  @Post(':id/placed') @HttpCode(HttpStatus.ACCEPTED)
  placed(@Param('id', ParseUUIDPipe) id: string) {
    if (!this.copies.available) throw new ServiceUnavailableException('josh replica not connected here — the copy cron catches up');
    void this.copies.copyOne(id).then((ok) => { if (!ok) this.logger.warn(`josh order ${id} not on the replica yet — the cron will copy it`); })
      .catch((e) => this.logger.warn(`copy of josh order ${id} failed: ${e instanceof Error ? e.message : e}`));
    return { accepted: true };
  }
}

/** The copy's state (admin only, the guard default). */
@Controller('reports/order-copy')
export class JoshOrderCopyReportController {
  constructor(private readonly copies: JoshOrderCopyService) {}

  @Get('summary') summary() { return this.copies.summary(); }

  @Post('run') @HttpCode(HttpStatus.OK)
  run() {
    if (!this.copies.available) throw joshOnly('copier');
    return this.copies.copyNew();
  }
}
