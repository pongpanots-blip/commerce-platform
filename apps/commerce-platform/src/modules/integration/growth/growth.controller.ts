import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { StaffRequest, StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { GrowthService } from './growth.service';
import { GrowthDataService } from './growth-data.service';
import { aiRequestSchema, createSchema, parse, planListSchema, taskSchema, updateSchema, versionSchema } from './growth.validation';
import type { GrowthPlanInput, GrowthTask } from '@cp/growth';

@Controller('growth')
@StaffRoles('marketing', 'business_analyst')
export class GrowthController {
  constructor(private readonly plans: GrowthService, private readonly data: GrowthDataService) {}
  @Get('readiness') readiness() { return this.plans.readiness(); }
  @Get('workspace') workspace() { return this.data.workspace(); }
  @Get('plans') list(@Query() q: unknown, @Req() r: StaffRequest) {
    const query = parse(planListSchema, q);
    return this.plans.list(r.staff, { page: query.page, limit: query.limit, search: query.search, status: query.status, month: query.month });
  }
  @Get('plans/:id') detail(@Param('id', ParseUUIDPipe) id: string, @Req() r: StaffRequest) { return this.plans.detail(id, r.staff); }
  @Post('plans') create(@Body() body: unknown, @Req() r: StaffRequest) {
    const b = parse(createSchema, body); return this.plans.create(b.requestId, b.plan as GrowthPlanInput, r.staff);
  }
  @Put('plans/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() r: StaffRequest) {
    const b = parse(updateSchema, body); return this.plans.update(id, b.version, b.plan as GrowthPlanInput, r.staff);
  }
  @Post('plans/:id/review') review(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() r: StaffRequest) {
    return this.plans.review(id, parse(versionSchema, body).version, false, r.staff);
  }
  @Post('plans/:id/approve') @StaffRoles('admin')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() r: StaffRequest) {
    return this.plans.review(id, parse(versionSchema, body).version, true, r.staff);
  }
  @Post('plans/:id/export') export(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() r: StaffRequest) {
    return this.plans.export(id, parse(versionSchema, body).version, r.staff);
  }
  @Post('plans/:id/reconcile') @StaffRoles('admin')
  reconcile(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() r: StaffRequest) {
    const b = parse(z.object({ version: z.number().int().positive(), workflowId: z.string().uuid() }).strict(), body);
    return this.plans.reconcile(id, b.version, b.workflowId, r.staff);
  }
  @Post('plans/:id/ai') draft(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() r: StaffRequest) {
    const b = parse(aiRequestSchema, body); return this.plans.draft(id, b.version, b.instruction, r.staff);
  }
  @Put('plans/:id/tasks') tasks(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() r: StaffRequest) {
    const b = parse(taskSchema, body); return this.plans.tasks(id, b.version, b.tasks as GrowthTask[], r.staff);
  }
  @Get('results/:id') results(@Param('id', ParseUUIDPipe) id: string, @Req() r: StaffRequest) { return this.data.results(id, r.staff); }
  @Get('timeline/:companyId') @StaffRoles('business_analyst')
  timeline(@Param('companyId', ParseUUIDPipe) id: string, @Req() r: StaffRequest) { return this.data.timeline(id, r.staff); }
}
