import { BadRequestException, Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Query, ServiceUnavailableException } from '@nestjs/common';
import { StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { bangkokRange, JoshInsights, Period, PERIODS } from './josh-insights';
import { NO_REPLICA, SystemHealthReport } from './system-health';
import { parseRestaurantFilters, RestaurantPlaces } from './restaurant-places';
import { ErpLogFilters, JoshErpLogs } from './josh-erp-logs';
import { JoshPushCampaigns } from './josh-push-campaigns';
import { JoshProducts, ProductFilters } from './josh-products';
import { JoshOrders, OrderFilters } from './josh-orders';
import { CompanyFilters, JoshCustomers } from './josh-customers';
import { JoshPrices } from './josh-prices';

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
  constructor(private readonly insights: JoshInsights, private readonly health: SystemHealthReport, private readonly restaurants: RestaurantPlaces, private readonly erpLogs: JoshErpLogs, private readonly push: JoshPushCampaigns, private readonly products: JoshProducts,
    private readonly orders: JoshOrders, private readonly customers: JoshCustomers, private readonly prices: JoshPrices) {}

  private replica() {
    if (!this.insights.available) throw new ServiceUnavailableException(NO_REPLICA.reason);
  }

  private ordersReady() {
    if (!this.orders.available) throw new ServiceUnavailableException(`${NO_REPLICA.reason} Set ORDERS_SOURCE=copies to read commerce's order copies.`);
  }

  private restaurantsReady() {
    if (!this.restaurants.available) throw new ServiceUnavailableException(`${NO_REPLICA.reason} Set RESTAURANTS_SOURCE=copies to read commerce's copy.`);
  }

  @Get('sales')
  sales(@Query() q: PeriodQuery) {
    const r = range(q);
    if (!this.insights.salesAvailable) throw new ServiceUnavailableException(`${NO_REPLICA.reason} Set SALES_SOURCE=copies to read commerce's order copies.`);
    return this.insights.sales(r, 20);
  }

  /** Replica and order copies for the same period side by side (totals that differ, top-products ranking) — check before SALES_SOURCE=copies. */
  @Get('sales/parity')
  salesParity(@Query() q: PeriodQuery) {
    const r = range(q);
    this.replica();
    return this.insights.salesParity(r, 20);
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
    this.restaurantsReady();
    return this.restaurants.list(filters, int(q.page, 1, 1, 1e6), int(q.limit, 20, 1, 200));
  }

  @Get('restaurants/export')
  @StaffRoles('marketing')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="restaurant-places.csv"')
  async restaurantCsv(@Query() q: Record<string, string>) {
    const filters = parseRestaurantFilters(q);
    this.restaurantsReady();
    return `\uFEFF${await this.restaurants.csv(filters)}`;
  }

  /** Replica vs commerce's copy (counts, enriched, linked to a winback account, newest update) — check before RESTAURANTS_SOURCE=copies. */
  @Get('restaurants/parity')
  @StaffRoles('marketing')
  restaurantParity() {
    this.replica();
    return this.restaurants.parity();
  }

  @Get('restaurants/:id')
  @StaffRoles('marketing')
  async restaurantDetail(@Param('id', ParseUUIDPipe) id: string) {
    this.restaurantsReady();
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

  /** josh catalog, read-only (headless step 3 groundwork). Editing / approving stays in josh admin. */
  @Get('products/summary')
  @StaffRoles('marketing')
  productSummary() { this.replica(); return this.products.summary(); }

  @Get('products/categories')
  @StaffRoles('marketing')
  productCategories() { this.replica(); return this.products.categories(); }

  @Get('products')
  @StaffRoles('marketing')
  productList(@Query() q: ProductFilters & { page?: string; limit?: string }) {
    this.replica();
    return this.products.list(q, int(q.page, 1, 1, 1e6), int(q.limit, 50, 1, 200));
  }

  @Get('products/:idOrSku')
  @StaffRoles('marketing')
  productDetail(@Param('idOrSku') idOrSku: string) { this.replica(); return this.products.detail(idOrSku); }

  // josh orders / customers / prices, read-only — admin only (the guard default).
  @Get('orders/summary') orderSummary(@Query() q: OrderFilters) { this.ordersReady(); return this.orders.summary(q); }
  @Get('orders') orderList(@Query() q: OrderFilters & { page?: string; limit?: string }) {
    this.ordersReady(); return this.orders.list(q, int(q.page, 1, 1, 1e6), int(q.limit, 50, 1, 200));
  }
  @Get('orders/:idOrNumber') orderDetail(@Param('idOrNumber') id: string) { this.ordersReady(); return this.orders.detail(id); }

  @Get('customers/summary') customerSummary() { this.replica(); return this.customers.summary(); }
  @Get('customers') customerList(@Query() q: CompanyFilters & { page?: string; limit?: string }) {
    this.replica(); return this.customers.list(q, int(q.page, 1, 1, 1e6), int(q.limit, 50, 1, 200));
  }
  @Get('customers/:id') customerDetail(@Param('id', ParseUUIDPipe) id: string) { this.replica(); return this.customers.detail(id); }

  @Get('prices/branches') priceBranches(@Query('search') search?: string) { this.replica(); return this.prices.branches(search); }
  @Get('prices/quotations') priceQuotations(@Query('customerCode') code = '') { this.replica(); return this.prices.quotations(code); }
  @Get('prices/branches/:branchId') branchPrices(@Param('branchId', ParseUUIDPipe) id: string, @Query('search') search?: string) {
    this.replica(); return this.prices.forBranch(id, search);
  }
}
