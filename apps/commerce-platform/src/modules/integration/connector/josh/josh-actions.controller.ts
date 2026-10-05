import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { JoshActions } from './josh-actions';

/**
 * commerce-admin buttons for josh winback / push campaigns. Bodies are passed through to josh,
 * which validates them with its own DTOs and rules (manager-only targets, marketing editors for push).
 * Winback: admin (guard default). Push: marketing too.
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
}
