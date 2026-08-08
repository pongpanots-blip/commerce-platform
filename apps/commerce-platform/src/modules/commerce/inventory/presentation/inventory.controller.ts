import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { BaseCrudController } from '../../../../shared-kernel/presentation/base-crud.controller';
import { InventoryLevel } from '../infrastructure/inventory-level.entity';
import { InventoryService } from '../application/inventory.service';
import { CreateInventoryDto } from '../application/dto/create-inventory.dto';
import { UpdateInventoryDto } from '../application/dto/update-inventory.dto';

@Controller('inventory')
export class InventoryController extends BaseCrudController<InventoryLevel>() {
  constructor(protected readonly service: InventoryService) {
    super();
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
