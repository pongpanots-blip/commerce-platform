import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../shared-kernel/interfaces/event-bus.interface';
import { skuAggregateId } from '../product-prices/product-price-snapshot.event';
import { OrderingService } from './ordering.service';

/*
 * Stage 4f: supplier order rounds and SKU logistics in commerce. Opt-in, migrated scratch DB:
 *   ORDERING_TEST_DATABASE_URL=postgres:///commerce_4f_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand ordering.service.db
 */
const url = process.env.ORDERING_TEST_DATABASE_URL;
const SUP = 'T4F-SUP';
const SKU = 'T4F-SKU';

(url ? describe : describe.skip)('OrderingService against a database', () => {
  let db: DataSource;
  let svc: OrderingService;
  const clean = async () => {
    await db.query(`DELETE FROM outbox_messages WHERE aggregate_id = ANY($1)`, [[skuAggregateId(SUP, 'order-periods'), skuAggregateId(SKU, 'logistics')]]);
    await db.query(`DELETE FROM supplier_order_periods WHERE sup_code = $1`, [SUP]);
    await db.query(`DELETE FROM product_logistics WHERE product_inventory_sku = $1`, [SKU]);
  };
  const lastSnap = async (type: string, id: string) =>
    (await db.query(`SELECT payload FROM outbox_messages WHERE type = $1 AND aggregate_id = $2 ORDER BY created_at DESC LIMIT 1`, [type, id]))[0]?.payload;

  beforeAll(async () => {
    process.env.COMMERCE_OWNS_ORDERING = 'true';
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [OutboxMessage] }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [OrderingService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(OrderingService);
    await clean();
  });
  afterAll(async () => { await clean(); await db?.destroy(); delete process.env.COMMERCE_OWNS_ORDERING; });

  it('an ERP push upserts the rounds, closes the supplier rounds it no longer lists and sends josh all of them', async () => {
    const push = (rows: object[]) => db.transaction((m) => svc.fromErp(m, rows));
    expect(await push([
      { SUP_CODE: SUP, ORDER_PERIOD: '1', DATE_FROM: '2026-10-01', DATE_TO: '2026-10-07', EST_CLOSE_DATE: '2026-09-28 17:00:00', STATUS: 'O' },
      { SUP_CODE: SUP, ORDER_PERIOD: '2', DATE_FROM: '2026-10-08', DATE_TO: '2026-10-14', STATUS: 'O' },
    ])).toEqual({ upserted: 2, suppliers: 1 });
    expect(await push([{ SUP_CODE: SUP, ORDER_PERIOD: '2', DATE_FROM: '2026-10-08', DATE_TO: '2026-10-15', STATUS: 'O' }])).toEqual({ upserted: 1, suppliers: 1 });
    const snap = await lastSnap('supplier.order_periods.snapshot', skuAggregateId(SUP, 'order-periods'));
    expect(snap).toMatchObject({ supCode: SUP, periods: [
      { erp_order_period: '1', date_from: '2026-10-01', date_to: '2026-10-07', close_at: '2026-09-28T10:00:00.000Z', status: 'C' },
      { erp_order_period: '2', date_from: '2026-10-08', date_to: '2026-10-15', close_at: null, status: 'O' },
    ] });
    expect((await svc.periods(SUP)).map((r: { erp_order_period: string }) => r.erp_order_period)).toEqual(['2', '1']); // open first
    await svc.republish(SUP);
    await expect(svc.republish('T4F-NONE')).rejects.toThrow('ไม่มีรอบสั่งซื้อ');
  });

  it('logistics edits merge into the row and publish it whole; unknown SKU / other keys / switch off are refused', async () => {
    // A SKU commerce has no catalog copy of is refused until it has a row.
    await expect(svc.editLogistics(SKU, { unit_ratio: '12' }, 's')).rejects.toThrow('ไม่พบสินค้า');
    await db.query(`INSERT INTO product_logistics (product_inventory_sku, fields) VALUES ($1, '{"product_unit":"PC"}')`, [SKU]);
    await svc.editLogistics(SKU, { unit_ratio: '12', delivery_dates: 'MONDAY,THURSDAY' }, 'staff-1');
    expect(await lastSnap('product.logistics.snapshot', skuAggregateId(SKU, 'logistics'))).toMatchObject({
      sku: SKU, fields: { product_unit: 'PC', unit_ratio: '12', delivery_dates: [{ day: 'MONDAY' }, { day: 'THURSDAY' }] },
    });
    expect((await svc.getLogistics(SKU)).updated_by).toBe('staff-1');
    await expect(svc.editLogistics(SKU, { brand_name: 'x' }, 's')).rejects.toThrow('ไม่ใช่ข้อมูลโลจิสติกส์');
    process.env.COMMERCE_OWNS_ORDERING = 'false';
    try {
      await expect(svc.editLogistics(SKU, { unit_ratio: '1' }, 's')).rejects.toThrow('COMMERCE_OWNS_ORDERING');
      expect(await db.transaction((m) => svc.fromErp(m, [{ SUP_CODE: SUP, ORDER_PERIOD: '3', DATE_FROM: '2026-11-01', DATE_TO: '2026-11-02' }]))).toEqual({ upserted: 0, suppliers: 0 });
    } finally { process.env.COMMERCE_OWNS_ORDERING = 'true'; }
  });
});
