import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { splitLogistics } from './logistics-fields';
import { mapErpOrderPeriods } from './order-periods';
import { ProductLogisticsSnapshot, SupplierOrderPeriodsSnapshot } from './ordering-snapshot.events';

export const ownsOrdering = () => process.env.COMMERCE_OWNS_ORDERING === 'true';

const PERIOD_COLS = `erp_order_period, to_char(date_from, 'YYYY-MM-DD') AS date_from, to_char(date_to, 'YYYY-MM-DD') AS date_to, close_at, status`;
type PeriodDbRow = { erp_order_period: string; date_from: string; date_to: string; close_at: Date | string | null; status: string };
const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());

/**
 * Ordering / logistics owned by commerce (stage 4f, COMMERCE_OWNS_ORDERING): the ERP's supplier order rounds (checkout
 * gate for pre-order SKUs) and each SKU's logistics fields. Every write publishes its snapshot in the same transaction:
 * one supplier's rounds (all of them) or one SKU's logistics row.
 */
@Injectable()
export class OrderingService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}

  /**
   * An ERP order-period push (relayed in the same transaction, or a replayed fallback call): josh's upsertFromErp — upsert
   * by (sup_code, erp_order_period), close the supplier's other rounds — then each supplier's rounds go to josh.
   */
  async fromErp(m: EntityManager, body: unknown): Promise<{ upserted: number; suppliers: number }> {
    if (!ownsOrdering()) return { upserted: 0, suppliers: 0 };
    const rows = mapErpOrderPeriods(body);
    if (!rows.length) return { upserted: 0, suppliers: 0 };
    await m.query(
      `INSERT INTO supplier_order_periods (sup_code, erp_order_period, date_from, date_to, close_at, status, synced_at)
       SELECT r.sup_code, r.erp_order_period, r.date_from::date, r.date_to::date, r.close_at::timestamptz, r.status, now()
         FROM jsonb_to_recordset($1::jsonb) AS r(sup_code text, erp_order_period text, date_from text, date_to text, close_at text, status text)
       ON CONFLICT (sup_code, erp_order_period) DO UPDATE SET date_from = EXCLUDED.date_from, date_to = EXCLUDED.date_to,
         close_at = EXCLUDED.close_at, status = EXCLUDED.status, synced_at = now(), updated_at = now()`,
      [JSON.stringify(rows)]);
    const suppliers = [...new Set(rows.map((r) => r.sup_code))];
    for (const sup of suppliers) {
      const kept = rows.filter((r) => r.sup_code === sup).map((r) => r.erp_order_period);
      await m.query(
        `UPDATE supplier_order_periods SET status = 'C', synced_at = now(), updated_at = now()
          WHERE sup_code = $1 AND NOT (erp_order_period = ANY($2)) AND status <> 'C'`, [sup, kept]);
      await this.publishPeriods(m, sup);
    }
    return { upserted: rows.length, suppliers: suppliers.length };
  }

  /** Rounds per supplier, open first (admin page). */
  periods(supCode?: string) {
    return this.db.query(
      `SELECT sup_code, ${PERIOD_COLS}, synced_at FROM supplier_order_periods
        WHERE $1::text IS NULL OR sup_code ILIKE '%' || $1 || '%'
        ORDER BY sup_code, (status = 'C'), date_from DESC LIMIT 1000`, [supCode?.trim() || null]);
  }

  /** Send one supplier's rounds to josh again (repair after a dead-letter / a long-off subscription). */
  async republish(supCode: string) {
    this.assertOwned();
    return this.db.transaction(async (m) => {
      const snapshot = await this.publishPeriods(m, supCode);
      if (!snapshot) throw new NotFoundException(`ไม่มีรอบสั่งซื้อของ supplier ${supCode} ใน commerce`);
      return snapshot;
    });
  }

  private async publishPeriods(m: EntityManager, supCode: string) {
    const rows: PeriodDbRow[] = await m.query(`SELECT ${PERIOD_COLS} FROM supplier_order_periods WHERE sup_code = $1 ORDER BY erp_order_period`, [supCode]);
    if (!rows.length) return null; // never an empty list: josh would wipe the supplier's rounds
    const snapshot = { supCode, periods: rows.map((r) => ({ ...r, close_at: iso(r.close_at) })), version: new Date().toISOString() };
    await this.events.publish(new SupplierOrderPeriodsSnapshot(snapshot), m);
    return snapshot;
  }

  async getLogistics(sku: string) {
    const [row] = await this.db.query(`SELECT product_inventory_sku AS sku, fields, source, updated_by, updated_at FROM product_logistics WHERE product_inventory_sku = $1`, [sku]);
    if (!row) throw new NotFoundException(`ไม่มีข้อมูลโลจิสติกส์ของ SKU ${sku} ใน commerce`);
    return row;
  }

  /** Staff edit from the product form: its logistics keys only (validated; empty = clear, delivery days empty = every day). */
  async editLogistics(sku: string, body: Record<string, unknown>, staffId: string) {
    this.assertOwned();
    const { logistics, rest } = splitLogistics(body);
    if (Object.keys(rest).length) throw new BadRequestException(`ไม่ใช่ข้อมูลโลจิสติกส์: ${Object.keys(rest).join(', ')}`);
    if (!Object.keys(logistics).length) throw new BadRequestException('ไม่มีข้อมูลให้แก้');
    return this.db.transaction(async (m) => {
      const [known] = await m.query(`SELECT 1 FROM product_logistics WHERE product_inventory_sku = $1
        UNION ALL SELECT 1 FROM josh_catalog_products WHERE sku = $1 LIMIT 1`, [sku]);
      if (!known) throw new NotFoundException(`ไม่พบสินค้า SKU ${sku}`);
      const [row]: Array<{ fields: Record<string, unknown> }> = await m.query(
        `INSERT INTO product_logistics (product_inventory_sku, fields, source, updated_by, updated_at) VALUES ($1, $2, 'staff', $3, now())
         ON CONFLICT (product_inventory_sku) DO UPDATE SET fields = product_logistics.fields || EXCLUDED.fields,
           source = 'staff', updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING fields`, [sku, JSON.stringify(logistics), staffId]);
      const snapshot = { sku, fields: row.fields, version: new Date().toISOString() };
      await this.events.publish(new ProductLogisticsSnapshot(snapshot), m);
      return snapshot;
    });
  }

  private assertOwned() {
    if (!ownsOrdering()) throw new ConflictException('รอบสั่งซื้อ/โลจิสติกส์ยังแก้ที่ josh (COMMERCE_OWNS_ORDERING is not true)');
  }
}
