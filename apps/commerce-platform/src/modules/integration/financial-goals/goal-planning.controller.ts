import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { StaffRequest, StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { GoalInputsService } from './goal-inputs.service';
import { GoalDraftsService } from './goal-drafts.service';

@Controller('reports/financial-goals')
@StaffRoles('sales_manager', 'business_analyst')
export class GoalPlanningController {
  constructor(private readonly inputs: GoalInputsService, private readonly drafts: GoalDraftsService) {}
  private async valid<T>(run: () => Promise<T>) {
    try { return await run(); } catch (e) { if (e instanceof z.ZodError || e instanceof SyntaxError) throw new BadRequestException('Invalid financial goal proposal'); throw e; }
  }
  @Get('inputs/:period') @Header('Cache-Control', 'private, no-store') inputsFor(@Param('period') period: string) { return this.valid(() => this.inputs.inputs(period)); }
  // GET preserves BA's existing read-only policy; no AllowReadOnlyWrite exception is added.
  @Get('preview') @Header('Cache-Control', 'private, no-store') preview(@Query() raw: unknown) {
    return this.valid(async () => { const q = z.object({ scenario: z.string().min(1).max(7000).regex(/^[A-Za-z0-9_-]+$/) }).strict().parse(raw); return this.inputs.preview(JSON.parse(Buffer.from(q.scenario, 'base64url').toString('utf8'))); });
  }
  @Get('drafts') @Header('Cache-Control', 'private, no-store') list(@Req() req: StaffRequest, @Query() raw: unknown) {
    return this.valid(() => { const q = z.object({ after: z.uuid().optional() }).strict().parse(raw); return this.drafts.list(req.staff.userId, q.after); });
  }
  @Post('drafts') @HttpCode(200) @StaffRoles() create(@Req() req: StaffRequest, @Body() raw: unknown) { return this.valid(() => this.drafts.create(raw, req.staff.userId)); }
  @Get('drafts/:id') @Header('Cache-Control', 'private, no-store') get(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) { return this.drafts.get(id, req.staff.userId); }
  @Patch('drafts/:id') @StaffRoles() update(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) { return this.valid(() => this.drafts.update(id, raw, req.staff.userId)); }
  @Get('requests/:id') @Header('Cache-Control', 'private, no-store') request(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) { return this.drafts.request(id, req.staff.userId); }
}
