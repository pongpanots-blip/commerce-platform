import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { Paged, QueuePage, queueList, QueueSql } from '../queue-page';
import { ProductPriceSnapshot } from './product-price-snapshot.event';

export const ownsPrices = () => process.env.COMMERCE_OWNS_PRICES === 'true';

export interface PricePatch { sellingUnitPrice?: number | null; orderingPrice?: number | null; moq?: number | null }
type Row = { product_inventory_sku: string; selling_unit_price: string | null; ordering_price: string | null; moq: number | null };

const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
const COLS: Array<[keyof PricePatch, string]> = [['sellingUnitPrice', 'selling_unit_price'], ['orderingPrice', 'ordering_price'], ['moq', 'moq']];

export interface PendingPriceRow {
  sku: string; selling_unit_price: string | null; ordering_price: string | null; moq: number | null; changed_at: Date | null; received_at: Date;
  current_selling_unit_price: string | null; current_ordering_price: string | null; current_moq: number | null;
}
export interface PriceListRow { sku: string; selling_unit_price: string | null; ordering_price: string | null; moq: number | null; source: string; updated_by: string | null; updated_at: Date }

const PENDING_SQL: QueueSql = {
  select: `q.product_inventory_sku AS sku, q.selling_unit_price, q.ordering_price, q.moq, q.changed_at, q.received_at,
           p.selling_unit_price AS current_selling_unit_price, p.ordering_price AS current_ordering_price, p.moq AS current_moq`,
  from: `product_price_pending q LEFT JOIN product_prices p USING (product_inventory_sku)
         WHERE $1::text IS NULL OR q.product_inventory_sku ILIKE '%' || $1 || '%'`,
  order: 'q.received_at DESC, q.product_inventory_sku',
};
const LIST_SQL: QueueSql = {
  select: 'product_inventory_sku AS sku, selling_unit_price, ordering_price, moq, source, updated_by, updated_at',
  from: `product_prices WHERE $1::text IS NULL OR product_inventory_sku ILIKE '%' || $1 || '%'`,
  order: 'product_inventory_sku',
};

/**
 * Product prices owned by commerce (stage 4a, COMMERCE_OWNS_PRICES): base price, ERP box price and MOQ per SKU, and the
 * MER queue of ERP changes. Every change to a live price publishes product.price.snapshot in the same transaction, so
 * josh's copy (checkout reads it) follows. Customer / contract prices stay in staff_prices.
 */
