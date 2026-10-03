import { BadRequestException, Injectable } from '@nestjs/common';
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

export interface OwnStockAdjustment {
  productId: string;
  warehouse: Warehouse;
  /** set = counted quantity · add = signed change (receive +, damage −) */
  mode: 'set' | 'add';
  quantity: number;
  reason: string;
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

  /**
   * Manual adjustment for a warehouse commerce itself owns (stock_source =
   * 'commerce'). An ERP-owned warehouse refuses — its stock is changed in the
   * ERP and arrives through the feed, otherwise the two would fight.
   */
  async adjustOwnStock(manager: EntityManager, input: OwnStockAdjustment) {
    if (input.warehouse.stockSource !== 'commerce') {
      throw new BadRequestException(`คลัง ${input.warehouse.code} ใช้สต็อกจาก ERP — ปรับใน ERP แล้วยอดจะเข้ามาเอง`);
    }
    const where = { productId: input.productId, warehouseId: input.warehouse.id };
    // ponytail: row lock only when a level row exists; two concurrent first-ever adds can race. Add an upsert if that matters.
    const level = await manager.getRepository(InventoryLevel).findOne({ where, lock: { mode: 'pessimistic_write' } });
    const previous = level ? Number(level.quantity) : 0;
    const reserved = level ? Number(level.reserved) : 0;
    const next = input.mode === 'set' ? input.quantity : previous + input.quantity;
    if (!Number.isInteger(next) || next < 0) throw new BadRequestException(`ยอดหลังปรับต้องเป็นจำนวนเต็มไม่ติดลบ (ได้ ${next})`);
    if (next < reserved) throw new BadRequestException(`ยอดหลังปรับ (${next}) น้อยกว่าที่ถูกจองไว้ (${reserved}) — ปล่อยการจองก่อน`);
    const result = await this.recordExternalQuantity(manager, {
      productId: input.productId, warehouse: input.warehouse, source: 'commerce', quantity: next,
      reason: `ADJUST:${input.reason}`.slice(0, 32), occurredAt: new Date(), ref: input.ref,
    });
    return { status: result.status, previousQuantity: previous, quantity: next, reserved };
  }
}
