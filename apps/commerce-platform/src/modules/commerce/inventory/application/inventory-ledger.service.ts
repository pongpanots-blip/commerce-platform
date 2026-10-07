import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { EntityManager, MoreThan } from 'typeorm';
import { InventoryLevel } from '../infrastructure/inventory-level.entity';
import { InventoryMovement, MovementStatus, StockSource } from '../infrastructure/inventory-movement.entity';
import { Warehouse } from '../../warehouse/infrastructure/warehouse.entity';
import { EVENT_BUS, IEventBus } from '../../../../shared-kernel/interfaces/event-bus.interface';
import { InventoryQtyChanged } from '../domain/events/inventory-qty-changed.event';
import { InventorySellableSnapshot } from '../domain/events/inventory-sellable-snapshot.event';

/** Our adjustment reasons in the ERP's vocabulary (SALE / RECEIVE / ADJUST) for the `erp` block of the event. */
const ERP_REASON: Record<string, string> = { RECEIVE: 'RECEIVE', RETURN: 'RECEIVE' };

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
  sku: string;
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
  movementId: string;
}

/**
 * Owns the stock ledger invariants: every change is a movement, the snapshot
 * only moves forward in source time, and a warehouse only accepts quantities
 * from the source that owns it. Runs inside the caller's transaction so the
 * caller can publish its event atomically with the write.
 */
@Injectable()
export class InventoryLedgerService {
  constructor(@Inject(EVENT_BUS) private readonly eventBus: IEventBus) {}

  async recordExternalQuantity(manager: EntityManager, input: ExternalQuantityInput): Promise<ExternalQuantityResult> {
    const levels = manager.getRepository(InventoryLevel);
    const movements = manager.getRepository(InventoryMovement);
    const where = { productId: input.productId, warehouseId: input.warehouse.id };

    const level = await this.lockedLevel(manager, input.productId, input.warehouse.id);
    const previousQuantity = Number(level.quantity);

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
    const movement = await movements.save(movements.create({
      ...where,
      source: input.source,
      reason: input.reason,
      quantityAfter: String(quantity),
      status,
      ref: input.ref,
      occurredAt: input.occurredAt,
    }));

    if (status === 'applied') {
      await levels.save(Object.assign(level, { quantity: String(quantity) }));
      if (input.warehouse.sellable !== false) await this.publishSellable(manager, input.productId);
    }
    return { status, previousQuantity, movementId: movement.id };
  }

  /**
   * The level row for product × warehouse, created if missing and locked FOR UPDATE: two writers for the same pair
   * (ERP feed, adjustments, order deductions) queue here instead of reading the same old number. One row per pair is
   * guaranteed by UQ_inventory_levels_product_warehouse.
   */
  private async lockedLevel(manager: EntityManager, productId: string, warehouseId: string): Promise<InventoryLevel> {
    await manager.query(
      `INSERT INTO inventory_levels (product_id, warehouse_id) VALUES ($1, $2)
       ON CONFLICT (product_id, warehouse_id) WHERE deleted_at IS NULL DO NOTHING`, [productId, warehouseId]);
    return manager.getRepository(InventoryLevel).findOneOrFail({ where: { productId, warehouseId }, lock: { mode: 'pessimistic_write' } });
  }

  /**
   * inventory.sellable.snapshot for the product, same transaction (outbox): the sum over sellable warehouses.
   * version = now, i.e. when commerce's number changed — monotonic per SKU, so a platform never drops a newer sum as
   * "same version" (ERP CHANGED_AT of different warehouses can arrive out of order).
   */
  private async publishSellable(manager: EntityManager, productId: string) {
    const [row]: Array<{ sku: string; qty: number }> = await manager.query(
      `SELECT p.sku, COALESCE(SUM(GREATEST(l.quantity - l.reserved, 0)) FILTER (WHERE w.sellable), 0)::int AS qty
         FROM products p
         LEFT JOIN inventory_levels l ON l.product_id = p.id AND l.deleted_at IS NULL
         LEFT JOIN warehouses w ON w.id = l.warehouse_id AND w.deleted_at IS NULL
        WHERE p.id = $1 GROUP BY p.id, p.sku`, [productId]);
    if (!row?.sku) return;
    const version = new Date().toISOString();
    await this.eventBus.publish(new InventorySellableSnapshot(productId, {
      sku: row.sku, sellableQty: Number(row.qty), version,
      erp: { PRODUCT_CODE: row.sku, QUANTITY: Number(row.qty), CHANGED_AT: version },
    }), manager);
  }

  /**
   * Manual adjustment for a warehouse commerce itself owns (stock_source =
   * 'commerce'). An ERP-owned warehouse refuses — its stock is changed in the
   * ERP and arrives through the feed, otherwise the two would fight.
   * An applied change is published (same transaction, via the outbox) as the
   * same inventory.qty.changed every platform already receives from the ERP feed.
   */
  async adjustOwnStock(manager: EntityManager, input: OwnStockAdjustment) {
    if (input.warehouse.stockSource !== 'commerce') {
      throw new BadRequestException(`คลัง ${input.warehouse.code} ใช้สต็อกจาก ERP — ปรับใน ERP แล้วยอดจะเข้ามาเอง`);
    }
    // Locked (and created if missing) before reading: concurrent adjustments queue instead of losing one.
    const level = await this.lockedLevel(manager, input.productId, input.warehouse.id);
    const previous = Number(level.quantity);
    const reserved = Number(level.reserved);
    const next = input.mode === 'set' ? input.quantity : previous + input.quantity;
    if (!Number.isInteger(next) || next < 0) throw new BadRequestException(`ยอดหลังปรับต้องเป็นจำนวนเต็มไม่ติดลบ (ได้ ${next})`);
    if (next < reserved) throw new BadRequestException(`ยอดหลังปรับ (${next}) น้อยกว่าที่ถูกจองไว้ (${reserved}) — ปล่อยการจองก่อน`);
    const result = await this.recordExternalQuantity(manager, {
      productId: input.productId, warehouse: input.warehouse, source: 'commerce', quantity: next,
      reason: `ADJUST:${input.reason}`.slice(0, 32), occurredAt: new Date(), ref: input.ref,
    });
    if (result.status === 'applied') {
      const changedAt = new Date().toISOString();
      await this.eventBus.publish(new InventoryQtyChanged(input.productId, {
        sku: input.sku, source: 'commerce', warehouseCode: input.warehouse.code, quantity: next, previousQuantity: previous,
        reason: input.reason, changedAt, movementId: result.movementId,
        erp: { PRODUCT_CODE: input.sku, QUANTITY: next, CHANGED_AT: changedAt, REASON: ERP_REASON[input.reason] ?? 'ADJUST' },
      }), manager);
    }
    return { status: result.status, previousQuantity: previous, quantity: next, reserved };
  }
}
