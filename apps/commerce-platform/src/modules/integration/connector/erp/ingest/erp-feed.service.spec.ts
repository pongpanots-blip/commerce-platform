import { ServiceUnavailableException } from '@nestjs/common';
import { ErpFeedService } from './erp-feed.service';
import { ErpIngestRecord } from '../erp-ingest-record.entity';
import { Product } from '../../../../commerce/product/infrastructure/product.entity';
import { Warehouse } from '../../../../commerce/warehouse/infrastructure/warehouse.entity';
import { parseJagotaMoq, parseJagotaPrice, parseJagotaQty } from './erp-payload.parsers';

const PARSE = { product_qty: parseJagotaQty, product_price: parseJagotaPrice, product_moq: parseJagotaMoq } as Record<string, (r: unknown) => unknown>;

function setup(opts: { ledgerStatus?: 'applied' | 'stale' | 'ignored'; integration?: unknown } = {}) {
  const saved: ErpIngestRecord[] = [];
  const recordRepo = { save: jest.fn(async (r) => { saved.push({ ...r }); return r; }) };
  const productRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: 'p-1', ...x })),
  };
  const warehouseRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'w-1', code: 'MAIN', stockSource: 'erp' }),
    create: jest.fn((x) => x), save: jest.fn(async (x) => x),
  };
  const repoFor = (e: unknown) => (e === Product ? productRepo : e === Warehouse ? warehouseRepo : recordRepo);
  const manager = { getRepository: jest.fn(repoFor) };
  const dataSource = {
    getRepository: jest.fn(repoFor),
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
  };
  const ingest = {
    stage: jest.fn(async (integrationId: string, entityType: string, raw: unknown) => {
      try {
        const parsed = PARSE[entityType](raw) as { sku: string };
        return { id: 'rec-1', integrationId, entityType, rawPayload: raw, parsedPayload: parsed, externalId: parsed.sku, status: 'received' };
      } catch (e) {
        return { id: 'rec-x', status: 'failed', error: String(e) };
      }
    }),
  };
  const integrations = { resolve: jest.fn().mockResolvedValue('integration' in opts ? opts.integration : { id: 'int-1' }) };
  const mapping = { toPlatformId: jest.fn().mockResolvedValue(null), link: jest.fn() };
  const ledger = { recordExternalQuantity: jest.fn().mockResolvedValue({ status: opts.ledgerStatus ?? 'applied', previousQuantity: 50 }) };
  const eventBus = { publish: jest.fn() };
  const svc = new ErpFeedService(dataSource as never, ingest as never, integrations as never, mapping as never, ledger as never, eventBus as never);
  return { svc, ingest, ledger, eventBus, mapping, productRepo, saved, manager };
}

describe('ErpFeedService', () => {
  it('qty: stages, records the movement, publishes inventory.qty.changed atomically', async () => {
    const t = setup();
    const item = { PRODUCT_CODE: '1001876', QUANTITY: 48, CHANGED_AT: '2026-10-03T07:01:29Z', REASON: 'SALE' };
    await t.svc.receive('qty', [item]);

    expect(t.ingest.stage).toHaveBeenCalledWith('int-1', 'product_qty', item);
    expect(t.ledger.recordExternalQuantity).toHaveBeenCalledWith(t.manager, expect.objectContaining({
      productId: 'p-1', quantity: 48, reason: 'SALE', source: 'erp', occurredAt: new Date('2026-10-03T07:01:29Z'),
    }));
    const [event, manager] = t.eventBus.publish.mock.calls[0];
    expect(manager).toBe(t.manager);
    expect(event.type).toBe('inventory.qty.changed');
    expect(event.aggregateId).toBe('p-1');
    expect(event.metadata).toEqual({ snapshot: true });
    expect(event.payload).toMatchObject({ sku: '1001876', quantity: 48, previousQuantity: 50, warehouseCode: 'MAIN', erp: item });
    expect(t.saved.at(-1)?.status).toBe('applied');
  });

  it('qty: stale / ignored movements are recorded but NOT sent to platforms', async () => {
    for (const status of ['stale', 'ignored'] as const) {
      const t = setup({ ledgerStatus: status });
      await t.svc.receive('qty', [{ PRODUCT_CODE: '1', QUANTITY: 1 }]);
      expect(t.eventBus.publish).not.toHaveBeenCalled();
      expect(t.saved.at(-1)?.status).toBe(status);
    }
  });

  it('price and moq publish their events without touching stock', async () => {
    const t = setup();
    await t.svc.receive('price', [{ PRODUCT_CODE: '1003120', PRICE: { ORDERING_PRICE: 590, SELLING_UNIT_PRICE: 59 } }]);
    await t.svc.receive('moq', [{ PRODUCT_CODE: '1003120', MOQ: 6 }]);
    expect(t.ledger.recordExternalQuantity).not.toHaveBeenCalled();
    const [price, moq] = t.eventBus.publish.mock.calls.map((c) => c[0]);
    expect(price.type).toBe('product.price.changed');
    expect(price.payload).toMatchObject({ orderingPrice: '590.00', sellingUnitPrice: '59.00' });
    expect(moq.type).toBe('product.moq.changed');
    expect(moq.payload).toMatchObject({ moq: 6 });
  });

  it('unknown SKU gets a placeholder product and an ERP mapping', async () => {
    const t = setup();
    await t.svc.receive('moq', [{ PRODUCT_CODE: 'NEW-1', MOQ: 1 }]);
    expect(t.productRepo.save).toHaveBeenCalledWith({ sku: 'NEW-1', name: 'NEW-1' });
    expect(t.mapping.link).toHaveBeenCalledWith('int-1', 'product', 'p-1', 'NEW-1');
  });

  it('one bad item does not stop the rest', async () => {
    const t = setup();
    await t.svc.receive('qty', [{ QUANTITY: 1 }, { PRODUCT_CODE: '2', QUANTITY: 3 }]);
    expect(t.eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('a processing error marks the row failed (raw payload kept) instead of throwing', async () => {
    const t = setup();
    t.ledger.recordExternalQuantity.mockRejectedValueOnce(new Error('db down'));
    await expect(t.svc.receive('qty', [{ PRODUCT_CODE: '1', QUANTITY: 1 }])).resolves.toBeUndefined();
    expect(t.saved.at(-1)).toMatchObject({ status: 'failed', error: 'db down' });
  });

  it('503 when the ERP integration row is missing, so the ERP retries', async () => {
    const t = setup({ integration: null });
    await expect(t.svc.receive('qty', [])).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
