import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '../../../../shared-kernel/presentation/auth.decorators';
import { Throttle } from '../../../../shared-kernel/presentation/throttle';
import { EventIngestService } from '../application/event-ingest.service';

/** shop-web and mobile post behaviour events here (spec §3). Unauthenticated: identity comes from device links. */
@Controller('events')
export class EventsIngestController {
  constructor(private readonly ingest: EventIngestService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  post(@Body() body: unknown) { return this.ingest.ingest(body); }
}
