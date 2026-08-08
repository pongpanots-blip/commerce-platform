import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorefrontApiKeyGuard } from './storefront-api-key.guard';
import { StorefrontCatalogService } from './catalog/storefront-catalog.service';
import { StorefrontCatalogController } from './catalog/storefront-catalog.controller';
import { StorefrontCheckoutService } from './checkout/storefront-checkout.service';
import { StorefrontCheckoutController } from './checkout/storefront-checkout.controller';
import { StorefrontOrdersController } from './orders/storefront-orders.controller';
import { StorefrontCustomersService } from './customers/storefront-customers.service';
import { StorefrontCustomersController } from './customers/storefront-customers.controller';
import { OrderModule } from '../modules/commerce/order/order.module';
import { PaymentModule } from '../modules/commerce/payment/payment.module';
import { CustomerModule } from '../modules/commerce/customer/customer.module';
import { IntegrationModule } from '../modules/integration/integration.module';
import { MappingModule } from '../modules/integration/mapping/mapping.module';
import { ApiKeyModule } from '../modules/core/api-key/api-key.module';
import { Customer } from '../modules/commerce/customer/infrastructure/customer.entity';
import { Integration } from '../modules/integration/integration/infrastructure/integration.entity';

@Module({
  imports: [
    OrderModule,
    PaymentModule,
    CustomerModule,
    IntegrationModule,
    MappingModule,
    ApiKeyModule,
    TypeOrmModule.forFeature([Customer, Integration]),
  ],
  controllers: [
    StorefrontCatalogController,
    StorefrontCheckoutController,
    StorefrontOrdersController,
    StorefrontCustomersController,
  ],
  providers: [StorefrontApiKeyGuard, StorefrontCatalogService, StorefrontCheckoutService, StorefrontCustomersService],
})
export class StorefrontModule {}
