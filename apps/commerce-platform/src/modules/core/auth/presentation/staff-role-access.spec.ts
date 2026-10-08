import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { READ_ONLY_STAFF_ROLES, STAFF_ROLES, StaffRole } from '../../../../shared-kernel/presentation/auth.decorators';
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

const jwt = new JwtService({ secret: 'test-secret' });
let account: { id: string; email: string; role: string; status: string; mustChangePassword?: boolean };
const users = { findOne: jest.fn(async () => account) };
const guard = new StaffAuthGuard(jwt, new Reflector(), users as never);

async function hit(role: string, handler: (...args: never[]) => unknown, cls: abstract new (...args: never[]) => unknown, method: string) {
  account = { id: 'u-1', email: 'a@b.c', role, status: 'active' };
  const token = await jwt.signAsync({ sub: 'u-1', email: 'a@b.c', role });
  const request: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` }, method };
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
    expect(STAFF_ROLES).toEqual(['admin', 'marketing', 'merchandising', 'cs', 'sales_manager', 'business_analyst', 'graphic']);
    expect(READ_ONLY_STAFF_ROLES).toEqual(['business_analyst']);
    expect(STAFF_ROLES).not.toContain('sale');
  });

  it('GET /admin/auth/me and POST /admin/auth/password work for every commerce role', async () => {
    for (const role of STAFF_ROLES) {
      await allow(role, StaffAuthController.prototype.me, StaffAuthController, 'GET');
      await allow(role, StaffAuthController.prototype.changePassword, StaffAuthController, 'POST');
    }
  });

  it('a josh sale token is not a commerce-admin login', async () => {
    await deny('sale', StaffAuthController.prototype.me, StaffAuthController, 'GET');
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
  });

  it('cs and marketing stay off the routes this change did not give them', async () => {
    await deny('cs', ProductController.prototype.list, ProductController, 'GET');
    await deny('cs', ShopReportsController.prototype.sales, ShopReportsController, 'GET');
    await deny('marketing', StaffPricesController.prototype.list, StaffPricesController, 'GET');
    await deny('marketing', OrderingController.prototype.periods, OrderingController, 'GET');
    await deny('marketing', GrowthController.prototype.timeline, GrowthController, 'GET');
    await allow('marketing', GrowthController.prototype.workspace, GrowthController, 'GET');
    await allow('marketing', ShopReportsController.prototype.traffic, ShopReportsController, 'GET');
    await deny('marketing', ShopReportsController.prototype.sales, ShopReportsController, 'GET');
  });
});
