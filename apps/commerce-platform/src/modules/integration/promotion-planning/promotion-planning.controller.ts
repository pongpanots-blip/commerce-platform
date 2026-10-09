import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { StaffRequest } from '../../../shared-kernel/presentation/auth.decorators';
import { PromotionInputsService } from './promotion-inputs.service';
import { PromotionDraftsService } from './promotion-drafts.service';
/** Admin-only default, as with the existing commerce previews; no additional role grant. */
@Controller('reports/promotion-planning')
export class PromotionPlanningController {
  constructor(private readonly inputs: PromotionInputsService, private readonly drafts: PromotionDraftsService) {}
  private async valid<T>(run: () => Promise<T>) {
    try { return await run(); } catch (e) { if (e instanceof z.ZodError) throw new BadRequestException('Invalid promotion proposal'); throw e; }
  }
  @Get('inputs/:sku') observations(@Param('sku') sku: string) { return this.inputs.inputs(sku); }
  @Post('preview') @HttpCode(200) preview(@Body() raw: unknown) { return this.valid(() => this.inputs.preview(raw)); }
  @Get('drafts') list(@Req() req: StaffRequest, @Query() query: unknown) {
    const p = z.object({ after: z.uuid().optional() }).strict().safeParse(query);
    if (!p.success) throw new BadRequestException('Invalid draft cursor'); return this.drafts.list(req.staff.userId, p.data.after);
  }
  @Post('drafts') @HttpCode(200) create(@Body() raw: unknown, @Req() req: StaffRequest) { return this.valid(() => this.drafts.create(raw, req.staff.userId)); }
  @Get('requests/:id') request(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest) { return this.drafts.request(id, req.staff.userId); }
  @Get('drafts/:id') get(@Param('id', ParseUUIDPipe) id: string, @Req() req: StaffRequest) { return this.drafts.get(id, req.staff.userId); }
  @Patch('drafts/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown, @Req() req: StaffRequest) { return this.valid(() => this.drafts.update(id, raw, req.staff.userId)); }
}
