import { JoshAdminCallController } from '../../../integration/connector/josh/josh-admin-call.controller';
import { McpConnectionsController } from '../../../../mcp/mcp-connections.controller';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { READ_ONLY_STAFF_ROLES, STAFF_ROLES, StaffRole, normalizeStaffRole } from '../../../../shared-kernel/presentation/auth.decorators';
import { JOSH_STAFF_ROLES } from '../../../integration/customers/josh-staff-access.service';
import { CompetitorPricesController } from '../../../integration/competitor-prices/competitor-prices.controller';
import { SalesRepsController } from '../../../integration/customers/sales-reps.controller';
import { GrowthController } from '../../../integration/growth/growth.controller';
import { ShopReportsController } from '../../../integration/connector/josh/shop-reports.controller';
import { WinbackReportsController } from '../../../integration/winback/winback-reports.controller';
import { InventoryController } from '../../../commerce/inventory/presentation/inventory.controller';
import { InventoryOverviewController } from '../../../commerce/inventory/presentation/inventory-overview.controller';
import { StockMovesController } from '../../../commerce/inventory/presentation/stock-moves.controller';
import { OrderingController } from '../../../commerce/ordering/ordering.controller';
import { OrderController } from '../../../commerce/order/presentation/order.controller';
import { ProductController } from '../../../commerce/product/presentation/product.controller';
import { ProductCategoriesController } from '../../../commerce/product-categories/product-categories.controller';
import { ProductImagesController } from '../../../commerce/product-images/product-images.controller';
import { ProductPromotionRulesController } from '../../../commerce/product-promotion-rules/product-promotion-rules.controller';
import { CustomerController } from '../../../commerce/customer/presentation/customer.controller';
import { StaffPricesController } from '../../../integration/connector/josh/pricing/staff-prices.controller';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthGuard } from './staff-auth.guard';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { STAFF_ROLES_KEY } from '../../../../shared-kernel/presentation/auth.decorators';

const jwt = new JwtService({ secret: 'test-secret' });
let account: { id: string; email: string; role: string; status: string; mustChangePassword?: boolean };
const users = { findOne: jest.fn(async () => account) };
const guard = new StaffAuthGuard(jwt, new Reflector(), users as never);

