import { OrderService } from './order.service';

function makeService() {
  const saves: Record<string, unknown>[] = [];
  const repoFor = (name: string) => ({
    create: (r: unknown) => r,
    save: jest.fn().mockImplementation(async (r) => {
      const saved = Array.isArray(r) ? r.map((x, i) => ({ id: `${name}-${i}`, ...x }))
                                     : { id: `${name}-1`, ...r };
      saves.push({ name, saved });
      return saved;
    }),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  });
  const repos = new Map<unknown, ReturnType<typeof repoFor>>();
  const manager = {
    getRepository: jest.fn().mockImplementation((entity: { name: string }) => {
      if (!repos.has(entity)) repos.set(entity, repoFor(entity.name));
      return repos.get(entity);
    }),
  };
  const dataSource = { transaction: (fn: (m: unknown) => unknown) => fn(manager) };
  const orderRepo = { findById: jest.fn(), findMany: jest.fn(), save: jest.fn(), softDelete: jest.fn() };
  return { service: new OrderService(orderRepo as never, dataSource as never), saves };
}

describe('OrderService.createWithLines', () => {
  it('creates order draft with computed totals and line rows', async () => {
    const { service, saves } = makeService();
    const order = await service.createWithLines({
      customerId: 'c1',
      lines: [
        { productId: 'p1', qty: 2, unitPrice: 100 },
        { productId: 'p2', qty: 1, unitPrice: 50.5 },
      ],
    });
    expect(order).toMatchObject({ status: 'draft', total: '250.50' });
    const lineSave = saves.find((s) => s.name === 'OrderLine');
    expect(lineSave).toBeDefined();
  });

  it('order total equals the sum of ROUNDED line totals (financial integrity)', async () => {
    const { service, saves } = makeService();
    const order = await service.createWithLines({
      customerId: 'c1',
      lines: [
        { productId: 'p1', qty: 1, unitPrice: 0.005 },
        { productId: 'p2', qty: 1, unitPrice: 0.005 },
        { productId: 'p3', qty: 1, unitPrice: 0.005 },
      ],
    });
    const lineSave = saves.find((s) => s.name === 'OrderLine');
    const savedLines = lineSave?.saved as { lineTotal: string }[];
    expect(savedLines).toHaveLength(3);
    for (const line of savedLines) {
      expect(line.lineTotal).toBe('0.01');
    }
    expect(order.total).toBe('0.03');
  });

  it('rejects an empty line list', async () => {
    const { service } = makeService();
    await expect(service.createWithLines({ customerId: 'c1', lines: [] }))
      .rejects.toThrow('at least one line');
  });
});

describe('OrderService.findMany with customerId filter', () => {
  it('passes customerId filter to repo', async () => {
    const { service } = makeService();
    const mockResult = { items: [], total: 0, page: 1, pageSize: 20 };
    service['repo'].findMany = jest.fn().mockResolvedValue(mockResult);

    await service.findMany({ page: 1, pageSize: 20, where: { customerId: 'test-customer-id' } });

    expect(service['repo'].findMany).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      where: { customerId: 'test-customer-id' },
    });
  });
});
