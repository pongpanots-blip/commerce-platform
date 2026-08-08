import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { SyncJob, SyncOperation } from '../infrastructure/sync-job.entity';
import { QUEUES } from '../../../../config/redis.config';

/** Creates and enqueues sync jobs; the worker executes them. */
@Injectable()
export class SyncJobService {
  constructor(
    @InjectRepository(SyncJob) private readonly repo: Repository<SyncJob>,
    @InjectQueue(QUEUES.SYNC) private readonly queue: Queue,
  ) {}

  async trigger(integrationId: string, operation: SyncOperation): Promise<SyncJob> {
    const job = await this.repo.save(
      this.repo.create({ integrationId, operation, status: 'pending' }),
    );
    await this.queue.add('run', { syncJobId: job.id });
    return job;
  }

  list(limit = 100): Promise<SyncJob[]> {
    return this.repo.find({ order: { createdAt: 'DESC' }, take: limit });
  }
}
