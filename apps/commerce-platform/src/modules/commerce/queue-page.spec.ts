import 'reflect-metadata';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderingController } from './ordering/ordering.controller';
import { OrderingService } from './ordering/ordering.service';
import { ProductMastersController } from './product-masters/product-masters.controller';
import { ProductMastersService } from './product-masters/product-masters.service';
import { ProductPricesController } from './product-prices/product-prices.controller';
import { ProductPricesService } from './product-prices/product-prices.service';
import { QueuePageQuery, queuePage } from './queue-page';

/** The commerce product queues (P-14): opt-in `page`/`limit` → `{ items, total, page, limit }`; none → the legacy array. */

const pipe = new ValidationPipe({ whitelist: true, transform: true }); // as main.ts
const asQuery = (raw: Record<string, unknown>) =>
  pipe.transform(raw, { type: 'query', metatype: QueuePageQuery } as ArgumentMetadata) as Promise<QueuePageQuery>;

/** A DataSource whose query() answers count queries with `total` and everything else with `rows`. */
function fakeDb(rows: unknown[], total = rows.length) {
  const query = jest.fn(async (sql: string, _params?: unknown[]) => (/^SELECT count\(\*\)/.test(sql) ? [{ total }] : rows));
  return { db: { query } as unknown as DataSource, query };
}
const events = { publish: jest.fn() };

describe('QueuePageQuery / queuePage', () => {
  it('no page and no limit means unpaged (legacy callers)', async () => {
    expect(queuePage(await asQuery({}))).toBeUndefined();
    expect(queuePage(await asQuery({ search: 'X' }))).toBeUndefined();
  });

  it('defaults to page 1, limit 20 once either is given', async () => {
    expect(queuePage(await asQuery({ page: '3' }))).toEqual({ page: 3, limit: 20 });
    expect(queuePage(await asQuery({ limit: '50' }))).toEqual({ page: 1, limit: 50 });
    expect(queuePage(await asQuery({ page: '2', limit: '100' }))).toEqual({ page: 2, limit: 100 });
  });

  it.each([{ limit: '101' }, { limit: '0' }, { page: '0' }, { page: 'abc' }, { limit: '1.5' }])('rejects %j', async (raw) => {
    await expect(asQuery(raw)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ProductPricesService', () => {
  it('list without paging keeps the bare array and the 200 cap', async () => {
    const { db, query } = fakeDb([{ sku: 'A' }]);
    const svc = new ProductPricesService(db, events);
    expect(await svc.list(' A ')).toEqual([{ sku: 'A' }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/FROM product_prices WHERE [^]* ORDER BY product_inventory_sku LIMIT 200$/);
    expect(query.mock.calls[0][1]).toEqual(['A']);
  });

  it('list with paging returns items + total, LIMIT/OFFSET as parameters, total over the same filter', async () => {
    const { db, query } = fakeDb([{ sku: 'B' }], 41);
    const svc = new ProductPricesService(db, events);
    expect(await svc.list('', { page: 3, limit: 20 })).toEqual({ items: [{ sku: 'B' }], total: 41, page: 3, limit: 20 });
    const [[page, pageParams], [count, countParams]] = query.mock.calls;
    expect(page).toMatch(/ORDER BY product_inventory_sku LIMIT \$2 OFFSET \$3$/);
    expect(pageParams).toEqual([null, 20, 40]);
    expect(count).toMatch(/^SELECT count\(\*\)::int AS total FROM product_prices WHERE /);
    expect(countParams).toEqual([null]);
  });

  it('pending without paging keeps the 500 cap; with paging it pages newest first with a stable tiebreak', async () => {
    const { db, query } = fakeDb([]);
    const svc = new ProductPricesService(db, events);
    expect(await svc.pending()).toEqual([]);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY q\.received_at DESC, q\.product_inventory_sku LIMIT 500$/);
    query.mockClear();
    expect(await svc.pending('X', { page: 1, limit: 20 })).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(query.mock.calls[0][1]).toEqual(['X', 20, 0]);
    expect(query.mock.calls[1][0]).toMatch(/FROM product_price_pending q LEFT JOIN product_prices p/);
  });
});

describe('ProductMastersService.pending', () => {
  it('keeps the 500 cap unpaged and pages when asked', async () => {
    const { db, query } = fakeDb([{ sku: 'M' }], 7);
    const svc = new ProductMastersService(db, events);
    expect(await svc.pending()).toEqual([{ sku: 'M' }]);
    expect(query.mock.calls[0][0]).toMatch(/FROM product_master_pending q [^]* LIMIT 500$/);
    query.mockClear();
    expect(await svc.pending(undefined, { page: 2, limit: 5 })).toEqual({ items: [{ sku: 'M' }], total: 7, page: 2, limit: 5 });
    expect(query.mock.calls[0][1]).toEqual([null, 5, 5]);
  });
});

describe('OrderingService.periods', () => {
  it('keeps the 1000 cap unpaged and pages when asked', async () => {
    const { db, query } = fakeDb([{ sup_code: 'S1' }], 120);
    const svc = new OrderingService(db, events);
    expect(await svc.periods('S1')).toEqual([{ sup_code: 'S1' }]);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY sup_code, \(status = 'C'\), date_from DESC, erp_order_period LIMIT 1000$/);
    query.mockClear();
    expect(await svc.periods('S1', { page: 6, limit: 20 })).toEqual({ items: [{ sup_code: 'S1' }], total: 120, page: 6, limit: 20 });
    expect(query.mock.calls[0][1]).toEqual(['S1', 20, 100]);
  });
});

describe('controllers', () => {
  it('pass paging through only when page or limit is sent', async () => {
    const prices = { list: jest.fn(), pending: jest.fn() };
    const masters = { pending: jest.fn() };
    const ordering = { periods: jest.fn() };
    const pc = new ProductPricesController(prices as unknown as ProductPricesService);
    const mc = new ProductMastersController(masters as unknown as ProductMastersService);
    const oc = new OrderingController(ordering as unknown as OrderingService);

    pc.list(await asQuery({ search: 'A' }), 'A');
    pc.pending(await asQuery({ page: '2' }), undefined);
    mc.pending(await asQuery({ limit: '100' }), 'M');
    oc.periods(await asQuery({}), 'S');

    expect(prices.list).toHaveBeenCalledWith('A', undefined);
    expect(prices.pending).toHaveBeenCalledWith(undefined, { page: 2, limit: 20 });
    expect(masters.pending).toHaveBeenCalledWith('M', { page: 1, limit: 100 });
    expect(ordering.periods).toHaveBeenCalledWith('S', undefined);
  });

  it.each([
    ['product-prices', ProductPricesController],
    ['product-masters', ProductMastersController],
  ] as const)('%s bulk approve still accepts up to 500 SKUs (page-scoped selection is a UI concern)', async (_, ctrl) => {
    const [SkusDto] = Reflect.getMetadata('design:paramtypes', ctrl.prototype, 'approve');
    const meta = { type: 'body', metatype: SkusDto } as ArgumentMetadata;
    const skus = (n: number) => ({ skus: Array.from({ length: n }, (_, i) => `SKU-${i}`) });
    await expect(pipe.transform(skus(500), meta)).resolves.toEqual(skus(500));
    await expect(pipe.transform(skus(501), meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
