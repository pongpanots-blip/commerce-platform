import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { StaffRequest, StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { PackInputsService } from './pack-inputs.service';
import { PackDraftsService } from './pack-drafts.service';

@Controller('reports/pack-price-planning')
@StaffRoles('marketing', 'business_analyst')
export class PackPlanningController {
  constructor(private readonly inputs: PackInputsService, private readonly drafts: PackDraftsService) {}
  private async valid<T>(run: () => Promise<T>) {
    try { return await run(); } catch (e) { if (e instanceof z.ZodError || e instanceof SyntaxError) throw new BadRequestException('Invalid pack planning proposal'); throw e; }
  }
  @Get('inputs/:sku') @Header('Cache-Control', 'private, no-store') inputsFor(@Param('sku') sku: string) { return this.valid(() => this.inputs.inputs(sku)); }
  // GET preserves BA's existing read-only policy; no AllowReadOnlyWrite exception is added.
  @Get('preview') @Header('Cache-Control', 'private, no-store') preview(@Query() raw: unknown) {
    return this.valid(async () => { const q = z.object({ scenario: z.string().min(1).max(7000).regex(/^[A-Za-z0-9_-]+$/) }).strict().parse(raw); return this.inputs.preview(JSON.parse(Buffer.from(q.scenario, 'base64url').toString('utf8'))); });
  }
  @Get('drafts') list(@Req() req: StaffRequest, @Query() raw: unknown) {
    return this.valid(() => { const q = z.object({ after: z.uuid().optional() }).strict().parse(raw); return this.drafts.list(req.staff.userId, q.after); });
  }
  @Post('drafts') @HttpCode(200) @StaffRoles('marketing') create(@Req() req: StaffRequest, @Body() raw: unknown) { return this.valid(() => this.drafts.create(raw, req.staff.userId)); }
  @Get('drafts/:id') get(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) { return this.drafts.get(id, req.staff.userId); }
  @Patch('drafts/:id') @StaffRoles('marketing') update(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) { return this.valid(() => this.drafts.update(id, raw, req.staff.userId)); }
  @Get('requests/:id') request(@Req() req: StaffRequest, @Param('id', ParseUUIDPipe) id: string) { return this.drafts.request(id, req.staff.userId); }
}
