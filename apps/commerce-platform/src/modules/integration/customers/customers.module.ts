import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerMetrics } from './customer-metrics.entity';
import { CustomerMetricsService } from './customer-metrics.service';
import { SalesRepsController } from './sales-reps.controller';
import { SalesRepsService } from './sales-reps.service';

/** Customer marketing data commerce owns: metrics computed from the josh copies (2a), company sales reps (2b). */
@Module({
  imports: [TypeOrmModule.forFeature([CustomerMetrics])],
  controllers: [SalesRepsController],
  providers: [CustomerMetricsService, SalesRepsService],
  exports: [CustomerMetricsService, SalesRepsService],
})
export class CustomersModule {}
