import { DataSource } from 'typeorm';
import { CustomerService } from './application/customer.service';
import { CustomerRepository } from './infrastructure/customer.repository';
import { IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';

function makeTxDataSource() {
  const managerRepo = { create: jest.fn((x) => x), save: jest.fn(async (x) => ({ id: 'c-1', ...x })) };
  const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  } as unknown as DataSource;
  return { dataSource, manager, managerRepo };
}

describe('CustomerService', () => {
  it('create persists and publishes customer.created in the same transaction', async () => {
    const { dataSource, manager, managerRepo } = makeTxDataSource();
    const eventBus = { publish: jest.fn() } as unknown as IEventBus;
    const repo = { findById: jest.fn() } as unknown as CustomerRepository;

    const svc = new CustomerService(repo, dataSource, eventBus);
    const result = await svc.create({ name: 'Acme' });

    expect(managerRepo.save).toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'customer.created', aggregateId: 'c-1' }),
      manager,
    );
    expect(result).toEqual(expect.objectContaining({ id: 'c-1', name: 'Acme' }));
  });

  it('update loads the row then publishes customer.updated transactionally', async () => {
    const { dataSource, manager } = makeTxDataSource();
    const eventBus = { publish: jest.fn() } as unknown as IEventBus;
    const repo = {
      findById: jest.fn().mockResolvedValue({ id: 'c-1', name: 'Old' }),
    } as unknown as CustomerRepository;

    const svc = new CustomerService(repo, dataSource, eventBus);
    await svc.update('c-1', { name: 'New' });

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'customer.updated', aggregateId: 'c-1' }),
      manager,
    );
  });
});
