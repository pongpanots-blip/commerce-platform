import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { SyncJob } from './infrastructure/sync-job.entity';
import { Integration } from '../integration/infrastructure/integration.entity';
import { SyncJobService } from './application/sync-job.service';
import { SyncJobWorker } from './application/sync-job.worker';
import { SyncJobController } from './presentation/sync-job.controller';
import { IntegrationModule } from '../integration.module';
import { QUEUES } from '../../../config/redis.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([SyncJob, Integration]),
    BullModule.registerQueue({ name: QUEUES.SYNC }),
    IntegrationModule,
  ],
  controllers: [SyncJobController],
  providers: [SyncJobService, SyncJobWorker],
  exports: [SyncJobService],
})
export class SyncJobModule {}
