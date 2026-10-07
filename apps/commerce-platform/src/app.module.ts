import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { buildDataSourceOptions } from './config/typeorm.config';
import { buildRedisConnection } from './config/redis.config';
import { EventBusModule } from './shared-kernel/infrastructure/event-bus.module';
import { AdminModule } from './admin/admin.module';
import { StorefrontModule } from './storefront/storefront.module';
import { PortalModule } from './portal/portal.module';

// Integration
import { IntegrationModule } from './modules/integration/integration.module';
import { ReservationGatewayModule } from './modules/integration/reservation-gateway/reservation-gateway.module';
import { MappingModule } from './modules/integration/mapping/mapping.module';
import { WebhookModule } from './modules/integration/webhook/webhook.module';
import { WebhookSubscriptionModule } from './modules/integration/webhook-subscription/webhook-subscription.module';
import { SyncJobModule } from './modules/integration/sync-job/sync-job.module';

// Commerce — implemented slices
import { CustomerModule } from './modules/commerce/customer/customer.module';
import { ProductModule } from './modules/commerce/product/product.module';
import { InventoryModule } from './modules/commerce/inventory/inventory.module';
import { ReservationModule } from './modules/commerce/reservation/reservation.module';

// Core — scaffolds (cycle-2)
import { AuthModule } from './modules/core/auth/auth.module';
import { UserModule } from './modules/core/user/user.module';
import { CompanyModule } from './modules/core/company/company.module';
import { OrganizationModule } from './modules/core/organization/organization.module';
import { AuditModule } from './modules/core/audit/audit.module';
import { SettingsModule } from './modules/core/settings/settings.module';
import { ApiKeyModule } from './modules/core/api-key/api-key.module';

// Commerce — scaffolds (cycle-2)
import { CategoryModule } from './modules/commerce/category/category.module';
import { BrandModule } from './modules/commerce/brand/brand.module';
import { SupplierModule } from './modules/commerce/supplier/supplier.module';
import { WarehouseModule } from './modules/commerce/warehouse/warehouse.module';
import { PriceListModule } from './modules/commerce/price-list/price-list.module';
import { PromotionModule } from './modules/commerce/promotion/promotion.module';
import { OrderModule } from './modules/commerce/order/order.module';
import { ShipmentModule } from './modules/commerce/shipment/shipment.module';
import { PaymentModule } from './modules/commerce/payment/payment.module';

// Platform — scaffolds (cycle-2)
import { NotificationModule } from './modules/platform/notification/notification.module';
import { FileStorageModule } from './modules/platform/file-storage/file-storage.module';
import { SearchModule } from './modules/platform/search/search.module';
import { ScrapingModule } from './modules/platform/scraping/scraping.module';
import { MarketingResearchModule } from './modules/platform/marketing-research/marketing-research.module';
import { GrowthModule } from './modules/integration/growth/growth.module';
import { WinbackModule } from './modules/integration/winback/winback.module';
import { CompetitorPricesModule } from './modules/integration/competitor-prices/competitor-prices.module';
import { CustomersModule } from './modules/integration/customers/customers.module';
import { SegmentsModule } from './modules/integration/segments/segments.module';
import { ProductPricesModule } from './modules/commerce/product-prices/product-prices.module';
import { ProductContentsModule } from './modules/commerce/product-contents/product-contents.module';
import { ProductCategoriesModule } from './modules/commerce/product-categories/product-categories.module';
import { ProductMastersModule } from './modules/commerce/product-masters/product-masters.module';
import { ProductPromotionRulesModule } from './modules/commerce/product-promotion-rules/product-promotion-rules.module';
import { ProductImagesModule } from './modules/commerce/product-images/product-images.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDataSourceOptions(process.env),
    }),
    BullModule.forRootAsync({
      useFactory: () => ({ connection: buildRedisConnection(process.env) }),
    }),
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),
    ScheduleModule.forRoot(),
    EventBusModule,
    AdminModule,
    StorefrontModule,
    PortalModule,

    // Integration framework
    IntegrationModule,
    ReservationGatewayModule,
    MappingModule,
    WebhookModule,
    WebhookSubscriptionModule,
    SyncJobModule,

    // Commerce slices
    CustomerModule,
    ProductModule,
    InventoryModule,
    ReservationModule,

    // Core scaffolds
    AuthModule,
    UserModule,
    CompanyModule,
    OrganizationModule,
    AuditModule,
    SettingsModule,
    ApiKeyModule,

    // Commerce scaffolds
    CategoryModule,
    BrandModule,
    SupplierModule,
    WarehouseModule,
    PriceListModule,
    PromotionModule,
    OrderModule,
    ShipmentModule,
    PaymentModule,

    // Platform scaffolds
    NotificationModule,
    FileStorageModule,
    SearchModule,
    ScrapingModule,
    MarketingResearchModule,
    GrowthModule,
    WinbackModule,
    CompetitorPricesModule,
    CustomersModule,
    ProductPricesModule,
    ProductContentsModule,
    ProductCategoriesModule,
    ProductMastersModule,
    ProductImagesModule,
    ProductPromotionRulesModule,
    SegmentsModule,
    McpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