@Injectable()
export class ProductPricesService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}

  /** ERP feed (or replayed fallback call): merge into the SKU's pending change — the newest ERP value per field wins. */
  async stage(m: EntityManager, sku: string, patch: PricePatch, changedAt: Date): Promise<void> {
    const set = COLS.filter(([k]) => patch[k] != null);
    if (!set.length) return;
    await m.query(
      `INSERT INTO product_price_pending (product_inventory_sku, ${set.map(([, c]) => c).join(', ')}, changed_at, received_at)
       VALUES ($1, ${set.map((_, i) => `$${i + 3}`).join(', ')}, $2, now())
       ON CONFLICT (product_inventory_sku) DO UPDATE SET ${set.map(([, c]) => `${c} = EXCLUDED.${c}`).join(', ')},
         changed_at = GREATEST(product_price_pending.changed_at, EXCLUDED.changed_at), received_at = now()`,
      [sku, changedAt, ...set.map(([k]) => patch[k])]);
  }

  /** The MER queue, newest ERP change first. Without paging: the legacy bare array, capped at 500. */
  pending(search?: string): Promise<PendingPriceRow[]>;
  pending(search: string | undefined, paging: QueuePage | undefined): Promise<PendingPriceRow[] | Paged<PendingPriceRow>>;
  pending(search?: string, paging?: QueuePage): Promise<PendingPriceRow[] | Paged<PendingPriceRow>> {
    return queueList<PendingPriceRow>(this.db, PENDING_SQL, [search?.trim() || null], paging, 500);
  }

  /** Live prices by SKU. Without paging: the legacy bare array, capped at 200. */
  list(search?: string): Promise<PriceListRow[]>;
  list(search: string | undefined, paging: QueuePage | undefined): Promise<PriceListRow[] | Paged<PriceListRow>>;
  list(search?: string, paging?: QueuePage): Promise<PriceListRow[] | Paged<PriceListRow>> {
    return queueList<PriceListRow>(this.db, LIST_SQL, [search?.trim() || null], paging, 200);
  }

  /** MER approves: the pending fields become the live price (others stay), the queue row goes, josh gets the snapshot. */
  async approve(skus: string[], staffId: string): Promise<{ approved: number }> {
    this.assertOwned();
    return this.db.transaction(m => this.approveWithin(m, skus, staffId));
  }

  /** Native operation, also used by the reviewed receipt coordinator in its existing transaction. */
  async approveWithin(m: EntityManager, skus: string[], staffId: string): Promise<{ approved: number }> {
      this.assertOwned();
      await m.query('SELECT product_inventory_sku FROM product_price_pending WHERE product_inventory_sku=ANY($1::text[]) ORDER BY product_inventory_sku FOR UPDATE', [skus]);
      // TypeORM pg: DELETE … RETURNING resolves to [rows, affectedCount].
      const [rows]: [Row[], number] = await m.query(`DELETE FROM product_price_pending WHERE product_inventory_sku = ANY($1) RETURNING *`, [skus]);
      for (const r of rows) {
        // Only the fields ERP changed (null in the queue = not part of this change).
        await this.write(m, r.product_inventory_sku, {
          sellingUnitPrice: num(r.selling_unit_price) ?? undefined, orderingPrice: num(r.ordering_price) ?? undefined, moq: r.moq ?? undefined,
        }, 'erp', staffId);
      }
      return { approved: rows.length };
  }

  async rejectWithin(m: EntityManager, skus: string[]): Promise<{ rejected: number }> {
    this.assertOwned();
    await m.query('SELECT product_inventory_sku FROM product_price_pending WHERE product_inventory_sku=ANY($1::text[]) ORDER BY product_inventory_sku FOR UPDATE', [skus]);
    const [, n] = await m.query(`DELETE FROM product_price_pending WHERE product_inventory_sku = ANY($1)`, [skus]);
    return { rejected: Number(n ?? 0) };
  }

  async reject(skus: string[]): Promise<{ rejected: number }> {
    this.assertOwned();
    return this.db.transaction(m => this.rejectWithin(m, skus));
  }

  /** Staff edit (commerce-admin price page, or the product form's price fields). */
  async edit(sku: string, patch: PricePatch, staffId: string) {
    return this.db.transaction(m => this.editWithin(m, sku, patch, staffId));
  }

  /** Same native edit, inside the reviewed editor's transaction with its durable receipt. */
  async editWithin(m: EntityManager, sku: string, patch: PricePatch, staffId: string) {
    this.assertOwned();
    if (!COLS.some(([k]) => patch[k] !== undefined)) throw new BadRequestException('ไม่มีราคาให้แก้');
      const [known] = await m.query(`SELECT 1 FROM product_prices WHERE product_inventory_sku = $1
        UNION ALL SELECT 1 FROM josh_catalog_products WHERE sku = $1 LIMIT 1`, [sku]);
      if (!known) throw new NotFoundException(`ไม่พบสินค้า SKU ${sku}`);
      return this.write(m, sku, patch, 'staff', staffId);
  }

  /** Upsert the given fields (null clears, undefined keeps) and publish the resulting row. */
  private async write(m: EntityManager, sku: string, patch: PricePatch, source: string, staffId: string) {
    await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`product-price:${sku}`]);
    const set = COLS.filter(([k]) => patch[k] !== undefined);
    if (!set.length) throw new BadRequestException(`ไม่มีราคาให้บันทึกสำหรับ ${sku}`);
    const [row]: Row[] = await m.query(
      `INSERT INTO product_prices (product_inventory_sku, ${set.map(([, c]) => c).join(', ')}, source, updated_by, updated_at)
       VALUES ($1, ${set.map((_, i) => `$${i + 4}`).join(', ')}, $2, $3, now())
       ON CONFLICT (product_inventory_sku) DO UPDATE SET ${set.map(([, c]) => `${c} = EXCLUDED.${c}`).join(', ')},
         source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING product_inventory_sku, selling_unit_price, ordering_price, moq`,
      [sku, source, staffId, ...set.map(([k]) => patch[k])]);
    const snapshot = { sku, sellingUnitPrice: num(row.selling_unit_price), orderingPrice: num(row.ordering_price), moq: row.moq, version: new Date().toISOString() };
    await this.events.publish(new ProductPriceSnapshot(snapshot), m);
    return snapshot;
  }

  private assertOwned() {
    if (!ownsPrices()) throw new ConflictException('ราคาสินค้ายังแก้/อนุมัติที่ josh (COMMERCE_OWNS_PRICES is not true)');
  }
}
