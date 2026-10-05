import { BadRequestException, Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Query, ServiceUnavailableException } from '@nestjs/common';
import { StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { bangkokRange, JoshInsights, Period, PERIODS } from './josh-insights';
import { NO_REPLICA, SystemHealthReport } from './system-health';
import { parseRestaurantFilters, RestaurantPlaces } from './restaurant-places';
import { ErpLogFilters, JoshErpLogs } from './josh-erp-logs';
import { JoshPushCampaigns } from './josh-push-campaigns';

interface PeriodQuery { period?: string; fromDate?: string; toDate?: string }

const int = (v: unknown, def: number, min: number, max: number) => {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequestException(`${v} must be an integer ${min}-${max}`);
  return n;
};

function range(q: PeriodQuery) {
  const period = (q.period ?? 'this_month') as Period;
  if (!PERIODS.includes(period)) throw new BadRequestException(`period must be one of: ${PERIODS.join(', ')}`);
  try { return bangkokRange(period, Date.now(), q.fromDate, q.toDate); } catch (e) { throw new BadRequestException((e as Error).message); }
}

/**
 * Read-only shop reports for commerce-admin (headless plan phase 1): the same
 * answers the MCP tools give, from josh's read replica — josh is not called.
 * Sales, health, order target group, josh's ERP log: admin only (the guard default).
 * Traffic, restaurants (Market Explorer) and push campaigns: marketing too.
 */
@Controller('reports')
export class ShopReportsController {
  constructor(private readonly insights: JoshInsights, private readonly health: SystemHealthReport, private readonly restaurants: RestaurantPlaces, private readonly erpLogs: JoshErpLogs, private readonly push: JoshPushCampaigns) {}

  private replica() {
    if (!this.insights.available) throw new ServiceUnavailableException(NO_REPLICA.reason);
  }

  @Get('sales')
  sales(@Query() q: PeriodQuery) {
    const r = range(q);
    this.replica();
    return this.insights.sales(r, 20);
  }

  @Get('traffic')
  @StaffRoles('marketing')
  traffic(@Query() q: PeriodQuery) {
    const r = range(q);
    this.replica();
    return this.insights.traffic(r, 20);
  }

  @Get('health')
  systemHealth(@Query() q: PeriodQuery) {
    return this.health.report(range(q).current);
  }

  @Get('order-targetgroup')
  orderTargetgroup(@Query() q: { minShipmentsPerWeek?: string; custCode?: string; limit?: string; offset?: string }) {
    this.replica();
    return this.insights.orderTargetgroup({
      minShipmentsPerWeek: int(q.minShipmentsPerWeek, 0, 0, 7), custCode: q.custCode?.trim() || undefined,
      limit: int(q.limit, 100, 1, 1000), offset: int(q.offset, 0, 0, 1e9),
    });
  }

  @Get('restaurants')
  @StaffRoles('marketing')
  restaurantList(@Query() q: Record<string, string>) {
    const filters = parseRestaurantFilters(q);
    this.replica();
    return this.restaurants.list(filters, int(q.page, 1, 1, 1e6), int(q.limit, 20, 1, 200));
  }

  @Get('restaurants/export')
  @StaffRoles('marketing')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="restaurant-places.csv"')
  async restaurantCsv(@Query() q: Record<string, string>) {
    const filters = parseRestaurantFilters(q);
    this.replica();
    return `\uFEFF${await this.restaurants.csv(filters)}`;
  }

  @Get('restaurants/:id')
  @StaffRoles('marketing')
  async restaurantDetail(@Param('id', ParseUUIDPipe) id: string) {
    this.replica();
    const row = await this.restaurants.detail(id);
    if (!row) throw new NotFoundException(`restaurant place ${id} not found`);
    return row;
  }

  private mongo() {
    if (!this.erpLogs.configured) throw new ServiceUnavailableException('josh\'s log database is not connected on this server (JOSH_MONGO_URL).');
  }

  /** josh's ERP inbound log (josh `GET /api/erp-logs`), from josh's Mongo — payloads include prices and customer codes. */
  @Get('erp-logs')
  erpLogList(@Query() q: ErpLogFilters & { page?: string; limit?: string }) {
    if (q.status && !['ok', 'fail', 'all'].includes(q.status)) throw new BadRequestException('status must be ok, fail or all');
    this.mongo();
    return this.erpLogs.list(q, int(q.page, 1, 1, 1e6), int(q.limit, 50, 1, 200));
  }

  @Get('erp-logs/:id')
  async erpLogDetail(@Param('id') id: string) {
    this.mongo();
    const doc = await this.erpLogs.get(id);
    if (!doc) throw new NotFoundException('ERP log not found (josh keeps them 14 days)');
    return doc;
  }

  /** josh push campaigns, read-only (josh `GET /api/admin/push-campaigns*`). Creating and sending stay in josh. */
  @Get('push-campaigns/overview')
  @StaffRoles('marketing')
  pushOverview() { this.replica(); return this.push.overview(); }

  @Get('push-campaigns')
  @StaffRoles('marketing')
  pushList() { this.replica(); return this.push.list(); }

  @Get('push-campaigns/:id')
  @StaffRoles('marketing')
  pushOne(@Param('id', ParseUUIDPipe) id: string) { this.replica(); return this.push.findOne(id); }

  @Get('push-campaigns/:id/delivery')
  @StaffRoles('marketing')
  pushDelivery(@Param('id', ParseUUIDPipe) id: string) { this.replica(); return this.push.delivery(id); }
}
