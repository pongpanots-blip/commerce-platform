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

/*
 * Stage 3: ledger writes under a row lock on an upserted level row. Opt-in, migrated scratch DB:
 *   INVENTORY_TEST_DATABASE_URL=postgres:///commerce_3_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand inventory-ledger.service.db
 */
const url = process.env.INVENTORY_TEST_DATABASE_URL;
const P = '00000000-0000-4000-8000-0000000003a1', W = '00000000-0000-4000-8000-0000000003b1', W2 = '00000000-0000-4000-8000-0000000003b2';

(url ? describe : describe.skip)('InventoryLedgerService against a database', () => {
  let db: DataSource;
  let ledger: InventoryLedgerService;
  const clean = async () => {
    await db.query(`DELETE FROM outbox_messages WHERE aggregate_id = $1`, [P]);
    await db.query(`DELETE FROM inventory_movements WHERE product_id = $1`, [P]);
    await db.query(`DELETE FROM inventory_levels WHERE product_id = $1`, [P]);
    await db.query(`DELETE FROM warehouses WHERE id = ANY($1::uuid[])`, [[W, W2]]);
    await db.query(`DELETE FROM products WHERE id = $1`, [P]);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [InventoryLevel, InventoryMovement, Warehouse, OutboxMessage] }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [InventoryLedgerService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    ledger = mod.get(InventoryLedgerService);
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
});
