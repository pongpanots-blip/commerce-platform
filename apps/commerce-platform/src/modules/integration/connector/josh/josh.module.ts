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
import { JoshWinback } from './winback/josh-winback';
import { JoshWinbackController } from './winback/josh-winback.controller';
import { ShopReportsController } from './shop-reports.controller';
import { WebhookSubscriptionModule } from '../../webhook-subscription/webhook-subscription.module';

/** Everything that reads josh's data (via its replica): the catalog copy and the offloaded heavy jobs (Task 9). */
@Module({
  imports: [TypeOrmModule.forFeature([JoshCatalogProduct]), WebhookSubscriptionModule],
  controllers: [ShopReportsController, JoshWinbackController],
  providers: [JoshReplica, JoshCatalogSyncService, CustomerMetricsOffloadJob, BestsellersOffloadJob, JoshInsights, SystemHealthReport, RestaurantPlaces, JoshErpLogs, JoshWinback, JoshPushCampaigns],
  exports: [JoshReplica, JoshCatalogSyncService, JoshInsights, SystemHealthReport, RestaurantPlaces, JoshErpLogs, JoshWinback, JoshPushCampaigns],
})
export class JoshModule {}
