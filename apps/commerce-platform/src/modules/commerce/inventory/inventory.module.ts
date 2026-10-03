import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryLevel } from './infrastructure/inventory-level.entity';
import { InventoryRepository } from './infrastructure/inventory.repository';
import { InventoryService } from './application/inventory.service';
import { InventoryController } from './presentation/inventory.controller';
import { InventoryMovement } from './infrastructure/inventory-movement.entity';
import { InventoryLedgerService } from './application/inventory-ledger.service';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryLevel, InventoryMovement])],
  controllers: [InventoryController],
  providers: [InventoryRepository, InventoryService, InventoryLedgerService],
  exports: [InventoryService, InventoryLedgerService],
})
export class InventoryModule {}
