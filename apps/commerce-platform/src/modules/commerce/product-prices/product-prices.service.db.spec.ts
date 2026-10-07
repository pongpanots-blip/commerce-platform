import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../shared-kernel/interfaces/event-bus.interface';
import { skuAggregateId } from './product-price-snapshot.event';
import { ProductPricesService } from './product-prices.service';

/*
 * Stage 4a: prices and the MER queue in commerce. Opt-in, migrated scratch DB:
 *   PRICES_TEST_DATABASE_URL=postgres:///commerce_4a_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand product-prices.service.db
 */
const url = process.env.PRICES_TEST_DATABASE_URL;
const SKU = 'T4A-SKU';

(url ? describe : describe.skip)('ProductPricesService against a database', () => {
  let db: DataSource;
  let svc: ProductPricesService;
  const clean = async () => {
    await db.query(`DELETE FROM outbox_messages WHERE aggregate_id = $1`, [skuAggregateId(SKU)]);
    await db.query(`DELETE FROM product_price_pending WHERE product_inventory_sku = $1`, [SKU]);
    await db.query(`DELETE FROM product_prices WHERE product_inventory_sku = $1`, [SKU]);
  };
  const snaps = async () => (await db.query(`SELECT payload FROM outbox_messages WHERE type = 'product.price.snapshot' AND aggregate_id = $1 ORDER BY created_at`, [skuAggregateId(SKU)])).map((r: { payload: unknown }) => r.payload);

  beforeAll(async () => {
    process.env.COMMERCE_OWNS_PRICES = 'true';
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [OutboxMessage] }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [ProductPricesService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(ProductPricesService);
    await clean();
    await db.query(`INSERT INTO product_prices (product_inventory_sku, selling_unit_price, ordering_price, moq) VALUES ($1, 10, 100, 1)`, [SKU]);
  });
  afterAll(async () => { await clean(); await db?.destroy(); delete process.env.COMMERCE_OWNS_PRICES; });

  it('ERP changes merge into one pending row; approve applies only the changed fields and tells josh', async () => {
    await db.transaction((m) => svc.stage(m, SKU, { sellingUnitPrice: 12.5 }, new Date('2026-10-08T01:00:00Z')));
    await db.transaction((m) => svc.stage(m, SKU, { moq: 6 }, new Date('2026-10-08T01:05:00Z')));
    const [pending] = await svc.pending(SKU);
    expect(pending).toMatchObject({ sku: SKU, selling_unit_price: '12.50', ordering_price: null, moq: 6, current_selling_unit_price: '10.00' });
    expect(await svc.approve([SKU], 'mer-1')).toEqual({ approved: 1 });
    expect(await db.query(`SELECT selling_unit_price, ordering_price, moq, source FROM product_prices WHERE product_inventory_sku = $1`, [SKU]))
      .toEqual([{ selling_unit_price: '12.50', ordering_price: '100.00', moq: 6, source: 'erp' }]);
    expect(await svc.pending(SKU)).toEqual([]);
    expect((await snaps()).at(-1)).toMatchObject({ sku: SKU, sellingUnitPrice: 12.5, orderingPrice: 100, moq: 6 });
  });

  it('reject drops the queue row; staff edit writes and publishes; an unknown SKU is a 404', async () => {
    await db.transaction((m) => svc.stage(m, SKU, { orderingPrice: 999 }, new Date()));
    expect(await svc.reject([SKU])).toEqual({ rejected: 1 });
    expect((await db.query(`SELECT ordering_price FROM product_prices WHERE product_inventory_sku = $1`, [SKU]))[0].ordering_price).toBe('100.00');
    await svc.edit(SKU, { sellingUnitPrice: 11 }, 'staff-1');
    expect((await snaps()).at(-1)).toMatchObject({ sellingUnitPrice: 11, orderingPrice: 100, moq: 6 });
    await expect(svc.edit('NOPE-SKU', { sellingUnitPrice: 1 }, 's')).rejects.toThrow('ไม่พบสินค้า');
  });

  it('writes are refused until commerce owns prices', async () => {
    process.env.COMMERCE_OWNS_PRICES = 'false';
    try {
      await expect(svc.edit(SKU, { sellingUnitPrice: 1 }, 's')).rejects.toThrow('COMMERCE_OWNS_PRICES');
    } finally { process.env.COMMERCE_OWNS_PRICES = 'true'; }
  });
});
