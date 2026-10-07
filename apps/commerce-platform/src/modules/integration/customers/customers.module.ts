import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerMetrics } from './customer-metrics.entity';
import { CustomerMetricsService } from './customer-metrics.service';

/** Customer marketing data commerce owns (stage 2a): metrics computed from the josh copies. */
@Module({
  imports: [TypeOrmModule.forFeature([CustomerMetrics])],
  providers: [CustomerMetricsService],
  exports: [CustomerMetricsService],
})
export class CustomersModule {}
