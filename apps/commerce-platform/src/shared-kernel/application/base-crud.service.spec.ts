import { NotFoundException } from '@nestjs/common';
import { IRepository } from '../interfaces/repository.interface';
import { BaseCrudService } from './base-crud.service';

interface Widget {
  id: string;
  name: string;
}

class WidgetService extends BaseCrudService<Widget> {
  constructor(repo: IRepository<Widget>) {
    super(repo);
  }
  protected get entityName() {
    return 'Widget';
  }
}

function mockRepo(overrides: Partial<IRepository<Widget>> = {}): IRepository<Widget> {
  return {
    findById: jest.fn(),
    findMany: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    ...overrides,
  };
}

describe('BaseCrudService', () => {
  it('findOne throws NotFound when the repo returns null', async () => {
    const svc = new WidgetService(mockRepo({ findById: jest.fn().mockResolvedValue(null) }));
    await expect(svc.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('update merges existing with the dto and saves', async () => {
    const existing = { id: '1', name: 'a' };
    const save = jest.fn(async (e: Partial<Widget>) => e as Widget);
    const svc = new WidgetService(
      mockRepo({ findById: jest.fn().mockResolvedValue(existing), save }),
    );
    await svc.update('1', { name: 'b' });
    expect(save).toHaveBeenCalledWith({ id: '1', name: 'b' });
  });

  it('remove verifies existence before soft-deleting', async () => {
    const softDelete = jest.fn();
    const svc = new WidgetService(
      mockRepo({ findById: jest.fn().mockResolvedValue(null), softDelete }),
    );
    await expect(svc.remove('x')).rejects.toThrow(NotFoundException);
    expect(softDelete).not.toHaveBeenCalled();
  });
});
