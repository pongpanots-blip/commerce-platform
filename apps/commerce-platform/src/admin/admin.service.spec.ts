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

describe('AdminService.stats', () => {
  it('returns the counts plus the Overview card details', async () => {
    const oldest = new Date('2026-10-06T01:00:00Z');
    const stockAt = new Date('2026-10-06T02:00:00Z');
    // count() answers in call order: integrations, webhooks x2, outbox, syncJobs, customers, products, inventory, then the detail counts.
    const repo = (counts: number[], extra: Record<string, unknown> = {}) => ({ count: jest.fn().mockImplementation(() => Promise.resolve(counts.shift())), ...extra });
    const integrations = repo([3, 2]);
    const webhooks = repo([12, 3], { findOne: jest.fn().mockResolvedValue({ id: 'w', createdAt: oldest }) });
    const syncJobs = repo([300, 40, 38, 2]);
    const outbox = repo([0]);
    const customers = repo([150, 18]);
    const products = repo([400]);
    const qb = { select: jest.fn().mockReturnThis(), getRawOne: jest.fn().mockResolvedValue({ n: '3' }) };
    const inventory = repo([1200], { findOne: jest.fn().mockResolvedValue({ id: 'i', updatedAt: stockAt }), createQueryBuilder: jest.fn().mockReturnValue(qb) });
    const service = new AdminService(
      integrations as never, webhooks as never, syncJobs as never, outbox as never,
      customers as never, products as never, inventory as never, {} as never, {} as never,
    );
    const res = await service.stats();
    expect(res).toMatchObject({ integrations: 3, webhooksPending: 12, webhooksFailed: 3, outboxBacklog: 0, syncJobsRecent: 300, customers: 150, products: 400, inventoryLevels: 1200 });
    expect(res.details).toEqual({
      oldestPendingWebhookAt: oldest.toISOString(),
      syncJobs24h: { total: 40, completed: 38, failed: 2 },
      customersNew7d: 18,
      integrationsActive: 2,
      warehouses: 3,
      inventoryUpdatedAt: stockAt.toISOString(),
    });
  });
});
