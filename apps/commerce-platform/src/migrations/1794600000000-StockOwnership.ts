import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 3 (commerce owns stock):
 * - one level row per product × warehouse (merge duplicates — keep the latest-updated — then a partial unique index),
 *   so ledger writes can lock an upserted row instead of racing on a missing one;
 * - warehouses.sellable: which warehouses count toward the stock platforms sell (inventory.sellable.snapshot);
 * - josh_erp_fallback_calls.processed_at / processed_note: ERP calls josh caught while commerce was down, replayed once;
 * - josh_order_stock_moves: per josh order line, whether it was taken from / given back to the commerce warehouse.
 */
export class StockOwnership1794600000000 implements MigrationInterface {
  name = 'StockOwnership1794600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM inventory_levels l USING inventory_levels k
      WHERE l.product_id = k.product_id AND l.warehouse_id = k.warehouse_id AND l.deleted_at IS NULL AND k.deleted_at IS NULL
        AND (l.updated_at, l.id) < (k.updated_at, k.id)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_inventory_levels_product_warehouse" ON inventory_levels (product_id, warehouse_id) WHERE deleted_at IS NULL`);
    await q.query(`ALTER TABLE warehouses ADD COLUMN sellable boolean NOT NULL DEFAULT true`);
    await q.query(`ALTER TABLE josh_erp_fallback_calls ADD COLUMN processed_at timestamptz NULL, ADD COLUMN processed_note text NULL`);
    await q.query(`CREATE TABLE josh_order_stock_moves (order_line_id uuid PRIMARY KEY, orders_id uuid NOT NULL, product_id uuid NOT NULL,
      warehouse_id uuid NOT NULL, quantity numeric(14,4) NOT NULL, state varchar(16) NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX "IDX_josh_order_stock_moves_order" ON josh_order_stock_moves (orders_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE josh_order_stock_moves`);
    await q.query(`ALTER TABLE josh_erp_fallback_calls DROP COLUMN processed_note, DROP COLUMN processed_at`);
    await q.query(`ALTER TABLE warehouses DROP COLUMN sellable`);
    await q.query(`DROP INDEX "UQ_inventory_levels_product_warehouse"`);
  }
}
