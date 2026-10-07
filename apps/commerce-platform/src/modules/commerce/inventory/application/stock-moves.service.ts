import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { Warehouse } from '../../warehouse/infrastructure/warehouse.entity';
import { InventoryLedgerService } from './inventory-ledger.service';

export const ADJUST_REASONS = ['RECEIVE', 'COUNT', 'DAMAGE', 'RETURN', 'CORRECTION'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/**
 * Staff stock moves for warehouses commerce owns (stage 3): receive, count, damage / return / correction, and transfer
 * between two own warehouses — all through the ledger (movement + level + inventory.sellable.snapshot, one transaction).
 * ERP-owned warehouses are refused by the ledger: their stock changes in the ERP and arrives through the feed.
 */
@Injectable()
export class StockMovesService {
  constructor(@InjectDataSource() private readonly db: DataSource, private readonly ledger: InventoryLedgerService) {}

  warehouses() {
    return this.db.getRepository(Warehouse).find({ order: { code: 'ASC' } })
      .then((ws) => ws.map((w) => ({ id: w.id, code: w.code, name: w.name, stockSource: w.stockSource, sellable: w.sellable })));
  }

  adjust(input: { sku: string; warehouseCode: string; mode: 'set' | 'add'; quantity: number; reason: AdjustReason; note?: string }, staffId: string) {
    return this.db.transaction(async (m) => {
      const product = await this.product(m, input.sku);
      const warehouse = await this.warehouse(m, input.warehouseCode);
      return this.ledger.adjustOwnStock(m, {
        productId: product.id, sku: product.sku, warehouse, mode: input.mode, quantity: input.quantity, reason: input.reason,
        ref: `staff:${staffId}${input.note ? ` ${input.note}` : ''}`.slice(0, 128),
      });
    });
  }

  /** −quantity from one own warehouse, +quantity into another, one transaction (both or neither), one shared ref. */
  transfer(input: { sku: string; fromWarehouseCode: string; toWarehouseCode: string; quantity: number; note?: string }, staffId: string) {
    if (input.fromWarehouseCode === input.toWarehouseCode) throw new BadRequestException('คลังต้นทางกับปลายทางต้องไม่ใช่คลังเดียวกัน');
    return this.db.transaction(async (m) => {
      const product = await this.product(m, input.sku);
      const from = await this.warehouse(m, input.fromWarehouseCode);
      const to = await this.warehouse(m, input.toWarehouseCode);
      const ref = `transfer:${randomUUID()} staff:${staffId}${input.note ? ` ${input.note}` : ''}`.slice(0, 128);
      const out = await this.ledger.adjustOwnStock(m, { productId: product.id, sku: product.sku, warehouse: from, mode: 'add', quantity: -input.quantity, reason: 'TRANSFER_OUT', ref });
      const into = await this.ledger.adjustOwnStock(m, { productId: product.id, sku: product.sku, warehouse: to, mode: 'add', quantity: input.quantity, reason: 'TRANSFER_IN', ref });
      return { from: { warehouse: from.code, ...out }, to: { warehouse: to.code, ...into } };
    });
  }

  private async product(m: EntityManager, sku: string): Promise<{ id: string; sku: string }> {
    const [product] = await m.query(`SELECT id, sku FROM products WHERE sku = $1 AND deleted_at IS NULL LIMIT 1`, [sku]);
    if (!product) throw new NotFoundException(`ไม่พบสินค้า SKU ${sku}`);
    return product;
  }

  private async warehouse(m: EntityManager, code: string): Promise<Warehouse> {
    const warehouse = await m.getRepository(Warehouse).findOneBy({ code });
    if (!warehouse) throw new NotFoundException(`ไม่พบคลัง ${code}`);
    return warehouse;
  }
}
