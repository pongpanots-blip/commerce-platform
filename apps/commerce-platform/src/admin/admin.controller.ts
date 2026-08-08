import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { ErpIngestEntityType, ErpIngestStatus } from '../modules/integration/connector/erp/erp-ingest-record.entity';

@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Get('erp-ingest')
  listErpIngest(
    @Query('entityType') entityType?: ErpIngestEntityType,
    @Query('status') status?: ErpIngestStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listErpIngest({
      entityType,
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('erp-ingest/:id/apply')
  applyErpIngest(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.applyErpIngest(id);
  }
}
