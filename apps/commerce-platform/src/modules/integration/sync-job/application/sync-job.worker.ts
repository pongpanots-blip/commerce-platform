import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { SyncJob, SyncOperation } from '../infrastructure/sync-job.entity';
import { Integration } from '../../integration/infrastructure/integration.entity';
import { ConnectorRegistry } from '../../connector/connector-registry';
import {
  AdapterContext,
  CommerceAdapter,
  SyncResult,
} from '../../adapter/domain/commerce-adapter.interface';
import { QUEUES } from '../../../../config/redis.config';

const OPERATION_METHOD: Record<SyncOperation, keyof CommerceAdapter> = {
  customers: 'syncCustomers',
  products: 'syncProducts',
  inventory: 'syncInventory',
  prices: 'syncPrices',
};

/** Executes a sync job by resolving the integration's adapter and running it. */
@Processor(QUEUES.SYNC)
export class SyncJobWorker extends WorkerHost {
  private readonly logger = new Logger(SyncJobWorker.name);

  constructor(
    @InjectRepository(SyncJob) private readonly jobRepo: Repository<SyncJob>,
    @InjectRepository(Integration) private readonly integrationRepo: Repository<Integration>,
    private readonly registry: ConnectorRegistry,
  ) {
    super();
  }

  async process(job: Job<{ syncJobId: string }>): Promise<void> {
    await this.handle(job.data.syncJobId);
  }

  async handle(syncJobId: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: syncJobId } });
    if (!job) {
      throw new Error(`Sync job ${syncJobId} not found`);
    }
    const integration = await this.integrationRepo.findOne({ where: { id: job.integrationId } });
    if (!integration) {
      throw new Error(`Integration ${job.integrationId} not found`);
    }

    job.status = 'running';
    await this.jobRepo.save(job);

    try {
      const adapter = this.registry.resolve(integration.type);
      const method = OPERATION_METHOD[job.operation];
      const ctx: AdapterContext = { integrationId: job.integrationId };
      const result: SyncResult = await (
        adapter[method] as (c: AdapterContext) => Promise<SyncResult>
      )(ctx);

      job.status = 'completed';
      job.result = result;
      job.error = null;
      await this.jobRepo.save(job);
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`Sync job ${job.id} failed: ${job.error}`);
      await this.jobRepo.save(job);
      throw error;
    }
  }
}
