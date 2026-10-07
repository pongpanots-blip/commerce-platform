import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../shared-kernel/interfaces/event-bus.interface';
import { skuAggregateId } from '../product-prices/product-price-snapshot.event';
import { ProductMastersService } from './product-masters.service';

/*
 * Stage 4d: the ERP product master and its MER queue in commerce. Opt-in, migrated scratch DB with categories imported:
 *   MASTERS_TEST_DATABASE_URL=postgres:///commerce_4d_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand product-masters.service.db
 */
const url = process.env.MASTERS_TEST_DATABASE_URL;
const SKU = 'T4D-SKU';
const NEW = 'T4D-NEW';

(url ? describe : describe.skip)('ProductMastersService against a database', () => {
  let db: DataSource;
  let svc: ProductMastersService;
  const clean = async () => {
    for (const s of [SKU, NEW]) {
      await db.query(`DELETE FROM outbox_messages WHERE aggregate_id = $1`, [skuAggregateId(s, 'master')]);
      await db.query(`DELETE FROM product_master_pending WHERE product_inventory_sku = $1`, [s]);
      await db.query(`DELETE FROM product_masters WHERE product_inventory_sku = $1`, [s]);
    }
  };
  const lastSnap = async () => (await db.query(`SELECT payload FROM outbox_messages WHERE type = 'product.master.snapshot' AND aggregate_id = $1 ORDER BY created_at DESC LIMIT 1`, [skuAggregateId(SKU, 'master')]))[0]?.payload;

  beforeAll(async () => {
    process.env.COMMERCE_OWNS_PRODUCT_MASTER = 'true';
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [OutboxMessage] }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [ProductMastersService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(ProductMastersService);
    await clean();
    await db.query(`INSERT INTO product_masters (product_inventory_sku, fields) VALUES ($1, '{"selling_unit":"PC","brand_name":"Old","product_status":"active"}')`, [SKU]);
  });
  afterAll(async () => { await clean(); await db?.destroy(); delete process.env.COMMERCE_OWNS_PRODUCT_MASTER; });

  it('ERP upserts merge into one pending row for live SKUs only; approve writes only those fields and tells josh', async () => {
    const staged = await db.transaction((m) => svc.stageFromErp(m, [
      { PRODUCT_CODE: SKU, SELLING_UNIT: 'KG', PRICE: 99 }, { PRODUCT_CODE: NEW, SELLING_UNIT: 'KG' }, { PRODUCT_CODE: SKU, BRAND_NAME: 'New' },
    ], new Date('2026-10-08T01:00:00Z')));
    expect(staged).toBe(2);
    const [pending] = await svc.pending(SKU);
    expect(pending).toMatchObject({ sku: SKU, patch: { selling_unit: 'KG', brand_name: 'New' }, current: { selling_unit: 'PC' } });
    expect(await svc.pending(NEW)).toEqual([]);
    expect(await svc.approve([SKU], 'mer-1')).toEqual({ approved: 1 });
    expect((await svc.get(SKU)).fields).toEqual({ selling_unit: 'KG', brand_name: 'New', product_status: 'active' });
    expect(await lastSnap()).toMatchObject({ sku: SKU, fields: { selling_unit: 'KG', brand_name: 'New', product_status: 'active' } });
  });

  it('a new pack size drops the pack columns josh derives from it, unless they came with it', async () => {
    await db.query(`UPDATE product_masters SET fields = fields || '{"pack_size":"13 KG X 1 BG","packaging_type":"Fixed","units_per_box":"1 BG","weight_per_unit":"13 KG"}' WHERE product_inventory_sku = $1`, [SKU]);
    await svc.edit(SKU, { pack_size: '25 KG X 1 BG' }, 'staff-1');
    const f = (await lastSnap()).fields;
    expect(f.pack_size).toBe('25 KG X 1 BG');
    expect(f).not.toHaveProperty('weight_per_unit');
    expect(f).not.toHaveProperty('packaging_type');
    await svc.edit(SKU, { pack_size: '20 KG X 1 BG', weight_per_unit: '20 KG' }, 'staff-1');
    expect((await lastSnap()).fields).toMatchObject({ pack_size: '20 KG X 1 BG', weight_per_unit: '20 KG' });
  });

  it('reject drops the queue row; staff edit maps the category id to its code; bad values and the switch are refused', async () => {
    await db.transaction((m) => svc.stageFromErp(m, { PRODUCT_CODE: SKU, VAT: '1' }, new Date()));
    expect(await svc.reject([SKU])).toEqual({ rejected: 1 });
    const [cat] = await db.query(`SELECT id, category_code FROM product_categories ORDER BY level DESC LIMIT 1`);
    await svc.edit(SKU, { product_status: 'inactive', category_id: cat.id }, 'staff-1');
    expect((await lastSnap()).fields).toMatchObject({ product_status: 'inactive', category_code: cat.category_code, selling_unit: 'KG' });
    await expect(svc.edit(SKU, { category_id: '00000000-0000-4000-8000-000000000000' }, 's')).rejects.toThrow('ไม่พบหมวดหมู่');
    await expect(svc.edit(SKU, { ingredients: 'x' }, 's')).rejects.toThrow('ไม่ใช่ข้อมูลสินค้า');
    process.env.COMMERCE_OWNS_PRODUCT_MASTER = 'false';
    try {
      await expect(svc.edit(SKU, { brand_name: 'x' }, 's')).rejects.toThrow('COMMERCE_OWNS_PRODUCT_MASTER');
      expect(await db.transaction((m) => svc.stageFromErp(m, { PRODUCT_CODE: SKU, VAT: '1' }, new Date()))).toBe(0);
    } finally { process.env.COMMERCE_OWNS_PRODUCT_MASTER = 'true'; }
  });
});
