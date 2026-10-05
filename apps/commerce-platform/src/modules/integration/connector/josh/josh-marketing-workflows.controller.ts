import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, ServiceUnavailableException } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { JoshActions } from './josh-actions';
import { JoshMarketingWorkflows } from './josh-marketing-workflows';

const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** josh marketing workflows: read from josh's replica; changes by josh's MarketingWorkflowService. Admin and marketing. */
@Controller()
@StaffRoles('marketing')
export class JoshMarketingWorkflowsController {
  constructor(private readonly workflows: JoshMarketingWorkflows, private readonly josh: JoshActions) {}

  private replica() {
    if (!this.workflows.available) throw new ServiceUnavailableException('josh\'s read replica is not connected on this server (JOSH_DATABASE_URL).');
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

  @Post('josh/marketing-workflows/:id/:action') @HttpCode(HttpStatus.OK)
  setState(@Param('id', ParseUUIDPipe) id: string, @Param('action') action: string, @Req() req: StaffRequest) {
    if (action !== 'activate' && action !== 'pause') throw new BadRequestException('action must be activate or pause');
    return this.josh.run('marketing-workflows', action, { id }, this.as(req), 'admin');
  }
}
