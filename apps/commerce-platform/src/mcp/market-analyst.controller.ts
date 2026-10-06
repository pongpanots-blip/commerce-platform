import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { GrowthPlanInput } from '@cp/growth';
import { StaffRoles, StaffRequest } from '../shared-kernel/presentation/auth.decorators';
import { GrowthService } from '../modules/integration/growth/growth.service';
import { parse, planSchema } from '../modules/integration/growth/growth.validation';
import { MarketAnalystService, analysisInput } from './market-analyst.service';
import { McpTools } from './mcp.tools';

@Controller('marketing-analyst')
@StaffRoles('marketing')
export class MarketAnalystController {
  constructor(private readonly analyst: MarketAnalystService, private readonly tools: McpTools, private readonly growth: GrowthService) {}
  @Get('readiness') readiness() { return this.analyst.readiness(); }
  @Get('reports') list(@Req() r: StaffRequest) { return this.analyst.list(r.staff); }
  @Get('reports/:id') detail(@Param('id', ParseUUIDPipe) id: string, @Req() r: StaffRequest) { return this.analyst.detail(id, r.staff); }
  @Post('reports') generate(@Body() body: unknown, @Req() r: StaffRequest) {
    const { requestId, ...input } = parse(analysisInput.extend({ requestId: z.string().uuid() }), body);
    return this.analyst.generate(requestId, input, r.staff, () => this.tools.openReadClient(r.staff));
  }
  @Post('reports/:id/plan') async plan(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() r: StaffRequest) {
    const b = parse(z.object({ requestId: z.string().uuid(), recommendationId: z.string().max(100) }).strict(), body);
    const report = await this.analyst.detail(id, r.staff);
    const recommendation = report.recommendations.find(a => a.id === b.recommendationId);
    if (!recommendation) throw new BadRequestException('ไม่พบข้อเสนอนี้');
    const plan = parse(planSchema, { title: recommendation.title, template: 'market', owner: r.staff.email,
      goal: `${recommendation.why}\nงานถัดไป: ${recommendation.nextStep}\nวัดผล: ${recommendation.successMetric}`.slice(0, 2000),
      segmentIds: [], excludeSegmentIds: [], productSkus: recommendation.productSkus, notifyTemplateKey: null,
      scheduleAt: null, budgetThb: 0, minimumMarginPercent: 0, holdoutPercent: 10, cooldownDays: 7, conversionWindowDays: 14,
      variants: [{ label: 'A', title: recommendation.title, body: recommendation.nextStep, evidenceIds: recommendation.evidenceIds }], selectedVariant: 0,
      researchTopicId: null, researchRunId: null, analysisId: report.id });
    return this.growth.create(b.requestId, plan as GrowthPlanInput, r.staff);
  }
}
