import { ownsPromotions, ProductPromotionRulesService } from '../../../commerce/product-promotion-rules/product-promotion-rules.service';
import { splitPromotionRules } from '../../../commerce/product-promotion-rules/promotion-rules';
import { Body, Controller, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { winbackOwnedByCommerce } from '../../winback/shared/winback.config';
import { ownsSalesReps, SalesRepsService } from '../../customers/sales-reps.service';
import { ownsPrices, ProductPricesService } from '../../../commerce/product-prices/product-prices.service';
import { ownsProductContent, ProductContentsService } from '../../../commerce/product-contents/product-contents.service';
import { splitContent } from '../../../commerce/product-contents/content-fields';
import { ownsProductMaster, ProductMastersService } from '../../../commerce/product-masters/product-masters.service';
import { splitMaster } from '../../../commerce/product-masters/master-fields';
import { OrderingService, ownsOrdering } from '../../../commerce/ordering/ordering.service';
import { splitLogistics } from '../../../commerce/ordering/logistics-fields';
import type { WinbackStaffActions } from '../../winback/winback-staff-actions';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { JoshActions } from './josh-actions';
import { JoshCatalogSyncService } from './josh-catalog-sync.service';

/**
 * commerce-admin buttons that ask josh to act (winback, push campaigns, credit applications, admin
 * access, coupon on/off). Bodies are passed through to josh, which validates them with its own DTOs
 * and rules (manager-only targets, marketing editors for push, platform_admin for admin access).
 * Admin (guard default); push and coupon on/off: marketing too.
 */
@Controller('josh')
export class JoshActionsController {
  constructor(private readonly josh: JoshActions, private readonly catalog: JoshCatalogSyncService, private readonly modules: ModuleRef) {}

  private as(req: StaffRequest) { return { userId: req.staff.userId, email: req.staff.email }; }

  /** Winback buttons: commerce's own winback once it runs it (WINBACK_OWNER=commerce), otherwise josh's. */
  private async winback(action: 'assign' | 'move_stage' | 'set_target', args: Record<string, unknown>, req: StaffRequest) {
    if (!winbackOwnedByCommerce()) return this.josh.run('winback', action, args, this.as(req), 'admin');
    // Resolved lazily: WinbackModule imports this module, so this one cannot import it.
    const { WinbackStaffActions: cls } = await import('../../winback/winback-staff-actions');
    return this.modules.get<WinbackStaffActions>(cls, { strict: false }).act(action, args, req.staff.email);
  }

  @Post('winback/accounts/:id/assign') @HttpCode(HttpStatus.OK)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() b: { assignedSalesUserId?: string | null }, @Req() req: StaffRequest) {
    return this.winback('assign', { accountId: id, assignedSalesUserId: b?.assignedSalesUserId ?? null }, req);
  }

  @Post('winback/accounts/:id/stage') @HttpCode(HttpStatus.OK)
  moveStage(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @Req() req: StaffRequest) {
    return this.winback('move_stage', { ...b, accountId: id }, req);
  }

  @Put('winback/targets')
  setTarget(@Body() b: Record<string, unknown>, @Req() req: StaffRequest) {
    return this.winback('set_target', b ?? {}, req);
  }

  @Post('push-campaigns') @HttpCode(HttpStatus.OK) @StaffRoles('marketing')
  createCampaign(@Body() campaign: Record<string, unknown>, @Req() req: StaffRequest) {
    return this.josh.run('push-campaigns', 'create', { campaign }, this.as(req), 'admin');
  }

  @Post('push-campaigns/:id/schedule') @HttpCode(HttpStatus.OK) @StaffRoles('marketing')
  schedule(@Param('id', ParseUUIDPipe) id: string, @Body() b: { scheduledAt?: string }, @Req() req: StaffRequest) {
    return this.josh.run('push-campaigns', 'schedule', { id, scheduledAt: b?.scheduledAt }, this.as(req), 'admin');
  }

  @Post('push-campaigns/:id/send') @HttpCode(HttpStatus.OK) @StaffRoles('marketing')
  send(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest) {
    return this.josh.run('push-campaigns', 'send', { id }, this.as(req), 'admin');
  }

  @Post('push-campaigns/:id/test') @HttpCode(HttpStatus.OK) @StaffRoles('marketing')
  test(@Param('id', ParseUUIDPipe) id: string, @Body() b: { userId?: string }, @Req() req: StaffRequest) {
    return this.josh.run('push-campaigns', 'test', { id, userId: b?.userId }, this.as(req), 'admin');
  }

  @Post('credit-applications/:id/review') @HttpCode(HttpStatus.OK)
  reviewCredit(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @Req() req: StaffRequest) {
    const { status, approved_credit_limit, approved_term_days, reject_reason, accounting_remark } = b ?? {};
    return this.josh.run('credit-applications', 'review', { applicationId: id, status, approved_credit_limit, approved_term_days, reject_reason, accounting_remark }, this.as(req), 'admin');
  }

  @Post('admin-access/:id/approve') @HttpCode(HttpStatus.OK)
  approveAccess(@Param('id', ParseUUIDPipe) id: string, @Body() b: { role?: string }, @Req() req: StaffRequest) {
    return this.josh.run('admin-access', 'approve', { requestId: id, role: b?.role }, this.as(req), 'admin');
  }

  @Post('admin-access/:id/reject') @HttpCode(HttpStatus.OK)
  rejectAccess(@Param('id', ParseUUIDPipe) id: string, @Body() b: { reason?: string }, @Req() req: StaffRequest) {
    return this.josh.run('admin-access', 'reject', { requestId: id, reason: b?.reason }, this.as(req), 'admin');
  }

  @Post('coupons/:id/active') @HttpCode(HttpStatus.OK) @StaffRoles('marketing')
  setCouponActive(@Param('id', ParseUUIDPipe) id: string, @Body() b: { isActive?: boolean }, @Req() req: StaffRequest) {
    return this.josh.run('coupons', 'set_active', { couponId: id, isActive: b?.isActive }, this.as(req), 'admin');
  }

  /** Approve / reject staged ERP product and price changes (josh applies them; ids only, max 200). */
  @Post('products/approve') @HttpCode(HttpStatus.OK) @StaffRoles('merchandising')
  approveProducts(@Body() b: { ids?: string[] }, @Req() req: StaffRequest) {
    return this.josh.run('products', 'approve', { ids: Array.isArray(b?.ids) ? b.ids.slice(0, 200) : [] }, this.as(req), 'admin');
  }

  @Post('products/reject') @HttpCode(HttpStatus.OK) @StaffRoles('merchandising')
  rejectProducts(@Body() b: { ids?: string[] }, @Req() req: StaffRequest) {
    return this.josh.run('products', 'reject', { ids: Array.isArray(b?.ids) ? b.ids.slice(0, 200) : [] }, this.as(req), 'admin');
  }

  /**
   * Edit one product's master data (COMMERCE_OWNS_CATALOG): josh's ProductService.update writes it,
   * josh rejects fields it does not allow from commerce. Commerce's catalog copy is refreshed right away.
   * Stage 4a / 4b / 4d / 4f: the base price, the content keys, the ERP master keys and the logistics keys are commerce's once
   * it owns them — saved here and sent to josh as product.price / content / master / logistics.snapshot; the rest of the
   * form still goes to josh.
   */
  @Post('products/:id/update') @HttpCode(HttpStatus.OK) @StaffRoles('merchandising')
  async updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() b: { fields?: Record<string, unknown> }, @Req() req: StaffRequest) {
    const promotion = ownsPromotions() ? splitPromotionRules(plain(b?.fields)) : { rules: undefined, rest: plain(b?.fields) };
    const { selling_unit_price: price, ...others } = promotion.rest;
    const ownPrice = price !== undefined && price !== '' && ownsPrices();
    // Validated before anything is written (400 on a bad value).
    const { content, rest: afterContent } = ownsProductContent() ? splitContent(others) : { content: {}, rest: others };
    // Stage 4d: status, category, brand name, units, pack … once commerce owns the ERP product master.
    const { master, categoryId, rest: afterMaster } = ownsProductMaster() ? splitMaster(afterContent) : { master: {}, categoryId: undefined, rest: afterContent };
    // Stage 4f: unit ratio, sub-packing / product unit, expected restock, delivery weekdays.
    const { logistics, rest } = ownsOrdering() ? splitLogistics(afterMaster) : { logistics: {}, rest: afterMaster };
    const masterBody = categoryId === undefined ? master : { ...master, category_id: categoryId };
    const relay = ownPrice || price === undefined ? rest : { ...rest, selling_unit_price: price };
    if (promotion.rules === undefined && !ownPrice && !Object.keys(content).length && !Object.keys(masterBody).length && !Object.keys(logistics).length) return this.relayUpdate(id, relay, req);

    const sku = await this.skuOf(id);
    const result: Record<string, unknown> = {};
    if (promotion.rules !== undefined) result.promotionRules = await this.modules.get(ProductPromotionRulesService, { strict: false }).edit(sku, promotion.rules, req.staff.userId);
    if (ownPrice) {
      result.price = await this.modules.get(ProductPricesService, { strict: false })
        .edit(sku, { sellingUnitPrice: price === null ? null : Number(price) }, req.staff.userId);
    }
    if (Object.keys(content).length) result.content = await this.modules.get(ProductContentsService, { strict: false }).edit(sku, content, req.staff.userId);
    if (Object.keys(masterBody).length) result.master = await this.modules.get(ProductMastersService, { strict: false }).edit(sku, masterBody, req.staff.userId);
    if (Object.keys(logistics).length) result.logistics = await this.modules.get(OrderingService, { strict: false }).editLogistics(sku, logistics, req.staff.userId);
    if (Object.keys(relay).length) result.product = await this.relayUpdate(id, relay, req);
    return result;
  }

  private async relayUpdate(id: string, fields: Record<string, unknown>, req: StaffRequest) {
    const result = await this.josh.run('products', 'update', { id, fields }, this.as(req), 'admin');
    await this.catalog.syncId(id).catch(() => undefined); // the cron catches up if the replica lags
    return result;
  }

  /** The product's SKU from the catalog copy; a product not copied yet (just created, copy lags) is pulled from josh once. */
  private async skuOf(id: string): Promise<string> {
    const db = this.modules.get(DataSource, { strict: false });
    const find = async () => (await db.query(`SELECT sku FROM josh_catalog_products WHERE id = $1`, [id]))[0]?.sku as string | undefined;
    let sku = await find();
    if (!sku) {
      await this.catalog.syncId(id).catch(() => undefined);
      sku = await find();
    }
    if (!sku) throw new NotFoundException('ไม่พบสินค้าในสำเนาแค็ตตาล็อก');
    return sku;
  }

  /**
   * Create a product (COMMERCE_OWNS_CATALOG): josh's ProductService.create with the create form's
   * fields. Images are added afterwards as an image-only edit, which josh keeps open. Stage 4b: once commerce owns
   * content, the content sent is recorded here too (the first version of the new SKU's content).
   */
  @Post('products') @HttpCode(HttpStatus.OK) @StaffRoles('merchandising')
  async createProduct(@Body() b: { product?: Record<string, unknown> }, @Req() req: StaffRequest) {
    const promotion = ownsPromotions() ? splitPromotionRules(plain(b?.product)) : { rules: undefined, rest: plain(b?.product) };
    const product = promotion.rest;
    const { content } = ownsProductContent() ? splitContent(product) : { content: {} };
    const result = await this.josh.run<{ product_inventory_id?: string }>('products', 'create', { product }, this.as(req), 'admin');
    if (result?.product_inventory_id) await this.catalog.syncId(result.product_inventory_id).catch(() => undefined);
    const sku = typeof product.product_inventory_sku === 'string' ? product.product_inventory_sku.trim() : '';
    if (sku && result?.product_inventory_id && promotion.rules !== undefined) await this.modules.get(ProductPromotionRulesService, { strict: false }).edit(sku, promotion.rules, req.staff.userId, 'create');
    if (sku && Object.keys(content).length) {
      await this.modules.get(ProductContentsService, { strict: false }).edit(sku, content, req.staff.userId, 'create');
    }
    return result;
  }

  /** Replace a product's cuisine tags (COMMERCE_OWNS_CATALOG): josh's CuisineService.setProductCuisines. */
  @Post('products/:id/cuisines') @HttpCode(HttpStatus.OK) @StaffRoles('merchandising')
  setProductCuisines(@Param('id', ParseUUIDPipe) id: string, @Body() b: { cuisineIds?: unknown }, @Req() req: StaffRequest) {
    return this.josh.run('products', 'set_cuisines', { id, cuisine_ids: Array.isArray(b?.cuisineIds) ? b.cuisineIds : [] }, this.as(req), 'admin');
  }

  /** Suppliers (josh SupplierService validates with its DTO; supplier_name is required on update too). */
  @Post('suppliers') @HttpCode(HttpStatus.OK) @StaffRoles('merchandising')
  createSupplier(@Body() b: { supplier?: Record<string, unknown> }, @Req() req: StaffRequest) {
    return this.josh.run('suppliers', 'create', { supplier: plain(b?.supplier) }, this.as(req), 'admin');
  }

  @Post('suppliers/:id/update') @HttpCode(HttpStatus.OK) @StaffRoles('merchandising')
  updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() b: { supplier?: Record<string, unknown> }, @Req() req: StaffRequest) {
    return this.josh.run('suppliers', 'update', { id, supplier: plain(b?.supplier) }, this.as(req), 'admin');
  }

  @Post('suppliers/:id/remove') @HttpCode(HttpStatus.OK) @StaffRoles('merchandising')
  removeSupplier(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest) {
    return this.josh.run('suppliers', 'remove', { id }, this.as(req), 'admin');
  }

  /** Internal docs library: one markdown file (josh checks .md, non-empty, 2 MB). */
  @Post('internal-docs') @HttpCode(HttpStatus.OK)
  uploadDoc(@Body() b: { category?: string; title?: string; filename?: string; content?: string }, @Req() req: StaffRequest) {
    return this.josh.run('internal-docs', 'upload', { category: b?.category, title: b?.title || undefined, filename: b?.filename, content: b?.content }, this.as(req), 'admin');
  }

  @Post('internal-docs/:id/remove') @HttpCode(HttpStatus.OK)
  removeDoc(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest) {
    return this.josh.run('internal-docs', 'remove', { id }, this.as(req), 'admin');
  }

  /** Customer data (COMMERCE_OWNS_CUSTOMERS): josh's CS-admin / company services validate with their own DTOs. */
  @Post('customers/users/:id/update') @HttpCode(HttpStatus.OK)
  updateUser(@Param('id', ParseUUIDPipe) id: string, @Body() b: { changes?: unknown }, @Req() req: StaffRequest) {
    return this.josh.run('customers', 'update_user', { userId: id, changes: plain(b?.changes) }, this.as(req), 'admin');
  }

  @Post('customers/branches/:id/update') @HttpCode(HttpStatus.OK)
  updateBranch(@Param('id', ParseUUIDPipe) id: string, @Body() b: { changes?: unknown }, @Req() req: StaffRequest) {
    return this.josh.run('customers', 'update_branch', { branchId: id, changes: plain(b?.changes) }, this.as(req), 'admin');
  }

  @Post('customers/companies/:id/sales-rep') @HttpCode(HttpStatus.OK)
  assignSales(@Param('id', ParseUUIDPipe) id: string, @Body() b: { salesUserId?: string | null }, @Req() req: StaffRequest) {
    if (ownsSalesReps()) return this.modules.get(SalesRepsService, { strict: false }).assign(id, b?.salesUserId ?? null);
    return this.josh.run('customers', 'assign_sales', { companyId: id, salesUserId: b?.salesUserId ?? null }, this.as(req), 'admin');
  }

  /** Company master data incl. credit limit / term (josh: admin roles only). */
  @Post('customers/companies/:id/update') @HttpCode(HttpStatus.OK)
  updateCompany(@Param('id', ParseUUIDPipe) id: string, @Body() b: { changes?: unknown }, @Req() req: StaffRequest) {
    return this.josh.run('customers', 'update_company', { companyId: id, changes: plain(b?.changes) }, this.as(req), 'admin');
  }
}

const plain = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
