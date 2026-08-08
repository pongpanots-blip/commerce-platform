import { Body, Controller, Get, Post } from '@nestjs/common';
import { SyncJobService } from '../application/sync-job.service';
import { TriggerSyncDto } from '../application/dto/trigger-sync.dto';

@Controller('sync-jobs')
export class SyncJobController {
  constructor(private readonly service: SyncJobService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  trigger(@Body() dto: TriggerSyncDto) {
    return this.service.trigger(dto.integrationId, dto.operation);
  }
}
