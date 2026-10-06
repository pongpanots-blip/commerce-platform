import { BadRequestException } from '@nestjs/common';
import { JoshEventsService } from './josh-events.service';

function makeService(storedVersion: string | null) {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const repo = { upsert: jest.fn(), delete: jest.fn(), insert: jest.fn(), save: jest.fn() };
  const manager = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push([sql, params]);
      if (sql.includes('SELECT source_version')) return storedVersion === null ? [] : [{ source_version: storedVersion }];
      return [];
    }),
    getRepository: jest.fn(() => repo),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)) };
  return { svc: new JoshEventsService(dataSource as never), repo, calls };
}

const ORDER = '11111111-1111-1111-1111-111111111111';
const order = (version: string) => ({
  type: 'order.snapshot', aggregateId: ORDER, version, occurredAt: '2026-10-06T00:00:00Z',
  data: { order: { orders_id: ORDER, status: 'paid', total_price: '10.00' }, items: [{ id: 'i1', order_id: ORDER, product_quantity: 2 }] },
});

describe('JoshEventsService', () => {
  it('applies a newer order snapshot: locks the aggregate, upserts head with source_version, replaces lines', async () => {
    const { svc, calls, repo } = makeService('5');
    expect(await svc.apply(order('6'))).toBe('applied');
    expect(calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(repo.upsert).toHaveBeenCalledWith([expect.objectContaining({ ordersId: ORDER, status: 'paid', sourceVersion: '6' })], ['ordersId']);
    expect(repo.delete).toHaveBeenCalledWith({ ordersId: ORDER });
    expect(repo.insert).toHaveBeenCalledWith([expect.objectContaining({ id: 'i1', productQuantity: 2 })]);
  });

  it('drops an equal or older order snapshot', async () => {
    const { svc, repo } = makeService('6');
    expect(await svc.apply(order('6'))).toBe('stale');
    expect(await svc.apply(order('3'))).toBe('stale');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('compares versions as integers, not strings', async () => {
    const { svc } = makeService('9');
    expect(await svc.apply(order('10'))).toBe('applied');
  });

  it('customer.deleted wipes data and keeps a tombstone that blocks older snapshots', async () => {
    const { svc, repo } = makeService(null);
    expect(await svc.apply({ type: 'customer.deleted', aggregateId: 'u1', version: '9', occurredAt: 'x', data: { id: 'u1' } })).toBe('applied');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', data: {}, sourceVersion: '9', deletedAt: expect.any(Date) }));
  });

  it('stores erp.fallback.received once per josh outbox id', async () => {
    const { svc, calls } = makeService(null);
    await svc.apply({ type: 'erp.fallback.received', aggregateId: 'e1', version: '77', occurredAt: '2026-10-06T01:00:00Z',
      data: { method: 'PUT', path: '/api/erp/products/qty', body: [{ PRODUCT_CODE: 'A' }], receivedAt: '2026-10-06T01:00:00Z' } });
    const insert = calls.find(([s]) => s.includes('josh_erp_fallback_calls'));
    expect(insert?.[0]).toContain('ON CONFLICT (josh_outbox_id) DO NOTHING');
    expect(insert?.[1]?.[0]).toBe('77');
  });

  it('rejects unknown types and a snapshot whose order id does not match', async () => {
    const { svc } = makeService(null);
    await expect(svc.apply({ type: 'nope', aggregateId: 'x', version: '1', occurredAt: 'x', data: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.apply({ ...order('2'), aggregateId: '22222222-2222-2222-2222-222222222222' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
