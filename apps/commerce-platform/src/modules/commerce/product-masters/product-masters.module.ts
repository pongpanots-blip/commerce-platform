import { Module } from '@nestjs/common';
import { ProductMastersController } from './product-masters.controller';
import { ProductMastersService } from './product-masters.service';

/** The ERP product master and its MER queue, owned by commerce (stage 4d). */
@Module({
  controllers: [ProductMastersController],
  providers: [ProductMastersService],
  exports: [ProductMastersService],
})
export class ProductMastersModule {}
