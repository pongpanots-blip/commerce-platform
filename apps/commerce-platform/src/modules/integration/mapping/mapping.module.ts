import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerMapping } from './infrastructure/customer-mapping.entity';
import { ProductMapping } from './infrastructure/product-mapping.entity';
import { OrderMapping } from './infrastructure/order-mapping.entity';
import { InventoryMapping } from './infrastructure/inventory-mapping.entity';
import { SupplierMapping } from './infrastructure/supplier-mapping.entity';
import { MappingService } from './application/mapping.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomerMapping,
      ProductMapping,
      OrderMapping,
      InventoryMapping,
      SupplierMapping,
    ]),
  ],
  providers: [MappingService],
  exports: [MappingService],
})
export class MappingModule {}
