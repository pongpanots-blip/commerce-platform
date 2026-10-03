import { EntityManager } from 'typeorm';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryLevel } from '../infrastructure/inventory-level.entity';
import { Warehouse } from '../../warehouse/infrastructure/warehouse.entity';

function makeManager(opts: { level?: Partial<InventoryLevel> | null; newerApplied?: number } = {}) {
  const levels = {
    findOne: jest.fn().mockResolvedValue(opts.level ?? null),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
  };
  const movements = {
    count: jest.fn().mockResolvedValue(opts.newerApplied ?? 0),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
  };
  const manager = {
    getRepository: jest.fn((e) => (e === InventoryLevel ? levels : movements)),
  } as unknown as EntityManager;
  return { manager, levels, movements };
}

const erpWarehouse = { id: 'w-1', stockSource: 'erp' } as Warehouse;
const base = {
  productId: 'p-1', warehouse: erpWarehouse, source: 'erp' as const, quantity: 48,
  reason: 'SALE', occurredAt: new Date('2026-10-03T07:01:29Z'), ref: 'rec-1',
};

describe('InventoryLedgerService', () => {
  const svc = new InventoryLedgerService();

  it('writes a movement and moves the snapshot', async () => {
    const { manager, levels, movements } = makeManager({ level: { quantity: '50' } });
    const res = await svc.recordExternalQuantity(manager, base);
    expect(res).toEqual({ status: 'applied', previousQuantity: 50 });
    expect(movements.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'applied', quantityAfter: '48', reason: 'SALE' }));
    expect(levels.save).toHaveBeenCalledWith(expect.objectContaining({ quantity: '48' }));
  });

  it('creates the snapshot on first sight and clamps negatives / fractions', async () => {
    const { manager, levels } = makeManager();
    await svc.recordExternalQuantity(manager, { ...base, quantity: -3.7 });
    expect(levels.create).toHaveBeenCalledWith({ productId: 'p-1', warehouseId: 'w-1', quantity: '0' });
  });

  it('keeps an out-of-order (older) change as stale without touching the snapshot', async () => {
    const { manager, levels, movements } = makeManager({ level: { quantity: '50' }, newerApplied: 1 });
    const res = await svc.recordExternalQuantity(manager, base);
    expect(res.status).toBe('stale');
    expect(movements.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'stale' }));
    expect(levels.save).not.toHaveBeenCalled();
  });

  it('ignores ERP quantities for a warehouse we own', async () => {
    const { manager, levels } = makeManager({ level: { quantity: '50' } });
    const res = await svc.recordExternalQuantity(manager, {
      ...base, warehouse: { id: 'w-1', stockSource: 'commerce' } as Warehouse,
    });
    expect(res.status).toBe('ignored');
    expect(levels.save).not.toHaveBeenCalled();
  });
});
