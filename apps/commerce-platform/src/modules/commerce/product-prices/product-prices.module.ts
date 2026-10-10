import { Module } from '@nestjs/common';
import { ProductPricesController } from './product-prices.controller';
import { ProductPricesService } from './product-prices.service';
import { PriceApprovalController } from './price-approval.controller';
import { PriceApprovalService } from './price-approval.service';

/** Product prices owned by commerce (stage 4a). */
@Module({
  controllers: [ProductPricesController, PriceApprovalController],
  providers: [ProductPricesService, PriceApprovalService],
  exports: [ProductPricesService],
})
export class ProductPricesModule {}
