import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { BaseCrudController } from '../../../../shared-kernel/presentation/base-crud.controller';
import { InventoryLevel } from '../infrastructure/inventory-level.entity';
import { InventoryService } from '../application/inventory.service';
import { CreateInventoryDto } from '../application/dto/create-inventory.dto';
import { UpdateInventoryDto } from '../application/dto/update-inventory.dto';
import { InventoryListQueryDto } from './inventory-list.query';

@Controller('inventory')
export class InventoryController extends BaseCrudController<InventoryLevel>() {
  constructor(protected readonly service: InventoryService) {
    super();
  }

  @Get()
  override list(@Query() query: InventoryListQueryDto) {
    return this.service.findMany({
      page: query.page,
      pageSize: query.pageSize,
      where: query.productId ? { productId: query.productId } : undefined,
    });
  }

  @Post()
  override create(@Body() dto: CreateInventoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  override update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInventoryDto) {
    return this.service.update(id, dto);
  }
}
