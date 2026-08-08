import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryLevel } from './infrastructure/inventory-level.entity';
import { InventoryRepository } from './infrastructure/inventory.repository';
import { InventoryService } from './application/inventory.service';
import { InventoryController } from './presentation/inventory.controller';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryLevel])],
  controllers: [InventoryController],
  providers: [InventoryRepository, InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
