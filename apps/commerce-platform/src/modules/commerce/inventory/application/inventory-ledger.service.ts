import { Injectable } from '@nestjs/common';
import { EntityManager, MoreThan } from 'typeorm';
import { InventoryLevel } from '../infrastructure/inventory-level.entity';
import { InventoryMovement, MovementStatus, StockSource } from '../infrastructure/inventory-movement.entity';
import { Warehouse } from '../../warehouse/infrastructure/warehouse.entity';

export interface ExternalQuantityInput {
  productId: string;
  warehouse: Warehouse;
  source: StockSource;
  quantity: number;
  reason: string | null;
  occurredAt: Date;
  ref: string | null;
}

export interface ExternalQuantityResult {
  status: MovementStatus;
  previousQuantity: number;
}

/**
 * Owns the stock ledger invariants: every change is a movement, the snapshot
 * only moves forward in source time, and a warehouse only accepts quantities
 * from the source that owns it. Runs inside the caller's transaction so the
 * caller can publish its event atomically with the write.
 */
@Injectable()
export class InventoryLedgerService {
  async recordExternalQuantity(manager: EntityManager, input: ExternalQuantityInput): Promise<ExternalQuantityResult> {
    const levels = manager.getRepository(InventoryLevel);
    const movements = manager.getRepository(InventoryMovement);
    const where = { productId: input.productId, warehouseId: input.warehouse.id };

    const level = await levels.findOne({ where });
    const previousQuantity = level ? Number(level.quantity) : 0;

    let status: MovementStatus = 'applied';
    if (input.warehouse.stockSource !== input.source) {
      status = 'ignored';
    } else {
      const newer = await movements.count({
        where: { ...where, status: 'applied', occurredAt: MoreThan(input.occurredAt) },
      });
      if (newer > 0) status = 'stale';
    }

    const quantity = Math.max(0, Math.floor(input.quantity));
    await movements.save(movements.create({
      ...where,
      source: input.source,
      reason: input.reason,
      quantityAfter: String(quantity),
      status,
      ref: input.ref,
      occurredAt: input.occurredAt,
    }));

    if (status === 'applied') {
      await levels.save(level
        ? Object.assign(level, { quantity: String(quantity) })
        : levels.create({ ...where, quantity: String(quantity) }));
    }
    return { status, previousQuantity };
  }
}
