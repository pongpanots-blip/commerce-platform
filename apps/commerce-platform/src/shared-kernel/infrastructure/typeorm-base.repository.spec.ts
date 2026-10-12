import { ILike, Repository } from 'typeorm';
import { TypeOrmBaseRepository } from './typeorm-base.repository';

interface Row {
  id: string;
  name: string;
}

class RowRepo extends TypeOrmBaseRepository<Row> {
  constructor(repo: Repository<Row>) {
    super(repo);
  }
}

function mockRepo(overrides: Partial<Repository<Row>> = {}): Repository<Row> {
  return {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    softDelete: jest.fn(),
    ...overrides,
  } as unknown as Repository<Row>;
}

describe('TypeOrmBaseRepository', () => {
  it('findById delegates to findOne with the id', async () => {
    const inner = mockRepo({ findOne: jest.fn().mockResolvedValue({ id: '1', name: 'a' }) });
    const repo = new RowRepo(inner);
    const found = await repo.findById('1');
    expect(inner.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    expect(found).toEqual({ id: '1', name: 'a' });
  });

  it('findMany paginates: computes skip/take and reports total/page', async () => {
    const inner = mockRepo({
      findAndCount: jest.fn().mockResolvedValue([[{ id: '1', name: 'a' }], 3]),
    });
    const repo = new RowRepo(inner);
    const res = await repo.findMany({ page: 2, pageSize: 1 });
    expect(inner.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 1, take: 1 }),
    );
    expect(res).toEqual({ items: [{ id: '1', name: 'a' }], total: 3, page: 2, pageSize: 1 });
  });

  it('findMany caps pageSize at 100', async () => {
    const inner = mockRepo({ findAndCount: jest.fn().mockResolvedValue([[], 0]) });
    const repo = new RowRepo(inner);
    await repo.findMany({ pageSize: 500 });
    expect(inner.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('softDelete delegates to repo.softDelete', async () => {
    const inner = mockRepo();
    const repo = new RowRepo(inner);
    await repo.softDelete('9');
    expect(inner.softDelete).toHaveBeenCalledWith('9');
  });

  it('findMany ORs the search over each field, keeping the base where and escaping wildcards', async () => {
    const inner = mockRepo({ findAndCount: jest.fn().mockResolvedValue([[], 0]) });
    await new RowRepo(inner).findMany({ where: { status: 'active' }, search: { term: '50%_off', fields: ['sku', 'name'] } });
    expect(inner.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: [
        { status: 'active', sku: ILike('%50\\%\\_off%') },
        { status: 'active', name: ILike('%50\\%\\_off%') },
      ],
    }));
  });
});
