import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryLevel } from './infrastructure/inventory-level.entity';
import { InventoryRepository } from './infrastructure/inventory.repository';
import { InventoryService } from './application/inventory.service';
import { InventoryController } from './presentation/inventory.controller';
import { InventoryOverviewController } from './presentation/inventory-overview.controller';
import { InventoryMovement } from './infrastructure/inventory-movement.entity';
import { InventoryLedgerService } from './application/inventory-ledger.service';
import { StockMovesService } from './application/stock-moves.service';
import { OrderStockService } from './application/order-stock.service';
import { StockMovesController } from './presentation/stock-moves.controller';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryLevel, InventoryMovement])],
  controllers: [InventoryController, InventoryOverviewController, StockMovesController],
  providers: [InventoryRepository, InventoryService, InventoryLedgerService, StockMovesService, OrderStockService],
  exports: [InventoryService, InventoryLedgerService, OrderStockService],
})
export class InventoryModule {}
