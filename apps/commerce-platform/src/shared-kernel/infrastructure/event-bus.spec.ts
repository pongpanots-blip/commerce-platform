import { EntityManager, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { EventEmitterBus } from './event-emitter.bus';
import { OutboxRelayWorker } from './outbox-relay.worker';
import { OutboxMessage } from './outbox.entity';
import { DomainEvent } from '../domain/domain-event';

class DemoEvent extends DomainEvent<{ id: string }> {
  readonly type = 'demo.created';
}

function repoMock(): jest.Mocked<Repository<OutboxMessage>> {
  return {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
    find: jest.fn(),
  } as unknown as jest.Mocked<Repository<OutboxMessage>>;
}

describe('EventEmitterBus', () => {
  it('persists a pending outbox row via the default repo', async () => {
    const repo = repoMock();
    const bus = new EventEmitterBus(repo);
    await bus.publish(new DemoEvent('agg-1', { id: 'agg-1' }));
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'demo.created',
        aggregateId: 'agg-1',
        status: 'pending',
        attempts: 0,
      }),
    );
  });

  it('uses the transaction manager repo when a manager is passed', async () => {
    const repo = repoMock();
    const txRepo = repoMock();
    const manager = { getRepository: jest.fn().mockReturnValue(txRepo) } as unknown as EntityManager;
    const bus = new EventEmitterBus(repo);
    await bus.publish(new DemoEvent('agg-2', { id: 'agg-2' }), manager);
    expect(txRepo.save).toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('OutboxRelayWorker', () => {
  function make(rows: Partial<OutboxMessage>[]) {
    const repo = repoMock();
    (repo.find as jest.Mock).mockResolvedValue(rows);
    const emitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const queue = { add: jest.fn() } as unknown as Queue;
    return { worker: new OutboxRelayWorker(repo, emitter, queue), repo, emitter, queue };
  }

  it('emits in-process, enqueues, and marks the row published', async () => {
    const { worker, repo, emitter, queue } = make([
      { id: 'r1', type: 'demo.created', aggregateId: 'agg-1', payload: {}, metadata: {}, status: 'pending', attempts: 0 },
    ]);
    await worker.processPending();
    expect(emitter.emit).toHaveBeenCalledWith('demo.created', expect.objectContaining({ aggregateId: 'agg-1' }));
    expect(queue.add).toHaveBeenCalledWith('publish', expect.objectContaining({ outboxId: 'r1' }));
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', status: 'published' }));
  });

  it('increments attempts and marks failed after the max on repeated errors', async () => {
    const { worker, repo, queue } = make([
      { id: 'r2', type: 'demo.created', aggregateId: 'a', payload: {}, metadata: {}, status: 'pending', attempts: 4 },
    ]);
    (queue.add as jest.Mock).mockRejectedValue(new Error('redis down'));
    await worker.processPending();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r2', status: 'failed', attempts: 5 }),
    );
  });
});
