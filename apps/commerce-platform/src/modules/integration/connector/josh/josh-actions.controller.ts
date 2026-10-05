import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { JoshActions } from './josh-actions';

/**
 * commerce-admin buttons that ask josh to act (winback, push campaigns, credit applications, admin
 * access, coupon on/off). Bodies are passed through to josh, which validates them with its own DTOs
 * and rules (manager-only targets, marketing editors for push, platform_admin for admin access).
 * Admin (guard default); push and coupon on/off: marketing too.
 */
@Controller('josh')
export class JoshActionsController {
  constructor(private readonly josh: JoshActions) {}

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
}
