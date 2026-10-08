import { BadRequestException, Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StaffRoles } from '../../../../shared-kernel/presentation/auth.decorators';

const PAGE_SIZE = 50;

/**
 * Read model for the "Inventory per warehouse" admin page: stock by SKU and
 * warehouse code (not ids), who owns each warehouse's stock, and the last
 * ledger movement per row. Merchandise and business analyst (read). No customer contact fields.
 */
@Controller('inventory-overview')
@StaffRoles('merchandising', 'business_analyst')
export class InventoryOverviewController {
  constructor(private readonly db: DataSource) {}

  @Get()
  @StaffRoles('merchandising', 'business_analyst', 'sale')
  async overview(
    @Query('warehouse') warehouse = '',
    @Query('search') search = '',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    if (page < 1 || page > 100000 || typeof warehouse !== 'string' || typeof search !== 'string') throw new BadRequestException('invalid query');
    const warehouses = await this.db.query(
      `SELECT w.code, w.name, w.stock_source AS "stockSource", count(l.id)::int AS skus,
              coalesce(sum(l.quantity), 0)::float AS "onHand", coalesce(sum(l.reserved), 0)::float AS reserved
       FROM warehouses w LEFT JOIN inventory_levels l ON l.warehouse_id = w.id AND l.deleted_at IS NULL
       WHERE w.deleted_at IS NULL GROUP BY w.id ORDER BY w.code`);

    const params: unknown[] = [];
    let where = 'l.deleted_at IS NULL';
    if (warehouse) { params.push(warehouse); where += ` AND w.code = $${params.length}`; }
    const q = search.trim().slice(0, 100).replace(/[%_]/g, '');
    if (q) { params.push(`%${q}%`); where += ` AND (p.sku ILIKE $${params.length} OR p.name ILIKE $${params.length})`; }
    const joins = 'FROM inventory_levels l JOIN products p ON p.id = l.product_id JOIN warehouses w ON w.id = l.warehouse_id';

    const [{ total }] = await this.db.query(`SELECT count(*)::int AS total ${joins} WHERE ${where}`, params);
    const items = await this.db.query(
      `SELECT l.id, p.sku, p.name, w.code AS "warehouseCode", w.stock_source AS "stockSource",
              l.quantity::float AS quantity, l.reserved::float AS reserved, (l.quantity - l.reserved)::float AS available, l.updated_at AS "updatedAt",
              m.source AS "lastSource", m.reason AS "lastReason", m.status AS "lastStatus", m.occurred_at AS "lastChangedAt"
       ${joins}
       LEFT JOIN LATERAL (SELECT source, reason, status, occurred_at FROM inventory_movements
         WHERE product_id = l.product_id AND warehouse_id = l.warehouse_id ORDER BY occurred_at DESC, created_at DESC LIMIT 1) m ON true
       WHERE ${where}
       ORDER BY p.sku, w.code LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
      [...params, (page - 1) * PAGE_SIZE]);
    return { warehouses, items, total, page, pageSize: PAGE_SIZE };
  }
}
