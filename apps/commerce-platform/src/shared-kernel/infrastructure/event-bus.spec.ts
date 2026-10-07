import { EntityManager, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
    query: jest.fn().mockResolvedValue([]),
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
    // Postgres holds the NOTIFY until commit, so the relay never wakes for a rolled-back row.
    expect(repo.query).toHaveBeenCalledWith("SELECT pg_notify('outbox_pending', '')");
  });

  it('stamps each row with its real insert time, so events of one transaction keep their publish order', async () => {
    const repo = repoMock();
    repo.save.mockImplementation((async (x: object) => ({ ...x, id: 'row-1' })) as never);
    await new EventEmitterBus(repo).publish(new DemoEvent('agg-1', { id: 'agg-1' }));
    // created_at defaults to now() = the transaction start, identical for every event of one transaction;
    // the relay orders by created_at, so without this two events of one transaction could swap.
    expect(repo.query).toHaveBeenCalledWith('UPDATE outbox_messages SET created_at = clock_timestamp() WHERE id = $1', ['row-1']);
  });

  it('uses the transaction manager repo when a manager is passed', async () => {
    const repo = repoMock();
    const txRepo = repoMock();
    const manager = { getRepository: jest.fn().mockReturnValue(txRepo) } as unknown as EntityManager;
    const bus = new EventEmitterBus(repo);
    await bus.publish(new DemoEvent('agg-2', { id: 'agg-2' }), manager);
    expect(txRepo.save).toHaveBeenCalled();
    expect(txRepo.query).toHaveBeenCalled(); // NOTIFY inside the caller's transaction
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('OutboxRelayWorker', () => {
  function make(rows: Partial<OutboxMessage>[], locked = true) {
    const repo = repoMock();
    (repo.find as jest.Mock).mockResolvedValueOnce(rows).mockResolvedValue([]);
    const manager = { query: jest.fn().mockResolvedValue([{ locked }]), getRepository: () => repo };
    (repo as unknown as { manager: unknown }).manager = { transaction: (fn: (m: unknown) => unknown) => fn(manager), connection: { options: {} } };
    const order: string[] = [];
    const emitter = {
      emitAsync: jest.fn(async (type: string, e: { aggregateId: string }) => {
        order.push(`start ${e.aggregateId}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end ${e.aggregateId}`);
      }),
    } as unknown as EventEmitter2;
    return { worker: new OutboxRelayWorker(repo, emitter), repo, emitter, manager, order };
  }
  const row = (id: string, agg: string, attempts = 0) =>
    ({ id, type: 'demo.created', aggregateId: agg, payload: {}, metadata: {}, status: 'pending', attempts }) as Partial<OutboxMessage>;

  it('emits oldest-first, each event\'s listeners finishing before the next, then marks rows published', async () => {
    const { worker, repo, order, manager } = make([row('r1', 'a'), row('r2', 'b')]);
    await worker.processPending();
    expect(manager.query).toHaveBeenCalledWith('SELECT pg_try_advisory_xact_lock($1) AS locked', [expect.any(Number)]);
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'pending' }, order: { createdAt: 'ASC' } }));
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
    expect(repo.save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'r1', status: 'published' }),
      expect.objectContaining({ id: 'r2', status: 'published' }),
    ]);
  });

  it('another instance holds the relay lock → touches nothing', async () => {
    const { worker, repo, emitter } = make([row('r1', 'a')], false);
    await worker.processPending();
    expect(repo.find).not.toHaveBeenCalled();
    expect(emitter.emitAsync).not.toHaveBeenCalled();
  });

  it('a wake-up during a run makes it go round again instead of overlapping', async () => {
    const { worker, repo, emitter } = make([row('r1', 'a')]);
    const first = worker.processPending();
    await worker.processPending(); // arrives mid-run: returns at once, flags another pass
    await first;
    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(repo.find).toHaveBeenCalledTimes(2); // second pass found nothing new
  });

  it('increments attempts and marks failed after the max on repeated errors', async () => {
    const { worker, repo, emitter } = make([row('r2', 'a', 4)]);
    (emitter.emitAsync as jest.Mock).mockRejectedValue(new Error('listener blew up'));
    await worker.processPending();
    expect(repo.save).toHaveBeenCalledWith([expect.objectContaining({ id: 'r2', status: 'failed', attempts: 5 })]);
  });
});
