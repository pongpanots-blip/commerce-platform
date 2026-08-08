import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { SyncJobService } from './application/sync-job.service';
import { SyncJobWorker } from './application/sync-job.worker';
import { SyncJob } from './infrastructure/sync-job.entity';
import { Integration } from '../integration/infrastructure/integration.entity';
import { ConnectorRegistry } from '../connector/connector-registry';
import { ExampleConnector } from '../connector/example/example.connector';

function jobRepoMock() {
  return {
    create: jest.fn((x) => ({ id: 'job-1', ...x })),
    save: jest.fn(async (x) => x),
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<SyncJob>>;
}

describe('SyncJobService', () => {
  it('creates a pending job and enqueues it', async () => {
    const repo = jobRepoMock();
    const queue = { add: jest.fn() } as unknown as Queue;
    const svc = new SyncJobService(repo, queue);
    const job = await svc.trigger('int-1', 'customers');
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ integrationId: 'int-1', operation: 'customers', status: 'pending' }),
    );
    expect(queue.add).toHaveBeenCalledWith('run', { syncJobId: job.id });
  });
});

describe('SyncJobWorker', () => {
  it('runs the resolved adapter operation and records a completed job', async () => {
    const jobRepo = jobRepoMock();
    (jobRepo.findOne as jest.Mock).mockResolvedValue({
      id: 'job-1', integrationId: 'int-1', operation: 'customers', status: 'pending',
    });
    const integrationRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'int-1', type: 'example' }),
    } as unknown as Repository<Integration>;
    const registry = new ConnectorRegistry();
    registry.register('example', new ExampleConnector());

    const worker = new SyncJobWorker(jobRepo, integrationRepo, registry);
    await worker.handle('job-1');

    expect(jobRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', result: { processed: 0, failed: 0 } }),
    );
  });

  it('marks the job failed when no connector is registered', async () => {
    const jobRepo = jobRepoMock();
    (jobRepo.findOne as jest.Mock).mockResolvedValue({
      id: 'job-2', integrationId: 'int-1', operation: 'products', status: 'pending',
    });
    const integrationRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'int-1', type: 'sap' }),
    } as unknown as Repository<Integration>;
    const worker = new SyncJobWorker(jobRepo, integrationRepo, new ConnectorRegistry());

    await expect(worker.handle('job-2')).rejects.toBeDefined();
    expect(jobRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });
});
