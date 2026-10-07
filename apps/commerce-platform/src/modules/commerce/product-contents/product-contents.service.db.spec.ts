import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../shared-kernel/interfaces/event-bus.interface';
import { skuAggregateId } from '../product-prices/product-price-snapshot.event';
import { ProductContentsService } from './product-contents.service';

/*
 * Stage 4b: product content in commerce. Opt-in, migrated scratch DB:
 *   CONTENTS_TEST_DATABASE_URL=postgres:///commerce_4b_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand product-contents.service.db
 */
const url = process.env.CONTENTS_TEST_DATABASE_URL;
const SKU = 'T4B-SKU';

(url ? describe : describe.skip)('ProductContentsService against a database', () => {
  let db: DataSource;
  let svc: ProductContentsService;
  const clean = async () => {
    await db.query(`DELETE FROM outbox_messages WHERE aggregate_id = $1`, [skuAggregateId(SKU, 'content')]);
    await db.query(`DELETE FROM product_contents WHERE product_inventory_sku = $1`, [SKU]);
  };
  const snaps = async () => (await db.query(`SELECT payload FROM outbox_messages WHERE type = 'product.content.snapshot' AND aggregate_id = $1 ORDER BY created_at`,
    [skuAggregateId(SKU, 'content')])).map((r: { payload: unknown }) => r.payload);

  beforeAll(async () => {
    process.env.COMMERCE_OWNS_PRODUCT_CONTENT = 'true';
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [OutboxMessage] }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [ProductContentsService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(ProductContentsService);
    await clean();
    await db.query(`INSERT INTO product_contents (product_inventory_sku, fields) VALUES ($1, '{"product_name_th":"เดิม","ingredients":"แป้ง"}')`, [SKU]);
  });
  afterAll(async () => { await clean(); await db?.destroy(); delete process.env.COMMERCE_OWNS_PRODUCT_CONTENT; });

  it('an edit merges into the row and publishes the whole row', async () => {
    await svc.edit(SKU, { product_name_th: 'ใหม่', buying_price: 7.5 }, 'staff-1');
    expect(await svc.get(SKU)).toMatchObject({ fields: { product_name_th: 'ใหม่', ingredients: 'แป้ง', buying_price: 7.5 }, source: 'staff', updated_by: 'staff-1' });
    expect((await snaps()).at(-1)).toMatchObject({ sku: SKU, fields: { product_name_th: 'ใหม่', ingredients: 'แป้ง', buying_price: 7.5 } });
  });

  it('refuses non-content keys, unknown SKUs, and everything until commerce owns content', async () => {
    await expect(svc.edit(SKU, { selling_unit: 'kg' }, 's')).rejects.toThrow('ไม่ใช่เนื้อหาสินค้า');
    await expect(svc.edit('NOPE-SKU', { ingredients: 'x' }, 's')).rejects.toThrow('ไม่พบสินค้า');
    process.env.COMMERCE_OWNS_PRODUCT_CONTENT = 'false';
    try {
      await expect(svc.edit(SKU, { ingredients: 'x' }, 's')).rejects.toThrow('COMMERCE_OWNS_PRODUCT_CONTENT');
    } finally { process.env.COMMERCE_OWNS_PRODUCT_CONTENT = 'true'; }
  });
});
