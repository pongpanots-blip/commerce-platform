import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { DynamicSegmentInput, EventRule } from '@cp/marketing-workflow';
import { StaffRequest, StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { parse } from '../../growth/growth.validation';
import { DynamicSegmentsService } from '../application/dynamic-segments.service';
import { dynamicSegmentSchema, previewSchema } from './events.schemas';

@Controller('marketing/dynamic-segments')
@StaffRoles('marketing')
export class DynamicSegmentsController {
  constructor(private readonly segments: DynamicSegmentsService) {}

  @Get() list() { return this.segments.list(); }
  @Post('preview') preview(@Body() b: unknown) { return this.segments.preview(parse(previewSchema, b).rule as EventRule); }
  @Post() create(@Body() b: unknown, @Req() r: StaffRequest) { return this.segments.create(parse(dynamicSegmentSchema, b) as DynamicSegmentInput, r.staff.email); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.segments.get(id); }
  @Put(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.segments.update(id, parse(dynamicSegmentSchema, b) as DynamicSegmentInput); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.segments.remove(id); }
}
