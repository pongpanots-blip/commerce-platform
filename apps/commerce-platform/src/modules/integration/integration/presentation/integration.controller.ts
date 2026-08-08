import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IntegrationService } from '../application/integration.service';
import { CreateIntegrationDto } from '../application/dto/create-integration.dto';

@Controller('integrations')
export class IntegrationController {
  constructor(private readonly service: IntegrationService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateIntegrationDto) {
    return this.service.create(dto);
  }
}
