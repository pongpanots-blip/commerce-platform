import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DynamicSegmentsService } from './application/dynamic-segments.service';
import { EventCatalogService } from './application/event-catalog.service';
import { EventIngestService } from './application/event-ingest.service';
import { EventRuleService } from './application/event-rule.service';
import { MarketingDynamicSegmentRow } from './infrastructure/marketing-dynamic-segment.entity';
import { MarketingEventDefinitionRow } from './infrastructure/marketing-event-definition.entity';
import { EventsStore } from './infrastructure/events.store';
import { DynamicSegmentsController } from './presentation/dynamic-segments.controller';
import { EventsIngestController } from './presentation/events-ingest.controller';
import { MarketingEventsController } from './presentation/marketing-events.controller';

/** Customer behaviour events owned by commerce (spec 2026-10-10-marketing-event-layer). */
@Module({
  imports: [TypeOrmModule.forFeature([MarketingEventDefinitionRow, MarketingDynamicSegmentRow])],
  controllers: [EventsIngestController, MarketingEventsController, DynamicSegmentsController],
  providers: [EventsStore, EventCatalogService, EventIngestService, EventRuleService, DynamicSegmentsService],
  exports: [EventsStore, EventCatalogService, EventRuleService, DynamicSegmentsService],
})
export class MarketingEventsModule {}
