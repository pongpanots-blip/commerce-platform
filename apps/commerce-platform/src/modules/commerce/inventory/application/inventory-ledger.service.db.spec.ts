import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../../shared-kernel/interfaces/event-bus.interface';
import { Warehouse } from '../../warehouse/infrastructure/warehouse.entity';
import { InventoryLevel } from '../infrastructure/inventory-level.entity';
import { InventoryMovement } from '../infrastructure/inventory-movement.entity';
import { InventoryLedgerService } from './inventory-ledger.service';
import { StockMovesService } from './stock-moves.service';
import { OrderStockService } from './order-stock.service';

/*
 * Stage 3: ledger writes under a row lock on an upserted level row. Opt-in, migrated scratch DB:
 *   INVENTORY_TEST_DATABASE_URL=postgres:///commerce_3_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand inventory-ledger.service.db
 */
const url = process.env.INVENTORY_TEST_DATABASE_URL;
const P = '00000000-0000-4000-8000-0000000003a1', W = '00000000-0000-4000-8000-0000000003b1', W2 = '00000000-0000-4000-8000-0000000003b2';

(url ? describe : describe.skip)('InventoryLedgerService against a database', () => {
  let db: DataSource;
  let ledger: InventoryLedgerService;
  let moves: StockMovesService;
  let orders: OrderStockService;
  const clean = async () => {
    await db.query(`DELETE FROM outbox_messages WHERE aggregate_id = $1`, [P]);
    await db.query(`DELETE FROM josh_order_stock_moves WHERE product_id = $1`, [P]);
    await db.query(`DELETE FROM inventory_movements WHERE product_id = $1`, [P]);
    await db.query(`DELETE FROM inventory_levels WHERE product_id = $1`, [P]);
    await db.query(`DELETE FROM warehouses WHERE id = ANY($1::uuid[])`, [[W, W2]]);
    await db.query(`DELETE FROM products WHERE id = $1`, [P]);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [InventoryLevel, InventoryMovement, Warehouse, OutboxMessage] }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [InventoryLedgerService, StockMovesService, OrderStockService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    ledger = mod.get(InventoryLedgerService);
    moves = mod.get(StockMovesService);
    orders = mod.get(OrderStockService);
    await clean();
    await db.query(`INSERT INTO products (id, sku, name) VALUES ($1, 'T3-SKU', 'stage 3 test')`, [P]);
    await db.query(`INSERT INTO warehouses (id, code, name, stock_source, sellable) VALUES ($1, 'T3-OWN', 'own', 'commerce', true), ($2, 'T3-DMG', 'damaged', 'commerce', false)`, [W, W2]);
  });
  afterAll(async () => { await clean(); await db?.destroy(); });

  const warehouse = (id: string) => db.getRepository(Warehouse).findOneByOrFail({ id });
  const add = async (id: string, quantity: number) => {
    const w = await warehouse(id);
    return db.transaction((m) => ledger.adjustOwnStock(m, { productId: P, sku: 'T3-SKU', warehouse: w, mode: 'add', quantity, reason: 'RECEIVE', ref: 'test' }));
  };

  it('two concurrent first-ever receipts both count, on one level row', async () => {
    await Promise.all([add(W, 1), add(W, 1)]);
    expect(await db.query(`SELECT quantity::int AS q FROM inventory_levels WHERE product_id = $1 AND warehouse_id = $2`, [P, W])).toEqual([{ q: 2 }]);
    await Promise.all(Array.from({ length: 5 }, () => add(W, 3)));
    expect(await db.query(`SELECT quantity::int AS q FROM inventory_levels WHERE product_id = $1 AND warehouse_id = $2`, [P, W])).toEqual([{ q: 17 }]);
  });

  it('the sellable snapshot sums sellable warehouses only, the newest one last', async () => {
    await add(W2, 100); // not sellable: no snapshot, not in the sum
    const snaps = await db.query(`SELECT payload FROM outbox_messages WHERE type = 'inventory.sellable.snapshot' AND aggregate_id = $1 ORDER BY created_at`, [P]);
    expect(snaps.length).toBe(7);
    expect(snaps[snaps.length - 1].payload).toMatchObject({ sku: 'T3-SKU', sellableQty: 17, erp: { PRODUCT_CODE: 'T3-SKU', QUANTITY: 17 } });
  });

  it('a transfer moves stock between two own warehouses atomically; too much refuses and changes nothing', async () => {
    const level = async (w: string) => (await db.query(`SELECT quantity::int AS q FROM inventory_levels WHERE product_id = $1 AND warehouse_id = $2`, [P, w]))[0]?.q;
    await moves.transfer({ sku: 'T3-SKU', fromWarehouseCode: 'T3-OWN', toWarehouseCode: 'T3-DMG', quantity: 5 }, 'staff-1');
    expect([await level(W), await level(W2)]).toEqual([12, 105]);
    await expect(moves.transfer({ sku: 'T3-SKU', fromWarehouseCode: 'T3-OWN', toWarehouseCode: 'T3-DMG', quantity: 50 }, 'staff-1')).rejects.toThrow('ไม่ติดลบ');
    expect([await level(W), await level(W2)]).toEqual([12, 105]);
    const refs = await db.query(`SELECT DISTINCT ref FROM inventory_movements WHERE product_id = $1 AND reason LIKE 'ADJUST:TRANSFER%'`, [P]);
    expect(refs).toHaveLength(1);
  });

  it('count sets the number; unknown SKU / warehouse are 404', async () => {
    await moves.adjust({ sku: 'T3-SKU', warehouseCode: 'T3-OWN', mode: 'set', quantity: 9, reason: 'COUNT' }, 'staff-1');
    expect((await db.query(`SELECT quantity::int AS q FROM inventory_levels WHERE product_id = $1 AND warehouse_id = $2`, [P, W]))[0].q).toBe(9);
    await expect(moves.adjust({ sku: 'NOPE', warehouseCode: 'T3-OWN', mode: 'add', quantity: 1, reason: 'RECEIVE' }, 's')).rejects.toThrow('ไม่พบสินค้า');
    await expect(moves.adjust({ sku: 'T3-SKU', warehouseCode: 'NOPE', mode: 'add', quantity: 1, reason: 'RECEIVE' }, 's')).rejects.toThrow('ไม่พบคลัง');
  });

  it('orders: paid deducts once, replays do nothing, cancelled gives back once; unknown SKU skipped', async () => {
    process.env.STOCK_ORDER_WAREHOUSE_CODE = 'T3-OWN';
    try {
      const O = '00000000-0000-4000-8000-0000000003c1', L1 = '00000000-0000-4000-8000-0000000003d1', L2 = '00000000-0000-4000-8000-0000000003d2';
      const level = async () => (await db.query(`SELECT quantity::int AS q FROM inventory_levels WHERE product_id = $1 AND warehouse_id = $2`, [P, W]))[0].q;
      const run = (status: string) => db.transaction((m) => orders.apply(m, { orders_id: O, status }, [
        { id: L1, sku: 'T3-SKU', product_quantity: 4 }, { id: L2, sku: 'NOT-IN-COMMERCE', product_quantity: 2 }]));
      const start = await level();
      await run('payment_pending');
      expect(await level()).toBe(start);
      await run('paid');
      await run('preparing');
      await run('paid');
      expect(await level()).toBe(start - 4);
      await run('cancelled');
      await run('cancelled');
      expect(await level()).toBe(start);
      expect(await db.query(`SELECT state, quantity::int AS q FROM josh_order_stock_moves WHERE orders_id = $1`, [O])).toEqual([{ state: 'returned', q: 4 }]);
    } finally {
      delete process.env.STOCK_ORDER_WAREHOUSE_CODE;
    }
  });

  it('orders: a deduction bigger than the shelf clamps at 0 and gives back only what it took', async () => {
    process.env.STOCK_ORDER_WAREHOUSE_CODE = 'T3-OWN';
    try {
      const O = '00000000-0000-4000-8000-0000000003c2', L = '00000000-0000-4000-8000-0000000003d3';
      await moves.adjust({ sku: 'T3-SKU', warehouseCode: 'T3-OWN', mode: 'set', quantity: 3, reason: 'COUNT' }, 's');
      const level = async () => (await db.query(`SELECT quantity::int AS q FROM inventory_levels WHERE product_id = $1 AND warehouse_id = $2`, [P, W]))[0].q;
      await db.transaction((m) => orders.apply(m, { orders_id: O, status: 'paid' }, [{ id: L, sku: 'T3-SKU', product_quantity: 10 }]));
      expect(await level()).toBe(0);
      await db.transaction((m) => orders.apply(m, { orders_id: O, status: 'cancelled' }, [{ id: L, sku: 'T3-SKU', product_quantity: 10 }]));
      expect(await level()).toBe(3);
    } finally {
      delete process.env.STOCK_ORDER_WAREHOUSE_CODE;
    }
  });
});
