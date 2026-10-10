import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import type { EventDefinitionInput } from '@cp/marketing-workflow';
import { StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { parse } from '../../growth/growth.validation';
import { EventCatalogService } from '../application/event-catalog.service';
import { EventsStore } from '../infrastructure/events.store';
import { dailySchema, definitionSchema, eventListSchema } from './events.schemas';

/** Event catalog + recent events + daily totals (spec §14). Static routes first. */
@Controller('marketing/events')
@StaffRoles('marketing')
export class MarketingEventsController {
  constructor(private readonly catalog: EventCatalogService, private readonly store: EventsStore) {}

  @Get('definitions') async definitions() { return { definitions: await this.catalog.list(), coverage: await this.store.coverage() }; }
  @Post('definitions') create(@Body() b: unknown) { return this.catalog.create(parse(definitionSchema, b) as EventDefinitionInput); }
  @Put('definitions/:name') update(@Param('name') name: string, @Body() b: unknown) { return this.catalog.update(name, parse(definitionSchema, b) as EventDefinitionInput); }
  @Post('definitions/:name/archive') archive(@Param('name') name: string) { return this.catalog.archive(name); }
  @Get('daily') daily(@Query() q: unknown) { const x = parse(dailySchema, q); return this.store.daily(x.from, x.to); }
  @Get() list(@Query() q: unknown) { return this.store.list(parse(eventListSchema, q)); }
}
