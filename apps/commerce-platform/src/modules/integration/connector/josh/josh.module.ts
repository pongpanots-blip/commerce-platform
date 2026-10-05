import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JoshCatalogProduct } from './josh-catalog-product.entity';
import { JoshCatalogSyncService } from './josh-catalog-sync.service';
import { JoshReplica } from './josh-replica';
import { CustomerMetricsOffloadJob } from './customer-metrics-offload.job';
import { BestsellersOffloadJob } from './bestsellers-offload.job';
import { JoshInsights } from './josh-insights';
import { SystemHealthReport } from './system-health';
import { RestaurantPlaces } from './restaurant-places';
import { JoshErpLogs } from './josh-erp-logs';
import { JoshPushCampaigns } from './josh-push-campaigns';
import { JoshActions } from './josh-actions';
import { JoshProducts } from './josh-products';
import { JoshOrders } from './josh-orders';
import { JoshCustomers } from './josh-customers';
import { JoshPrices } from './josh-prices';
import { JagotaShadow } from './jagota/jagota-shadow';
import { JagotaShadowController } from './jagota/jagota-shadow.controller';
import { JagotaShadowCheck } from './jagota/jagota-shadow-check.entity';
import { JagotaOrderSend } from './jagota/jagota-order-send.entity';
import { JagotaGateway } from './jagota/jagota-gateway';
import { JagotaGatewayController, JagotaGatewayReportController, JagotaSyncHistoryController } from './jagota/jagota-gateway.controller';
import { JoshPromotions } from './josh-promotions';
import { OrderQuoteShadow } from './checkout/order-quote-shadow';
import { OrderQuoteShadowController } from './checkout/order-quote-shadow.controller';
import { OrderQuoteCheck } from './checkout/order-quote-check.entity';
import { JoshMarketingWorkflows } from './josh-marketing-workflows';
import { JoshMarketingWorkflowsController } from './josh-marketing-workflows.controller';
import { DbdLookup } from './dbd-lookup.entity';
import { DbdRelayController } from './dbd-relay.controller';
import { JoshPromotionsController } from './josh-promotions.controller';
import { JagotaSyncHistoryImport } from './jagota/jagota-sync-history';
import { JagotaSyncHistory } from './jagota/jagota-sync-history.entity';
import { StorefrontApiKeyGuard } from '../../../../storefront/storefront-api-key.guard';
import { ApiKeyModule } from '../../../core/api-key/api-key.module';
import { JoshActionsController } from './josh-actions.controller';
import { JoshWinback } from './winback/josh-winback';
import { JoshWinbackController } from './winback/josh-winback.controller';
import { ShopReportsController } from './shop-reports.controller';
import { JoshBackoffice } from './josh-backoffice';
import { JoshApiLogs } from './josh-api-logs';
import { JoshBackofficeController } from './josh-backoffice.controller';
import { PriceShadow } from './pricing/price-shadow';
import { PriceShadowController } from './pricing/price-shadow.controller';
import { PriceShadowCheck } from './pricing/price-shadow-check.entity';
import { StaffPrice } from './pricing/staff-price.entity';
import { StaffPrices } from './pricing/staff-prices';
import { StaffPricesController } from './pricing/staff-prices.controller';
import { WebhookSubscriptionModule } from '../../webhook-subscription/webhook-subscription.module';

/** Everything that reads josh's data (via its replica): the catalog copy and the offloaded heavy jobs (Task 9). */
@Module({
  imports: [TypeOrmModule.forFeature([JoshCatalogProduct, JagotaShadowCheck, JagotaOrderSend, JagotaSyncHistory, DbdLookup, OrderQuoteCheck, PriceShadowCheck, StaffPrice]), WebhookSubscriptionModule, ApiKeyModule],
  controllers: [ShopReportsController, JoshWinbackController, JoshActionsController, JagotaShadowController, JagotaGatewayController, JagotaGatewayReportController, JagotaSyncHistoryController, JoshBackofficeController, PriceShadowController, StaffPricesController, JoshPromotionsController, DbdRelayController, JoshMarketingWorkflowsController, OrderQuoteShadowController],
  providers: [JoshReplica, JoshCatalogSyncService, CustomerMetricsOffloadJob, BestsellersOffloadJob, JoshInsights, SystemHealthReport, RestaurantPlaces, JoshErpLogs, JoshWinback, JoshPushCampaigns, JoshActions, JoshProducts, JoshOrders, JoshCustomers, JoshPrices, JagotaShadow, JagotaGateway, JagotaSyncHistoryImport, JoshBackoffice, JoshApiLogs, PriceShadow, StaffPrices, JoshPromotions, JoshMarketingWorkflows, OrderQuoteShadow, StorefrontApiKeyGuard],
  exports: [JoshReplica, JoshCatalogSyncService, JoshInsights, SystemHealthReport, RestaurantPlaces, JoshErpLogs, JoshWinback, JoshPushCampaigns, JoshActions, JoshProducts, JoshOrders, JoshCustomers, JoshPrices, JagotaShadow, JagotaGateway, JagotaSyncHistoryImport, JoshBackoffice, JoshApiLogs, PriceShadow, StaffPrices, JoshPromotions, JoshMarketingWorkflows, OrderQuoteShadow],
})
export class JoshModule {}
