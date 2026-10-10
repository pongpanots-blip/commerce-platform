import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventCatalogService } from './application/event-catalog.service';
import { EventIngestService } from './application/event-ingest.service';
import { MarketingDynamicSegmentRow } from './infrastructure/marketing-dynamic-segment.entity';
import { MarketingEventDefinitionRow } from './infrastructure/marketing-event-definition.entity';
import { EventsStore } from './infrastructure/events.store';
import { EventsIngestController } from './presentation/events-ingest.controller';

/** Customer behaviour events owned by commerce (spec 2026-10-10-marketing-event-layer). */
@Module({
  imports: [TypeOrmModule.forFeature([MarketingEventDefinitionRow, MarketingDynamicSegmentRow])],
  controllers: [EventsIngestController],
  providers: [EventsStore, EventCatalogService, EventIngestService],
  exports: [EventsStore, EventCatalogService],
})
export class MarketingEventsModule {}
