import { Controller, Delete, Get, MethodNotAllowedException, Patch, Post, Query } from '@nestjs/common';
import { StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';
import { BaseCrudController } from '../../../../shared-kernel/presentation/base-crud.controller';
import { InventoryLevel } from '../infrastructure/inventory-level.entity';
import { InventoryService } from '../application/inventory.service';
import { InventoryListQueryDto } from './inventory-list.query';

const CLOSED = 'แก้ stock ผ่าน POST /api/stock/adjustments หรือ /api/stock/transfers (บันทึกใน ledger)';

@Controller('inventory')
@StaffRoles('merchandising')
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

  // Stage 3: stock only moves through the ledger (movement + snapshot + event) — raw level writes are closed.
  @Post()
  override create(): never { throw new MethodNotAllowedException(CLOSED); }

  @Patch(':id')
  override update(): never { throw new MethodNotAllowedException(CLOSED); }

  @Delete(':id')
  override remove(): never { throw new MethodNotAllowedException(CLOSED); }
}
