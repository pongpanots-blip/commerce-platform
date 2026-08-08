import { AdminService } from './admin.service';

function makeService(rows: unknown[] = [], total = rows.length) {
  const erpIngest = { findAndCount: jest.fn().mockResolvedValue([rows, total]) };
  const erpIngestService = { apply: jest.fn().mockResolvedValue({ id: 'r-1', status: 'applied' }) };
  const noop = {} as never;
  const service = new AdminService(
    noop, noop, noop, noop, noop, noop, noop, // integrations, webhooks, syncJobs, outbox, customers, products, inventory
    erpIngest as never,
    erpIngestService as never,
  );
  return { service, erpIngest, erpIngestService };
}

describe('AdminService.listErpIngest', () => {
  it('defaults to page 1 / pageSize 20, orders by createdAt DESC, no filters', async () => {
    const { service, erpIngest } = makeService([{ id: 'r-1' }], 1);
    const res = await service.listErpIngest({});
    expect(erpIngest.findAndCount).toHaveBeenCalledWith({
      where: {},
      order: { createdAt: 'DESC' },
      skip: 0,
      take: 20,
    });
    expect(res).toEqual({ items: [{ id: 'r-1' }], total: 1, page: 1, pageSize: 20 });
  });

  it('applies entityType and status filters', async () => {
    const { service, erpIngest } = makeService([], 0);
    await service.listErpIngest({ entityType: 'product', status: 'failed' });
    expect(erpIngest.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityType: 'product', status: 'failed' } }),
    );
  });

  it('paginates using page/pageSize (skip = (page-1)*pageSize)', async () => {
    const { service, erpIngest } = makeService([], 45);
    const res = await service.listErpIngest({ page: 3, pageSize: 10 });
    expect(erpIngest.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(res).toEqual({ items: [], total: 45, page: 3, pageSize: 10 });
  });

  it('clamps pageSize to a maximum of 100', async () => {
    const { service, erpIngest } = makeService([], 0);
    await service.listErpIngest({ pageSize: 500 });
    expect(erpIngest.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('treats non-positive page/pageSize as defaults', async () => {
    const { service, erpIngest } = makeService([], 0);
    await service.listErpIngest({ page: 0, pageSize: -5 });
    expect(erpIngest.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20 }));
  });
});

describe('AdminService.applyErpIngest', () => {
  it('delegates to ErpIngestService.apply', async () => {
    const { service, erpIngestService } = makeService();
    const res = await service.applyErpIngest('r-1');
    expect(erpIngestService.apply).toHaveBeenCalledWith('r-1');
    expect(res).toEqual({ id: 'r-1', status: 'applied' });
  });
});
