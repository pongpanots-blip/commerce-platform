import { isUUID } from 'class-validator';
import { SalesRepIdentity } from '../../../core/auth/application/sales-rep-identity.service';
import { BadRequestException, Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, Query, Req, ServiceUnavailableException } from '@nestjs/common';
import { StaffRole, StaffRoles, StaffRequest } from '../../../../shared-kernel/presentation/auth.decorators';
import { bangkokRange, JoshInsights, Period, PERIODS } from './josh-insights';
import { JOSH_ONLY, joshOnly, NO_REPLICA, SystemHealthReport } from './system-health';
import { parseRestaurantFilters, RestaurantPlaces } from './restaurant-places';
import { ErpLogFilters, JoshErpLogs } from './josh-erp-logs';
import { JoshPushCampaigns } from './josh-push-campaigns';
import { JoshProducts, ProductFilters } from './josh-products';
import { JoshOrders, OrderFilters } from './josh-orders';
import { CompanyFilters, JoshCustomers } from './josh-customers';
import { JoshPrices } from './josh-prices';

interface PeriodQuery { period?: string; fromDate?: string; toDate?: string; salesUserId?: string }

/** Shop-report readers besides admin. ERP log payloads stay admin (unredacted). Team customer contacts stay masked; sale reads below explicitly unmask only assigned companies. */
const SHOP: readonly StaffRole[] = ['sales_manager', 'business_analyst'];

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
 * Sales, health, order target group, orders, customers and prices: admin, sales manager and business analyst.
 * Traffic, restaurants, push campaigns: marketing. Product reports: marketing and merchandising.
 * ERP log payloads stay admin (unredacted customer codes and prices).
 */
@Controller('reports')
export class ShopReportsController {
  constructor(private readonly insights: JoshInsights, private readonly health: SystemHealthReport, private readonly restaurants: RestaurantPlaces, private readonly erpLogs: JoshErpLogs, private readonly push: JoshPushCampaigns, private readonly products: JoshProducts,
    private readonly orders: JoshOrders, private readonly customers: JoshCustomers, private readonly prices: JoshPrices, private readonly identity: SalesRepIdentity) {}

  /** Query inputs cannot override own scope. Only admin / sales_manager may choose a team's rep. */
  private async repIds(req: StaffRequest, salesUserId?: string): Promise<string[] | undefined> {
    if (salesUserId !== undefined) {
      if (!isUUID(salesUserId)) throw new BadRequestException('salesUserId must be a uuid');
      if (!['admin', 'sales_manager'].includes(req.staff.role)) throw new BadRequestException('salesUserId is only available to sales managers');
      return [salesUserId.toLowerCase()];
    }
    return req.staff.role === 'sale' ? this.identity.repIdsFor(req.staff) : undefined;
  }

  /** The replica, for routes with no copy yet; `why` says which (josh-admin / not copied) instead of the bare 503. */
  private replica(why?: keyof typeof JOSH_ONLY) {
    if (!this.insights.available) throw why ? joshOnly(why) : new ServiceUnavailableException(NO_REPLICA.reason);
  }

  private ordersReady() {
    if (!this.orders.available) throw new ServiceUnavailableException(`${NO_REPLICA.reason} Set ORDERS_SOURCE=copies to read commerce's order copies.`);
  }

  private productsReady() {
    if (!this.products.available) throw joshOnly('products');
  }

  private pushReady() {
    if (!this.push.available) throw joshOnly('pushCampaigns');
  }

  private restaurantsReady() {
    if (!this.restaurants.available) throw new ServiceUnavailableException(`${NO_REPLICA.reason} Set RESTAURANTS_SOURCE=copies to read commerce's copy.`);
  }

  @Get('sales') @StaffRoles(...SHOP, 'sale')
  async sales(@Query() q: PeriodQuery, @Req() req: StaffRequest) {
    const r = range(q);
    if (!this.insights.salesAvailable) throw new ServiceUnavailableException(`${NO_REPLICA.reason} Set SALES_SOURCE=copies to read commerce's order copies.`);
    return this.insights.sales(r, 20, undefined, await this.repIds(req, q.salesUserId));
  }

  @Get('sales/by-rep') @StaffRoles('sales_manager')
  salesByRep(@Query() q: PeriodQuery) {
    if (!this.insights.salesAvailable) throw new ServiceUnavailableException(NO_REPLICA.reason);
    return this.insights.salesByRep(range(q).current);
  }

  /** Replica and order copies for the same period side by side (totals that differ, top-products ranking) — check before SALES_SOURCE=copies. */
  @Get('sales/parity') @StaffRoles(...SHOP)
  salesParity(@Query() q: PeriodQuery) {
    const r = range(q);
    this.replica();
    return this.insights.salesParity(r, 20);
  }

  @Get('traffic')
  @StaffRoles('marketing')
  traffic(@Query() q: PeriodQuery) {
    const r = range(q);
    this.replica('traffic');
    return this.insights.traffic(r, 20);
  }