let lastRequest: Record<string, unknown>;
async function hit(role: string, handler: (...args: never[]) => unknown, cls: abstract new (...args: never[]) => unknown, method: string, tokenRole = role, signer = jwt) {
  account = { id: 'u-1', email: 'a@b.c', role, status: 'active' };
  const token = await signer.signAsync({ sub: 'u-1', email: 'a@b.c', role: tokenRole });
  const request: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` }, method };
  lastRequest = request;
  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return guard.canActivate(context);
}

const allow = async (role: StaffRole, handler: (...args: never[]) => unknown, cls: abstract new (...args: never[]) => unknown, method: string) => {
  await expect(hit(role, handler, cls, method)).resolves.toBe(true);
};
const deny = async (role: string, handler: (...args: never[]) => unknown, cls: abstract new (...args: never[]) => unknown, method: string) => {
  await expect(hit(role, handler, cls, method)).rejects.toBeInstanceOf(ForbiddenException);
};

describe('staff role access', () => {
  it('keeps commerce-only roles off the josh staff.access list (josh would 422)', () => {
    expect(JOSH_STAFF_ROLES).toEqual(['cs', 'marketing', 'merchandising', 'sale', 'sales', 'manager', 'admin', 'dev']);
    expect(JOSH_STAFF_ROLES).not.toEqual(expect.arrayContaining(['business_analyst', 'graphic', 'sales_manager', 'platform_admin', 'sale_manager']));
    expect(STAFF_ROLES).toEqual(['admin', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'business_analyst', 'graphic']);
    expect(READ_ONLY_STAFF_ROLES).toEqual(['business_analyst', 'sale']);
    expect(STAFF_ROLES).not.toContain('manager');
  });

  it('GET /admin/auth/me and POST /admin/auth/password work for every commerce role', async () => {
    for (const role of STAFF_ROLES) {
      await allow(role, StaffAuthController.prototype.me, StaffAuthController, 'GET');
      await allow(role, StaffAuthController.prototype.changePassword, StaffAuthController, 'POST');
    }
  });

  it('Josh tokens still fail signature verification; the commerce DB row is authoritative', async () => {
    await expect(hit('sale', StaffAuthController.prototype.me, StaffAuthController, 'GET', 'sale', new JwtService({ secret: 'josh-test-secret' }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(hit('manager', StaffAuthController.prototype.me, StaffAuthController, 'GET', 'sale')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(hit('graphic', ShopReportsController.prototype.sales, ShopReportsController, 'GET', 'sale')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('business analyst is GET-only on the analyst routes and blocked elsewhere', async () => {
    const ba = 'business_analyst' as const;
    await allow(ba, ShopReportsController.prototype.sales, ShopReportsController, 'GET');
    await allow(ba, ShopReportsController.prototype.customerDetail, ShopReportsController, 'GET');
    await allow(ba, WinbackReportsController.prototype.overview, WinbackReportsController, 'GET');
    await allow(ba, InventoryOverviewController.prototype.overview, InventoryOverviewController, 'GET');
    await allow(ba, OrderController.prototype.list, OrderController, 'GET');
    await allow(ba, OrderController.prototype.full, OrderController, 'GET');
    await allow(ba, CompetitorPricesController.prototype.list, CompetitorPricesController, 'GET');
    await allow(ba, GrowthController.prototype.timeline, GrowthController, 'GET');
    await allow(ba, GrowthController.prototype.workspace, GrowthController, 'GET');
    await deny(ba, ShopReportsController.prototype.traffic, ShopReportsController, 'GET');
    await deny(ba, ShopReportsController.prototype.restaurantList, ShopReportsController, 'GET');
    await deny(ba, ShopReportsController.prototype.pushDelivery, ShopReportsController, 'GET');
    await deny(ba, ShopReportsController.prototype.productList, ShopReportsController, 'GET');
    // listed on the class, still refused: read-only is the method, not the decorator
    await deny(ba, CompetitorPricesController.prototype.create, CompetitorPricesController, 'POST');
    await deny(ba, GrowthController.prototype.create, GrowthController, 'POST');
    await deny(ba, OrderController.prototype.create, OrderController, 'POST');
    await deny(ba, OrderController.prototype.checkout, OrderController, 'POST');
    await deny(ba, ShopReportsController.prototype.erpLogDetail, ShopReportsController, 'GET');
    await deny(ba, CustomerController.prototype.list, CustomerController, 'GET');
    await deny(ba, SalesRepsController.prototype.assign, SalesRepsController, 'PATCH');
    await deny(ba, ProductImagesController.prototype.upload, ProductImagesController, 'POST');
  });

  it('merchandise keeps catalog access and gains stock, rounds, promotions and staff prices', async () => {
    const mer = 'merchandising' as const;
    await allow(mer, ProductCategoriesController.prototype.create, ProductCategoriesController, 'POST');
    await allow(mer, ProductCategoriesController.prototype.upload, ProductCategoriesController, 'POST');
    await allow(mer, ProductCategoriesController.prototype.update, ProductCategoriesController, 'PATCH');
    await allow(mer, ProductCategoriesController.prototype.remove, ProductCategoriesController, 'DELETE');
    await allow(mer, ProductCategoriesController.prototype.reorderLevel1, ProductCategoriesController, 'PUT');
    await allow(mer, ProductCategoriesController.prototype.reorderChildren, ProductCategoriesController, 'PUT');
    await allow('admin', ProductCategoriesController.prototype.upload, ProductCategoriesController, 'POST');
    await allow('admin', ProductCategoriesController.prototype.update, ProductCategoriesController, 'PATCH');
    await allow(mer, ProductController.prototype.list, ProductController, 'GET');
    await allow(mer, ProductController.prototype.create, ProductController, 'POST');
    await allow(mer, InventoryController.prototype.list, InventoryController, 'GET');
    await allow(mer, InventoryOverviewController.prototype.overview, InventoryOverviewController, 'GET');
    await allow(mer, StockMovesController.prototype.adjust, StockMovesController, 'POST');
    await allow(mer, OrderingController.prototype.periods, OrderingController, 'GET');
    await allow(mer, ProductPromotionRulesController.prototype.edit, ProductPromotionRulesController, 'POST');
    await allow(mer, StaffPricesController.prototype.list, StaffPricesController, 'GET');
    await allow(mer, ShopReportsController.prototype.productList, ShopReportsController, 'GET');
    await deny(mer, OrderingController.prototype.republish, OrderingController, 'POST');
    await deny(mer, StockMovesController.prototype.resend, StockMovesController, 'POST');
    await deny(mer, OrderController.prototype.list, OrderController, 'GET');
    await deny(mer, ShopReportsController.prototype.sales, ShopReportsController, 'GET');
    await deny(mer, CustomerController.prototype.list, CustomerController, 'GET');
  });

  it('graphic edits images and reads products, and cannot price or create them', async () => {
    const graphic = 'graphic' as const;
    await allow(graphic, ProductImagesController.prototype.upload, ProductImagesController, 'POST');
    await allow(graphic, ProductImagesController.prototype.get, ProductImagesController, 'GET');
    await allow(graphic, ProductController.prototype.list, ProductController, 'GET');
    await allow(graphic, ProductController.prototype.get, ProductController, 'GET');
    await deny(graphic, ProductController.prototype.create, ProductController, 'POST');
    await deny(graphic, ProductCategoriesController.prototype.create, ProductCategoriesController, 'POST');
    await deny(graphic, ProductCategoriesController.prototype.upload, ProductCategoriesController, 'POST');
    await deny(graphic, StaffPricesController.prototype.create, StaffPricesController, 'POST');
    await deny(graphic, ShopReportsController.prototype.sales, ShopReportsController, 'GET');
    await deny(graphic, OrderController.prototype.list, OrderController, 'GET');
  });

  it('sales manager reads shop and winback reports and can assign a sales rep', async () => {
    const mgr = 'sales_manager' as const;
    await allow(mgr, ShopReportsController.prototype.sales, ShopReportsController, 'GET');
    await allow(mgr, ShopReportsController.prototype.orderList, ShopReportsController, 'GET');
    await allow(mgr, WinbackReportsController.prototype.teamStats, WinbackReportsController, 'GET');
    await allow(mgr, SalesRepsController.prototype.assign, SalesRepsController, 'PATCH');
    await deny(mgr, CompetitorPricesController.prototype.list, CompetitorPricesController, 'GET');
    await deny(mgr, ProductController.prototype.create, ProductController, 'POST');
    await deny(mgr, OrderController.prototype.create, OrderController, 'POST');
    await deny(mgr, ShopReportsController.prototype.erpLogList, ShopReportsController, 'GET');
    await deny(mgr, ShopReportsController.prototype.traffic, ShopReportsController, 'GET');
    await deny(mgr, ShopReportsController.prototype.restaurantList, ShopReportsController, 'GET');
    await deny(mgr, ShopReportsController.prototype.pushDelivery, ShopReportsController, 'GET');
    await deny(mgr, ShopReportsController.prototype.productList, ShopReportsController, 'GET');
  });

  it('cs and marketing stay off the routes this change did not give them', async () => {
    await deny('cs', ProductController.prototype.list, ProductController, 'GET');
    await deny('cs', ShopReportsController.prototype.sales, ShopReportsController, 'GET');
    await deny('marketing', ProductCategoriesController.prototype.upload, ProductCategoriesController, 'POST');
    await deny('marketing', ProductCategoriesController.prototype.update, ProductCategoriesController, 'PATCH');
    await deny('cs', ProductCategoriesController.prototype.reorderLevel1, ProductCategoriesController, 'PUT');
    await deny('marketing', StaffPricesController.prototype.list, StaffPricesController, 'GET');
    await deny('marketing', OrderingController.prototype.periods, OrderingController, 'GET');
    await deny('marketing', GrowthController.prototype.timeline, GrowthController, 'GET');
    await allow('marketing', GrowthController.prototype.workspace, GrowthController, 'GET');
    await allow('marketing', ShopReportsController.prototype.traffic, ShopReportsController, 'GET');
    await deny('marketing', ShopReportsController.prototype.sales, ShopReportsController, 'GET');
  });
});


describe('sale / manager access matrix (real global guard, method overrides included)', () => {
  const endpoints: Array<[Function, Function, string, string[]]> = [
    [ShopReportsController.prototype.sales, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.customerSummary, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.customerList, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.customerDetail, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.orderSummary, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.orderList, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.orderDetail, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.priceBranches, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.branchPrices, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.priceQuotations, ShopReportsController, 'GET', ['sale', 'sales_manager']],
    [ShopReportsController.prototype.salesByRep, ShopReportsController, 'GET', ['sales_manager']],
    [ShopReportsController.prototype.systemHealth, ShopReportsController, 'GET', ['sales_manager']],
    [ShopReportsController.prototype.salesParity, ShopReportsController, 'GET', ['sales_manager']],
    [ShopReportsController.prototype.orderTargetgroup, ShopReportsController, 'GET', ['sales_manager']],
    [WinbackReportsController.prototype.teamOpportunities, WinbackReportsController, 'GET', ['sales_manager']],
    [WinbackReportsController.prototype.myOpportunities, WinbackReportsController, 'GET', ['sale']],
    [WinbackReportsController.prototype.myPool, WinbackReportsController, 'GET', ['sale']],
    [WinbackReportsController.prototype.overview, WinbackReportsController, 'GET', ['sales_manager']],
    [WinbackReportsController.prototype.pool, WinbackReportsController, 'GET', ['sales_manager']],
    [WinbackReportsController.prototype.aging, WinbackReportsController, 'GET', ['sales_manager']],
    [WinbackReportsController.prototype.scorecard, WinbackReportsController, 'GET', ['sales_manager']],
    [WinbackReportsController.prototype.dashboard, WinbackReportsController, 'GET', ['sales_manager']],
    [WinbackReportsController.prototype.teamStats, WinbackReportsController, 'GET', ['sales_manager']],
    [WinbackReportsController.prototype.leadSignals, WinbackReportsController, 'GET', ['sales_manager']],
    [SalesRepsController.prototype.list, SalesRepsController, 'GET', ['sales_manager']],
    [SalesRepsController.prototype.assign, SalesRepsController, 'PATCH', ['sales_manager']],
    [ProductController.prototype.list, ProductController, 'GET', ['sale', 'graphic']],
    [ProductController.prototype.get, ProductController, 'GET', ['sale', 'graphic']],
    [ProductController.prototype.create, ProductController, 'POST', []],
    [ProductController.prototype.update, ProductController, 'PATCH', []],
    [InventoryController.prototype.list, InventoryController, 'GET', ['sale']],
    [InventoryOverviewController.prototype.overview, InventoryOverviewController, 'GET', ['sale']],
    [StockMovesController.prototype.adjust, StockMovesController, 'POST', []],
    [ShopReportsController.prototype.erpLogList, ShopReportsController, 'GET', []],
    [CustomerController.prototype.list, CustomerController, 'GET', []],
    [GrowthController.prototype.workspace, GrowthController, 'GET', []],
    [StaffAuthController.prototype.me, StaffAuthController, 'GET', ['sale', 'sales_manager', 'graphic']],
    [StaffAuthController.prototype.changePassword, StaffAuthController, 'POST', ['sale', 'sales_manager', 'graphic']],
  ];
  it.each(['sale', 'sales_manager', 'sale_manager', 'manager', 'admin', 'graphic'])('%s follows the endpoint policy', async role => {
    for (const [handler, cls, method, allowed] of endpoints) {
      const call = hit(role, handler as never, cls as never, method);
      if (role === 'admin' || allowed.includes(normalizeStaffRole(role))) {
        await expect(call).resolves.toBe(true);
        expect(lastRequest.staff).toMatchObject({ role: normalizeStaffRole(role) });
      } else await expect(call).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
  it('sale is GET/HEAD only even for an allowed read path', async () => {
    await deny('sale', ShopReportsController.prototype.sales, ShopReportsController, 'POST');
    await deny('sale', ProductController.prototype.list, ProductController, 'PATCH');
    await allow('sale', ProductController.prototype.list, ProductController, 'HEAD');
  });
  it('sale cannot enter the Josh relay or MCP', async () => {
    // Class permissions apply regardless of a handler without its own decorator.
    const handler = () => undefined;
    await deny('sale', handler, JoshAdminCallController, 'GET');
    await deny('sale', handler, McpConnectionsController, 'GET');
  });
});

describe('cs desk read access (permission change: CS desk order-on-behalf searches)', () => {
  const CS_READS = ['customerList', 'customerDetail', 'productList'];
  const proto = ShopReportsController.prototype as unknown as Record<string, (...args: never[]) => unknown>;
  const handlers = Object.getOwnPropertyNames(ShopReportsController.prototype)
    .filter(name => name !== 'constructor' && Reflect.getMetadata(METHOD_METADATA, proto[name]) !== undefined);

  it('lists cs on exactly the three CS desk GETs of the shop reports', () => {
    expect(handlers.filter(name => (Reflect.getMetadata(STAFF_ROLES_KEY, proto[name]) ?? []).includes('cs')).sort()).toEqual([...CS_READS].sort());
    for (const name of CS_READS) expect(Reflect.getMetadata(METHOD_METADATA, proto[name])).toBe(RequestMethod.GET);
  });

  it.each(['cs', 'CS', ' cs '])('%s (normalised) passes the guard as cs on the three reads and nowhere else in reports', async role => {
    expect(handlers.length).toBeGreaterThanOrEqual(29); // every GET in the controller, including routes added later
    for (const name of handlers) {
      const call = hit(role, proto[name], ShopReportsController, 'GET');
      if (CS_READS.includes(name)) {
        await expect(call).resolves.toBe(true);
        expect(lastRequest.staff).toMatchObject({ role: 'cs' });
      } else await expect(call).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('named refusals: summaries, categories, product detail, orders, prices, sales, CSV export', async () => {
    for (const name of ['customerSummary', 'productSummary', 'productCategories', 'productDetail', 'orderSummary', 'orderList', 'orderDetail',
      'priceBranches', 'priceQuotations', 'branchPrices', 'sales', 'salesByRep', 'salesParity', 'restaurantCsv', 'erpLogList', 'erpLogDetail']) {
      await deny('cs', proto[name], ShopReportsController, 'GET');
    }
  });

  it('gains no write anywhere (sampled)', async () => {
    await deny('cs', ProductController.prototype.create, ProductController, 'POST');
    await deny('cs', ProductController.prototype.update, ProductController, 'PATCH');
    await deny('cs', OrderController.prototype.create, OrderController, 'POST');
    await deny('cs', OrderController.prototype.checkout, OrderController, 'POST');
    await deny('cs', ProductCategoriesController.prototype.remove, ProductCategoriesController, 'DELETE');
    await deny('cs', ProductImagesController.prototype.upload, ProductImagesController, 'POST');
    await deny('cs', StaffPricesController.prototype.create, StaffPricesController, 'POST');
    await deny('cs', StockMovesController.prototype.adjust, StockMovesController, 'POST');
    await deny('cs', SalesRepsController.prototype.assign, SalesRepsController, 'PATCH');
    await deny('cs', CompetitorPricesController.prototype.create, CompetitorPricesController, 'POST');
    await deny('cs', GrowthController.prototype.create, GrowthController, 'POST');
    await deny('cs', CustomerController.prototype.list, CustomerController, 'GET');
  });

  it('other roles on the three handlers are unchanged', async () => {
    for (const name of ['customerList', 'customerDetail']) {
      for (const role of ['admin', 'sale', 'sales_manager', 'sale_manager', 'business_analyst']) await expect(hit(role, proto[name], ShopReportsController, 'GET')).resolves.toBe(true);
      for (const role of ['marketing', 'merchandising', 'graphic']) await deny(role, proto[name], ShopReportsController, 'GET');
    }
    for (const role of ['admin', 'marketing', 'merchandising']) await expect(hit(role, proto.productList, ShopReportsController, 'GET')).resolves.toBe(true);
    for (const role of ['sale', 'sales_manager', 'sale_manager', 'business_analyst', 'graphic']) await deny(role, proto.productList, ShopReportsController, 'GET');
    await expect(hit('sale_manager', proto.customerList, ShopReportsController, 'GET')).resolves.toBe(true);
    expect(lastRequest.staff).toMatchObject({ role: 'sales_manager' });
  });
});
