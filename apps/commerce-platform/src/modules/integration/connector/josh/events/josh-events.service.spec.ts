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

  it('customer.deleted also removes the customer\'s metrics and segment memberships (PDPA, stage 2a)', async () => {
    const { svc, calls } = makeService(null);
    await svc.apply({ type: 'customer.deleted', aggregateId: 'u1', version: '9', occurredAt: 'x', data: { id: 'u1' } });
    const sqls = calls.map(([sql]) => sql);
    expect(sqls).toContain('DELETE FROM customer_metrics WHERE user_id = $1');
    expect(sqls).toContain('DELETE FROM segment_members WHERE user_id = $1');
    expect(calls.find(([sql]) => sql.startsWith('DELETE FROM segment_members'))?.[1]).toEqual(['u1']);
  });

  it('an older customer.deleted (stale) removes nothing', async () => {
    const { svc, calls } = makeService('10');
    expect(await svc.apply({ type: 'customer.deleted', aggregateId: 'u1', version: '9', occurredAt: 'x', data: { id: 'u1' } })).toBe('stale');
    expect(calls.map(([sql]) => sql).filter((sql) => sql.startsWith('DELETE'))).toEqual([]);
  });

  it('stores erp.fallback.received once per josh outbox id', async () => {
    const { svc, calls } = makeService(null);
    await svc.apply({ type: 'erp.fallback.received', aggregateId: 'e1', version: '77', occurredAt: '2026-10-06T01:00:00Z',
      data: { method: 'PUT', path: '/api/erp/products/qty', body: [{ PRODUCT_CODE: 'A' }], receivedAt: '2026-10-06T01:00:00Z' } });
    const insert = calls.find(([s]) => s.includes('josh_erp_fallback_calls'));
    expect(insert?.[0]).toContain('ON CONFLICT (josh_outbox_id) DO NOTHING');
    expect(insert?.[1]?.[0]).toBe('77');
  });

  const PRODUCT = '33333333-3333-3333-3333-333333333333';
  const catalog = (version: string, sku = 'S1') => ({
    type: 'catalog.snapshot', aggregateId: PRODUCT, version, occurredAt: 'x',
    data: { id: PRODUCT, sku, status: 'active', selling_unit_price: '120.00', ordering_price: '480.00', order_taking_unit: 'BX',
      category_name_th: 'ผัก', category_name_en: 'Vegetables', image_url: 'https://img/1.jpg',
      translations: [{ language_code: 'th', product_name: 'ผักกาด' }], updated_at: '2026-10-07T01:00:00Z' },
  });

  it('catalog.snapshot upserts the catalog copy with raw values and clears removed_at', async () => {
    const { svc, repo, calls } = makeService('4');
    expect(await svc.apply(catalog('5'))).toBe('applied');
    expect(calls[0][1]).toEqual([`josh_catalog_products:${PRODUCT}`]);
    expect(repo.upsert).toHaveBeenCalledWith([expect.objectContaining({
      id: PRODUCT, sku: 'S1', sellingUnitPrice: '120.00', orderingPrice: '480.00', orderTakingUnit: 'BX',
      categoryNameTh: 'ผัก', categoryNameEn: 'Vegetables', imageUrl: 'https://img/1.jpg', removedAt: null, sourceVersion: '5',
      joshUpdatedAt: new Date('2026-10-07T01:00:00Z'), translations: [{ language_code: 'th', product_name: 'ผักกาด' }],
    })], ['id']);
  });

  it('drops an older catalog.snapshot', async () => {
    const { svc, repo } = makeService('9');
    expect(await svc.apply(catalog('8', 'OLD'))).toBe('stale');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('catalog.deleted marks the copy removed (rows are never deleted) and records the version', async () => {
    const { svc, calls } = makeService('5');
    expect(await svc.apply({ type: 'catalog.deleted', aggregateId: PRODUCT, version: '6', occurredAt: 'x', data: { id: PRODUCT } })).toBe('applied');
    const update = calls.find(([s]) => s.includes('UPDATE josh_catalog_products'));
    expect(update?.[0]).toContain('removed_at = now()');
    expect(update?.[1]).toEqual([PRODUCT, '6']);
  });

  it('rejects a catalog.snapshot whose data id does not match', async () => {
    const { svc } = makeService(null);
    await expect(svc.apply({ ...catalog('2'), aggregateId: '44444444-4444-4444-4444-444444444444' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown types and a snapshot whose order id does not match', async () => {
    const { svc } = makeService(null);
    await expect(svc.apply({ type: 'nope', aggregateId: 'x', version: '1', occurredAt: 'x', data: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.apply({ ...order('2'), aggregateId: '22222222-2222-2222-2222-222222222222' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
