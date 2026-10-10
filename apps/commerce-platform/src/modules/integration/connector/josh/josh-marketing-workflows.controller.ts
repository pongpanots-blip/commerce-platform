import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { JoshActions } from './josh-actions';
import { JoshMarketingWorkflows } from './josh-marketing-workflows';
import { MarketingTesters } from './marketing-testers';
import { joshOnly } from './system-health';

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** josh marketing workflows: read from josh's replica; changes by josh's MarketingWorkflowService. Admin and marketing. */
@Controller()
@StaffRoles('marketing')
export class JoshMarketingWorkflowsController {
  constructor(private readonly workflows: JoshMarketingWorkflows, private readonly josh: JoshActions, private readonly testers: MarketingTesters) {}

  private replica() {
    if (!this.workflows.available) throw joshOnly('marketingWorkflows');
  }
  private as(req: StaffRequest) { return { userId: req.staff.userId, email: req.staff.email }; }

  @Get('reports/marketing-workflows') list(@Query('days') days?: string) {
    this.replica();
    const d = days ? Number(days) : 30;
    if (!Number.isInteger(d) || d < 1 || d > 365) throw new BadRequestException('days must be 1-365');
    return this.workflows.list(d);
  }

  @Get('reports/marketing-workflows/:id') detail(@Param('id', ParseUUIDPipe) id: string) { this.replica(); return this.workflows.detail(id); }

  /** Body: josh's CreateMarketingWorkflowDto. */
  @Post('josh/marketing-workflows') @HttpCode(HttpStatus.OK)
  create(@Body() b: { workflow?: unknown }, @Req() req: StaffRequest) {
    return this.josh.run('marketing-workflows', 'create', { workflow: obj(b?.workflow) }, this.as(req), 'admin');
  }

  /** Body: josh's UpdateMarketingWorkflowDto fields. */
  @Post('josh/marketing-workflows/:id/update') @HttpCode(HttpStatus.OK)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() b: { workflow?: unknown }, @Req() req: StaffRequest) {
    return this.josh.run('marketing-workflows', 'update', { id, workflow: obj(b?.workflow) }, this.as(req), 'admin');
  }

  /** Body: { userId?, individualId?, dryRun? } — a real run (dryRun false) with a josh user needs a tester. Declared before :id/:action. */
  @Post('josh/marketing-workflows/:id/test') @HttpCode(HttpStatus.OK)
  async test(@Param('id', ParseUUIDPipe) id: string, @Body() b: { userId?: string; individualId?: string; dryRun?: boolean }, @Req() req: StaffRequest) {
    await this.testers.assertWorkflowTest(b);
    return this.josh.run('marketing-workflows', 'test', { id, userId: b?.userId, individualId: b?.individualId, dryRun: b?.dryRun }, this.as(req), 'admin');
  }

  @Post('josh/marketing-workflows/:id/:action') @HttpCode(HttpStatus.OK)
  setState(@Param('id', ParseUUIDPipe) id: string, @Param('action') action: string, @Req() req: StaffRequest) {
    if (action !== 'activate' && action !== 'pause') throw new BadRequestException('action must be activate or pause');
    return this.josh.run('marketing-workflows', action, { id }, this.as(req), 'admin');
  }
}
