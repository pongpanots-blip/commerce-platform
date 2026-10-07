import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Warehouse } from '../../warehouse/infrastructure/warehouse.entity';
import { InventoryLedgerService } from './inventory-ledger.service';

/** josh order statuses that hold stock, and the ones that give it back (josh ACTIVE / cancelled sets). */
const HOLDS = new Set(['paid', 'preparing', 'shipped', 'delivered']);
const RELEASES = new Set(['cancelled', 'refunded']);

export interface OrderStockLine { id: string; sku: string | null; product_quantity: number | string }

/**
 * josh orders take stock from the warehouse commerce owns (spec §4.3): when an order.snapshot shows the order paid (or
 * further) its lines are deducted once; cancelled / refunded after that puts them back once. The state per line
 * (josh_order_stock_moves) makes replays and out-of-order snapshots harmless. Only for STOCK_ORDER_WAREHOUSE_CODE when
 * that warehouse's stock is commerce's — ERP warehouses already count orders in the ERP's own numbers.
 * A deduction is clamped at 0 (josh already sold it; refusing would lose the record).
 */
@Injectable()
export class OrderStockService {
  private readonly logger = new Logger(OrderStockService.name);

  constructor(private readonly ledger: InventoryLedgerService) {}

  async apply(m: EntityManager, order: { orders_id: string; status: string | null }, lines: OrderStockLine[]): Promise<void> {
    const code = process.env.STOCK_ORDER_WAREHOUSE_CODE?.trim();
    if (!code) return;
    const status = String(order.status ?? '');
    const target = HOLDS.has(status) ? 'deducted' : RELEASES.has(status) ? 'returned' : null;
    if (!target) return;
    const warehouse = await m.getRepository(Warehouse).findOneBy({ code });
    if (!warehouse || warehouse.stockSource !== 'commerce') {
      this.logger.warn(`STOCK_ORDER_WAREHOUSE_CODE=${code} is not a commerce-owned warehouse — orders do not move stock`);
      return;
    }
    const states = new Map<string, { state: string; quantity: string }>(
      (await m.query(`SELECT order_line_id, state, quantity FROM josh_order_stock_moves WHERE orders_id = $1 FOR UPDATE`, [order.orders_id]))
        .map((r: { order_line_id: string; state: string; quantity: string }) => [r.order_line_id, r]));

    for (const line of lines) {
      const current = states.get(line.id)?.state ?? 'none';
      if (current === target || (target === 'returned' && current !== 'deducted')) continue;
      const [product] = line.sku ? await m.query(`SELECT id, sku FROM products WHERE sku = $1 AND deleted_at IS NULL LIMIT 1`, [line.sku]) : [];
      if (!product) continue;
      const ordered = Math.floor(Number(line.product_quantity) || 0);
      const quantity = target === 'deducted' ? ordered : Number(states.get(line.id)!.quantity);
      if (quantity <= 0) continue;
      const result = await this.ledger.adjustOwnStock(m, {
        productId: product.id, sku: product.sku, warehouse, mode: 'add', quantity: target === 'deducted' ? -quantity : quantity,
        reason: target === 'deducted' ? 'ORDER' : 'ORDER_CANCEL', ref: `order:${order.orders_id}`, clampAtZero: true,
      });
      // What really left the shelf (clamped at 0) is what a cancellation gives back.
      const moved = target === 'deducted' ? result.previousQuantity - result.quantity : quantity;
      await m.query(
        `INSERT INTO josh_order_stock_moves (order_line_id, orders_id, product_id, warehouse_id, quantity, state, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (order_line_id) DO UPDATE SET state = EXCLUDED.state, quantity = EXCLUDED.quantity, updated_at = now()`,
        [line.id, order.orders_id, product.id, warehouse.id, moved, target]);
    }
  }
}
