import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JoshCatalogProduct } from './josh-catalog-product.entity';
import { JoshCatalogSyncService } from './josh-catalog-sync.service';
import { JoshReplica } from './josh-replica';
import { CustomerMetricsOffloadJob } from './customer-metrics-offload.job';
import { BestsellersOffloadJob } from './bestsellers-offload.job';
import { JoshInsights } from './josh-insights';

/** Everything that reads josh's data (via its replica): the catalog copy and the offloaded heavy jobs (Task 9). */
@Module({
  imports: [TypeOrmModule.forFeature([JoshCatalogProduct])],
  providers: [JoshReplica, JoshCatalogSyncService, CustomerMetricsOffloadJob, BestsellersOffloadJob, JoshInsights],
  exports: [JoshReplica, JoshCatalogSyncService, JoshInsights],
})
export class JoshModule {}
