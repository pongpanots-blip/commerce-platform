import { BadRequestException } from '@nestjs/common';
import { PortalWebhooksService } from './portal-webhooks.service';
import { EVENT_CATALOG, PORTAL_EVENT_TYPES } from './event-catalog';

function makeService(rows: Record<string, unknown>[] = [], deliveries: Record<string, unknown>[] = []) {
  const repo = {
    find: jest.fn().mockResolvedValue(rows),
    findOne: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)) ?? null),
    save: jest.fn().mockImplementation(async (r) => ({ id: 'w1', ...r })),
    create: (r: unknown) => r,
  };
  const deliveriesRepo = {
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(deliveries),
    }),
  };
  return { service: new PortalWebhooksService(repo as never, deliveriesRepo as never), repo, deliveriesRepo };
}

describe('PortalWebhooksService', () => {
  it('create stamps accountId and validates event types against the catalog', async () => {
    const { service, repo } = makeService();
    await service.createForAccount('acc1', { name: 'CRM', targetUrl: 'https://crm.example.com/hook',
      eventTypes: ['order.confirmed'], secret: 's' });
    expect((repo.save.mock.calls[0][0] as Record<string, unknown>).accountId).toBe('acc1');
    await expect(service.createForAccount('acc1', { name: 'x', targetUrl: 'https://x', eventTypes: ['nope.event'] }))
      .rejects.toThrow('not available to portal webhooks');
  });

  it('create/update reject customer, ERP sale-order and "*" event types with a 400', async () => {
    const { service, repo } = makeService([{ id: 'w1', accountId: 'acc1', active: true, eventTypes: ['order.created'] }]);
    for (const type of ['customer.updated', 'customer.created', 'erp.sale-order.created', '*']) {
      await expect(service.createForAccount('acc1', { name: 'x', targetUrl: 'https://x.example.com', eventTypes: ['order.created', type] }))
        .rejects.toBeInstanceOf(BadRequestException);
      await expect(service.updateForAccount('w1', 'acc1', { eventTypes: [type] }))
        .rejects.toThrow(`event type "${type}" is not available to portal webhooks`);
    }
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('the portal catalog lists no customer or ERP sale-order events', () => {
    const types = EVENT_CATALOG.map((e) => e.type);
    expect(types.filter((t) => t.startsWith('customer.') || t.startsWith('erp.'))).toEqual([]);
    expect([...PORTAL_EVENT_TYPES].sort()).toEqual([...types].sort());
  });

  it('list/update are account-scoped (404 crossing accounts)', async () => {
    const { service } = makeService([{ id: 'w1', accountId: 'acc1', active: true }]);
    expect(await service.listForAccount('acc1')).toHaveLength(1);
    await expect(service.updateForAccount('w1', 'other', { active: false })).rejects.toThrow('not found');
  });

  it('rejects non-http(s) target URLs', async () => {
    const { service } = makeService();
    await expect(service.createForAccount('acc1', {
      name: 'x', targetUrl: 'ftp://files.example.com/hook', eventTypes: ['order.created'] }))
      .rejects.toThrow('http(s)');
    await expect(service.createForAccount('acc1', {
      name: 'x', targetUrl: 'not a url', eventTypes: ['order.created'] }))
      .rejects.toThrow('invalid target URL');
  });

  it('production blocks private/metadata targets unless explicitly allowed', async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevAllow = process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
      const { service } = makeService();
      await expect(service.createForAccount('acc1', {
        name: 'x', targetUrl: 'http://169.254.169.254/latest/meta-data', eventTypes: ['order.created'] }))
        .rejects.toThrow('not allowed');
      await expect(service.createForAccount('acc1', {
        name: 'x', targetUrl: 'http://localhost:9000/hook', eventTypes: ['order.created'] }))
        .rejects.toThrow('not allowed');
      await expect(service.createForAccount('acc1', {
        name: 'x', targetUrl: 'http://10.1.2.3/hook', eventTypes: ['order.created'] }))
        .rejects.toThrow('not allowed');
      await expect(service.createForAccount('acc1', {
        name: 'x', targetUrl: 'http://172.20.0.5/hook', eventTypes: ['order.created'] }))
        .rejects.toThrow('not allowed');
      await expect(service.createForAccount('acc1', {
        name: 'x', targetUrl: 'http://192.168.1.1/hook', eventTypes: ['order.created'] }))
        .rejects.toThrow('not allowed');
      await expect(service.createForAccount('acc1', {
        name: 'x', targetUrl: 'http://[::1]/hook', eventTypes: ['order.created'] }))
        .rejects.toThrow('not allowed');
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = '1';
      await expect(service.createForAccount('acc1', {
        name: 'x', targetUrl: 'http://localhost:9000/hook', eventTypes: ['order.created'] }))
        .resolves.toBeDefined();
    } finally {
      if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
      if (prevAllow === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
      else process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = prevAllow;
    }
  });

  it('non-production allows localhost targets (local e2e sinks)', async () => {
    const { service, repo } = makeService();
    await service.createForAccount('acc1', {
      name: 'local', targetUrl: 'http://localhost:9000/hook', eventTypes: ['order.created'] });
    expect(repo.save).toHaveBeenCalled();
  });

  it('list/create/update responses exclude secret', async () => {
    const { service } = makeService([{ id: 'w1', accountId: 'acc1', secret: 's3cret', active: true,
      targetUrl: 'https://crm.example.com/hook' }]);
    const rows = await service.listForAccount('acc1');
    expect(rows[0]).not.toHaveProperty('secret');
    const updated = await service.updateForAccount('w1', 'acc1', { active: false });
    expect(updated).not.toHaveProperty('secret');
    const created = await service.createForAccount('acc1', {
      name: 'CRM', targetUrl: 'https://crm.example.com/hook', eventTypes: ['order.confirmed'], secret: 's' });
    expect(created).not.toHaveProperty('secret');
  });

  it('test-send POSTs the example payload and reports status', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as never)
      .mockResolvedValue({ ok: true, status: 200 } as never);
    const { service } = makeService([{ id: 'w1', accountId: 'acc1',
      targetUrl: 'https://crm.example.com/hook', eventTypes: ['order.confirmed'], secret: null }]);
    const res = await service.sendTest('w1', 'acc1');
    expect(fetchSpy).toHaveBeenCalledWith('https://crm.example.com/hook', expect.objectContaining({ method: 'POST' }));
    expect(res).toMatchObject({ ok: true, status: 200 });
    fetchSpy.mockRestore();
  });

  it('recentDeliveriesForAccount returns deliveries for account subscriptions', async () => {
    const { service } = makeService(
      [{ id: 'w1', accountId: 'acc1' }, { id: 'w2', accountId: 'acc1' }],
      [
        { id: 'd1', subscriptionId: 'w1', eventType: 'order.created', targetUrl: 'https://a.com', status: 'success', statusCode: 200, attempts: 1, createdAt: '2024-01-01' },
        { id: 'd2', subscriptionId: 'w2', eventType: 'order.updated', targetUrl: 'https://b.com', status: 'failed', statusCode: 500, attempts: 3, createdAt: '2024-01-02' },
      ],
    );
    const deliveries = await service.recentDeliveriesForAccount('acc1', 10);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0].eventType).toBe('order.created');
    expect(deliveries[0]).toMatchObject({ status: 'success', statusCode: 200 });
    expect(deliveries[1]).toMatchObject({ status: 'failed', statusCode: 500 });
  });

  it('recentDeliveriesForAccount returns empty for account with no subscriptions', async () => {
    const { service } = makeService([], []);
    const deliveries = await service.recentDeliveriesForAccount('acc-no-subs', 10);
    expect(deliveries).toEqual([]);
  });
});
