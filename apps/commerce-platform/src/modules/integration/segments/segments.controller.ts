import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, ValidationPipe } from '@nestjs/common';
import { StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { CreateUserSegmentDto, UpdateUserSegmentDto } from './dto/user-segment.dto';
import { SegmentsService } from './segments.service';

/**
 * Segment writes once commerce owns segments (stage 2a) — josh's /user-segments routes and response shapes, so
 * josh's admin pages call them unchanged (commerce-client routes the writes here). Reads, preview, members and
 * promotion mappings stay on josh's copy, which every write updates through segment.* events.
 */
@Controller('user-segments')
@StaffRoles('marketing')
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get() findAll() { return this.segments.findAll(); }
  @Get(':id') findOne(@Param('id', ParseUUIDPipe) id: string) { return this.segments.findOne(id); }
  @Post() create(@Body(new ValidationPipe({ transform: true, whitelist: true })) dto: CreateUserSegmentDto) { return this.segments.create(dto); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body(new ValidationPipe({ transform: true, whitelist: true })) dto: UpdateUserSegmentDto) {
    return this.segments.update(id, dto);
  }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.segments.remove(id); }
}
