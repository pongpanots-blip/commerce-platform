import { BadRequestException, Controller, Get, Param, Query, ServiceUnavailableException } from '@nestjs/common';
import { ApiLogQueryDto } from './api-log/dto/api-log-query.dto';
import { JoshApiLogs } from './josh-api-logs';
import { JoshBackoffice } from './josh-backoffice';
import { joshOnly } from './system-health';

const page = (v?: string) => {
  const n = v ? Number(v) : 1;
  if (!Number.isInteger(n) || n < 1) throw new BadRequestException('page must be a positive integer');
  return n;
};

/**
 * josh back-office lists (KYC, credit, CN/CB, shipments, payments, coupons, campaigns, segments,
 * suppliers, admin access) and josh's API log — READ-ONLY, admin only (the guard default):
 * they hold customer, payment and staff data.
 */
@Controller('reports')
export class JoshBackofficeController {
  constructor(private readonly backoffice: JoshBackoffice, private readonly apiLogs: JoshApiLogs) {}

  @Get('backoffice') views() { return this.backoffice.views(); }

  /** Admin-only under the existing StaffAuthGuard default; no payment mutation endpoint. */
  @Get('payment-transactions/:id')
  paymentDetail(@Param('id') id: string) { return this.backoffice.paymentDetail(id); }

  @Get('backoffice/:view')
  list(@Param('view') view: string, @Query('search') search?: string, @Query('status') status?: string, @Query('page') p?: string) {
    if (!this.backoffice.available) throw joshOnly('backoffice');
    return this.backoffice.list(view, { search, status }, page(p));
  }

  private mongo() {
    if (!this.apiLogs.available) throw new ServiceUnavailableException('josh\'s log Mongo is not connected on this server (JOSH_MONGO_URL).');
  }

  @Get('api-logs/stats') stats(@Query() q: ApiLogQueryDto) { this.mongo(); return this.apiLogs.stats(q); }
  @Get('api-logs') apiLogList(@Query() q: ApiLogQueryDto) { this.mongo(); return this.apiLogs.list(q); }
  @Get('api-logs/:id') apiLog(@Param('id') id: string) { this.mongo(); return this.apiLogs.detail(id); }
}