  @Get('health') @StaffRoles(...SHOP)
  systemHealth(@Query() q: PeriodQuery) {
    return this.health.report(range(q).current);
  }

  @Get('order-targetgroup') @StaffRoles(...SHOP)
  orderTargetgroup(@Query() q: { minShipmentsPerWeek?: string; custCode?: string; limit?: string; offset?: string }) {
    this.replica('orderTargetgroup');
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
  pushOverview() { this.pushReady(); return this.push.overview(); }

  @Get('push-campaigns')
  @StaffRoles('marketing')
  pushList() { this.pushReady(); return this.push.list(); }

  @Get('push-campaigns/:id')
  @StaffRoles('marketing')
  pushOne(@Param('id', ParseUUIDPipe) id: string) { this.pushReady(); return this.push.findOne(id); }

  @Get('push-campaigns/:id/delivery')
  @StaffRoles('marketing')
  pushDelivery(@Param('id', ParseUUIDPipe) id: string) { this.pushReady(); return this.push.delivery(id); }

  /** josh catalog, read-only (headless step 3 groundwork) — marketing and MER (stage 6). */
  @Get('products/summary')
  @StaffRoles('marketing', 'merchandising')
  productSummary() { this.productsReady(); return this.products.summary(); }

  @Get('products/categories')
  @StaffRoles('marketing', 'merchandising')
  productCategories() { this.productsReady(); return this.products.categories(); }

  @Get('products')
  @StaffRoles('marketing', 'merchandising')
  productList(@Query() q: ProductFilters & { page?: string; limit?: string }) {
    this.productsReady();
    return this.products.list(q, int(q.page, 1, 1, 1e6), int(q.limit, 50, 1, 200));
  }

  @Get('products/:idOrSku')
  @StaffRoles('marketing', 'merchandising')
  productDetail(@Param('idOrSku') idOrSku: string) { this.productsReady(); return this.products.detail(idOrSku); }

  // Only the specific reads below include sale; operational reports retain SHOP's team roles.
  @Get('orders/summary') @StaffRoles(...SHOP, 'sale')
  async orderSummary(@Query() q: OrderFilters & { salesUserId?: string }, @Req() req: StaffRequest) {
    this.ordersReady(); return this.orders.summary({ ...q, repIds: await this.repIds(req, q.salesUserId) });
  }
  @Get('orders') @StaffRoles(...SHOP, 'sale')
  async orderList(@Query() q: OrderFilters & { page?: string; limit?: string; salesUserId?: string }, @Req() req: StaffRequest) {
    this.ordersReady(); return this.orders.list({ ...q, repIds: await this.repIds(req, q.salesUserId) }, int(q.page, 1, 1, 1e6), int(q.limit, 50, 1, 200));
  }
  @Get('orders/:idOrNumber') @StaffRoles(...SHOP, 'sale')
  async orderDetail(@Param('idOrNumber') id: string, @Req() req: StaffRequest) { this.ordersReady(); return this.orders.detail(id, await this.repIds(req)); }

  @Get('customers/summary') @StaffRoles(...SHOP, 'sale')
  async customerSummary(@Query() q: { salesUserId?: string }, @Req() req: StaffRequest) {
    this.replica('customers'); return this.customers.summary({ repIds: await this.repIds(req, q.salesUserId) });
  }
  @Get('customers') @StaffRoles(...SHOP, 'sale')
  async customerList(@Query() q: CompanyFilters & { page?: string; limit?: string; salesUserId?: string }, @Req() req: StaffRequest) {
    this.replica('customers'); return this.customers.list({ ...q, repIds: await this.repIds(req, q.salesUserId) }, int(q.page, 1, 1, 1e6), int(q.limit, 50, 1, 200), { unmask: req.staff.role === 'sale' });
  }
  @Get('customers/:id') @StaffRoles(...SHOP, 'sale')
  async customerDetail(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest) {
    this.replica('customers'); return this.customers.detail(id, await this.repIds(req), { unmask: req.staff.role === 'sale' });
  }

  @Get('prices/branches') @StaffRoles(...SHOP, 'sale')
  async priceBranches(@Req() req: StaffRequest, @Query('search') search?: string) { this.replica('prices'); return this.prices.branches(search, await this.repIds(req)); }
  @Get('prices/quotations') @StaffRoles(...SHOP, 'sale')
  async priceQuotations(@Req() req: StaffRequest, @Query('customerCode') code = '') { this.replica('prices'); return this.prices.quotations(code, await this.repIds(req)); }
  @Get('prices/branches/:branchId') @StaffRoles(...SHOP, 'sale')
  async branchPrices(@Param('branchId', ParseUUIDPipe) id: string, @Req() req: StaffRequest, @Query('search') search?: string) {
    this.replica('prices'); return this.prices.forBranch(id, search, undefined, await this.repIds(req));
  }
}
