import { DataSource } from 'typeorm';
import { InventoryService } from './application/inventory.service';
import { InventoryRepository } from './infrastructure/inventory.repository';
import { IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';

function makeTx() {
  const managerRepo = { create: jest.fn((x) => x), save: jest.fn(async (x) => ({ id: 'i-1', ...x })) };
  const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  } as unknown as DataSource;
  return { dataSource, manager };
}

describe('InventoryService', () => {
  it('publishes inventory.updated when quantity changes', async () => {
    const { dataSource, manager } = makeTx();
    const eventBus = { publish: jest.fn() } as unknown as IEventBus;
    const repo = {
      findById: jest.fn().mockResolvedValue({ id: 'i-1', quantity: '5', reserved: '0' }),
    } as unknown as InventoryRepository;

    const svc = new InventoryService(repo, dataSource, eventBus);
    await svc.update('i-1', { quantity: '9' });

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'inventory.updated', payload: expect.objectContaining({ quantity: 9 }) }),
      manager,
    );
  });

  it('does NOT publish when an unrelated field changes', async () => {
    const { dataSource } = makeTx();
    const eventBus = { publish: jest.fn() } as unknown as IEventBus;
    const repo = {
      findById: jest.fn().mockResolvedValue({ id: 'i-1', quantity: '5', reserved: '0', warehouseId: 'w1' }),
    } as unknown as InventoryRepository;

    const svc = new InventoryService(repo, dataSource, eventBus);
    await svc.update('i-1', { warehouseId: 'w2' });

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('publishes inventory.updated on create', async () => {
    const { dataSource, manager } = makeTx();
    const eventBus = { publish: jest.fn() } as unknown as IEventBus;
    const repo = {} as unknown as InventoryRepository;

    const svc = new InventoryService(repo, dataSource, eventBus);
    await svc.create({ productId: 'p', warehouseId: 'w', quantity: '10' });

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'inventory.updated' }),
      manager,
    );
  });
});

describe('InventoryService.findMany with productId filter', () => {
  it('passes productId filter to repo', async () => {
    const eventBus = { publish: jest.fn() } as unknown as IEventBus;
    const repo = {
      findMany: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    } as unknown as InventoryRepository;
    const dataSource = { transaction: jest.fn() } as unknown as DataSource;

    const svc = new InventoryService(repo, dataSource, eventBus);
    await svc.findMany({ page: 1, pageSize: 20, where: { productId: 'test-product-id' } });

    expect(repo.findMany).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      where: { productId: 'test-product-id' },
    });
  });
});
