import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SegmentDefinitionCompiler } from './segment-definition.compiler';
import { Segment, SegmentMember } from './segment.entity';
import { OwnershipController } from './ownership.controller';
import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';

/** Customer segments owned by commerce (stage 2a); josh keeps a copy through segment.* events. */
@Module({
  imports: [TypeOrmModule.forFeature([Segment, SegmentMember])],
  controllers: [SegmentsController, OwnershipController],
  providers: [SegmentsService, SegmentDefinitionCompiler],
  exports: [SegmentsService],
})
export class SegmentsModule {}
