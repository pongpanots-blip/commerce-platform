import { ConflictException } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { ProductService } from './application/product.service';
import { ProductRepository } from './infrastructure/product.repository';
import { IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';

function uniqueViolation() {
  const e = new QueryFailedError('q', [], new Error('dup'));
  (e as unknown as { code: string }).code = '23505';
  return e;
}

describe('ProductService', () => {
  it('maps a unique-violation on create to 409 Conflict', async () => {
    const repo = { save: jest.fn().mockRejectedValue(uniqueViolation()) } as unknown as ProductRepository;
    const svc = new ProductService(repo, {} as DataSource, { publish: jest.fn() } as unknown as IEventBus);
    await expect(svc.create({ sku: 'DUP', name: 'x' })).rejects.toThrow(ConflictException);
  });

  it('update publishes product.updated transactionally', async () => {
    const managerRepo = { save: jest.fn(async (x) => x) };
    const manager = { getRepository: jest.fn().mockReturnValue(managerRepo) };
    const dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
    } as unknown as DataSource;
    const eventBus = { publish: jest.fn() } as unknown as IEventBus;
    const repo = {
      findById: jest.fn().mockResolvedValue({ id: 'p-1', sku: 'A', name: 'old' }),
    } as unknown as ProductRepository;

    const svc = new ProductService(repo, dataSource, eventBus);
    await svc.update('p-1', { name: 'new' });

    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'product.updated', aggregateId: 'p-1' }),
      manager,
    );
  });
});
