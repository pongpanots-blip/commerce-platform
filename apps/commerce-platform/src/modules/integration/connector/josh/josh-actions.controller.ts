import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
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
  constructor(private readonly josh: JoshActions, private readonly catalog: JoshCatalogSyncService) {}

  private as(req: StaffRequest) { return { userId: req.staff.userId, email: req.staff.email }; }

  @Post('winback/accounts/:id/assign') @HttpCode(HttpStatus.OK)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() b: { assignedSalesUserId?: string | null }, @Req() req: StaffRequest) {
    return this.josh.run('winback', 'assign', { accountId: id, assignedSalesUserId: b?.assignedSalesUserId ?? null }, this.as(req), 'admin');
  }

  @Post('winback/accounts/:id/stage') @HttpCode(HttpStatus.OK)
  moveStage(@Param('id', ParseUUIDPipe) id: string, @Body() b: Record<string, unknown>, @Req() req: StaffRequest) {
    return this.josh.run('winback', 'move_stage', { ...b, accountId: id }, this.as(req), 'admin');
  }

  @Put('winback/targets')
  setTarget(@Body() b: Record<string, unknown>, @Req() req: StaffRequest) {
    return this.josh.run('winback', 'set_target', b ?? {}, this.as(req), 'admin');
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
  @Post('products/approve') @HttpCode(HttpStatus.OK)
  approveProducts(@Body() b: { ids?: string[] }, @Req() req: StaffRequest) {
    return this.josh.run('products', 'approve', { ids: Array.isArray(b?.ids) ? b.ids.slice(0, 200) : [] }, this.as(req), 'admin');
  }

  @Post('products/reject') @HttpCode(HttpStatus.OK)
  rejectProducts(@Body() b: { ids?: string[] }, @Req() req: StaffRequest) {
    return this.josh.run('products', 'reject', { ids: Array.isArray(b?.ids) ? b.ids.slice(0, 200) : [] }, this.as(req), 'admin');
  }

  /**
   * Edit one product's master data (COMMERCE_OWNS_CATALOG): josh's ProductService.update writes it,
   * josh rejects fields it does not allow from commerce. Commerce's catalog copy is refreshed right away.
   */
  @Post('products/:id/update') @HttpCode(HttpStatus.OK)
  async updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() b: { fields?: Record<string, unknown> }, @Req() req: StaffRequest) {
    const fields = b?.fields && typeof b.fields === 'object' && !Array.isArray(b.fields) ? b.fields : {};
    const result = await this.josh.run('products', 'update', { id, fields }, this.as(req), 'admin');
    await this.catalog.syncId(id).catch(() => undefined); // the cron catches up if the replica lags
    return result;
  }

  /** Suppliers (josh SupplierService validates with its DTO; supplier_name is required on update too). */
  @Post('suppliers') @HttpCode(HttpStatus.OK)
  createSupplier(@Body() b: { supplier?: Record<string, unknown> }, @Req() req: StaffRequest) {
    return this.josh.run('suppliers', 'create', { supplier: plain(b?.supplier) }, this.as(req), 'admin');
  }

  @Post('suppliers/:id/update') @HttpCode(HttpStatus.OK)
  updateSupplier(@Param('id', ParseUUIDPipe) id: string, @Body() b: { supplier?: Record<string, unknown> }, @Req() req: StaffRequest) {
    return this.josh.run('suppliers', 'update', { id, supplier: plain(b?.supplier) }, this.as(req), 'admin');
  }

  @Post('suppliers/:id/remove') @HttpCode(HttpStatus.OK)
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
    return this.josh.run('customers', 'assign_sales', { companyId: id, salesUserId: b?.salesUserId ?? null }, this.as(req), 'admin');
  }

  /** Company master data incl. credit limit / term (josh: admin roles only). */
  @Post('customers/companies/:id/update') @HttpCode(HttpStatus.OK)
  updateCompany(@Param('id', ParseUUIDPipe) id: string, @Body() b: { changes?: unknown }, @Req() req: StaffRequest) {
    return this.josh.run('customers', 'update_company', { companyId: id, changes: plain(b?.changes) }, this.as(req), 'admin');
  }
}

const plain = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
