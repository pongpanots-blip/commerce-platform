import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import { StaffRequest, StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { GuidedAnalysisService } from './guided-analysis.service';

@Controller('reports/guided-analysis')
@StaffRoles('business_analyst')
export class GuidedAnalysisController {
  constructor(private readonly analysis: GuidedAnalysisService) {}
  @Get('templates') @Header('Cache-Control', 'private, no-store')
  templates() { return this.analysis.catalog(); }
  @Get('preview') @Header('Cache-Control', 'private, no-store')
  preview(@Query() query: unknown, @Req() request: StaffRequest) { return this.analysis.preview(query, request.staff); }
}
