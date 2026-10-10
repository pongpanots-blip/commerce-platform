import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';
import { Paged, QueuePage, queueList, QueueSql } from '../queue-page';
import { buildExtrasPatch, EXTRA_COLUMNS } from './erp-extras';
import { buildMasterPatch, splitMaster } from './master-fields';
import { ProductMasterSnapshot } from './product-master-snapshot.event';

/** Pack columns josh derives from pack_size. */
const PACK_DERIVED = ['packaging_type', 'units_per_box', 'weight_per_unit'];

export const ownsProductMaster = () => process.env.COMMERCE_OWNS_PRODUCT_MASTER === 'true';

export interface PendingMasterRow { sku: string; patch: Record<string, unknown>; changed_at: Date | null; received_at: Date; current: Record<string, unknown> }
const PENDING_SQL: QueueSql = {
  select: `q.product_inventory_sku AS sku, q.patch, q.changed_at, q.received_at, COALESCE(p.fields, '{}') AS current`,
  from: `product_master_pending q LEFT JOIN product_masters p USING (product_inventory_sku)
         WHERE $1::text IS NULL OR q.product_inventory_sku ILIKE '%' || $1 || '%'`,
  order: 'q.received_at DESC, q.product_inventory_sku',
};

/**
 * The ERP product master owned by commerce (stage 4d, COMMERCE_OWNS_PRODUCT_MASTER): units, pack, brand name, VAT,
 * status, category … per live SKU, and the MER queue of ERP changes to them. Every write publishes
 * product.master.snapshot with the whole row in the same transaction; josh applies it like its own MER approve.
 */
@Injectable()
export class ProductMastersService {
  private readonly logger = new Logger(ProductMastersService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}

  /**
   * ERP product upserts (relayed to josh in the same transaction, or replayed fallback calls): each item's master patch
   * merges into the SKU's pending change — for live SKUs only (commerce holds the row, or the catalog copy shows it
   * live). New SKUs and drafts are josh's: it creates the draft with ERP values and MER activates it there.
   */
  async stageFromErp(m: EntityManager, body: unknown, at: Date): Promise<number> {
    const items = (Array.isArray(body) ? body : [body]).filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
    for (const item of items) await this.saveExtras(m, item);
    if (!ownsProductMaster()) return 0;
    let staged = 0;
    for (const item of items) {
      const sku = typeof item.PRODUCT_CODE === 'string' ? item.PRODUCT_CODE.trim() : '';
      const patch = buildMasterPatch(item);
      if (!sku || !Object.keys(patch).length) continue;
      const [live] = await m.query(`SELECT 1 FROM product_masters WHERE product_inventory_sku = $1
        UNION ALL SELECT 1 FROM josh_catalog_products WHERE sku = $1 AND removed_at IS NULL AND status IS DISTINCT FROM 'draft' LIMIT 1`, [sku]);
      if (!live) continue;
      await m.query(
        `INSERT INTO product_master_pending (product_inventory_sku, patch, changed_at, received_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (product_inventory_sku) DO UPDATE SET patch = product_master_pending.patch || EXCLUDED.patch,
           changed_at = GREATEST(product_master_pending.changed_at, EXCLUDED.changed_at), received_at = now()`,
        [sku, JSON.stringify(patch), at]);
      staged++;
    }
    return staged;
  }

  /**
   * The upsert's extras (erp-extras.ts) apply straight away for any SKU — ERP facts, not MER-approved content, and
   * commerce is their only writer. Bad fields are skipped and logged so the rest of the call still lands.
   */
  private async saveExtras(m: EntityManager, item: Record<string, unknown>) {
    const sku = typeof item.PRODUCT_CODE === 'string' ? item.PRODUCT_CODE.trim() : '';
    const { patch, invalid } = buildExtrasPatch(item);
    if (invalid.length) this.logger.warn(`ERP product ${sku || '?'}: skipped invalid ${invalid.join(', ')}`);
    const cols = EXTRA_COLUMNS.filter((c) => c in patch);
    if (!sku || sku.length > 64 || !cols.length) return;
    const json = (c: string) => c === 'substitutes' || c === 'fda_images';
    await m.query(
      `INSERT INTO product_erp_extras (product_inventory_sku, ${cols.join(', ')}) VALUES ($1, ${cols.map((c, i) => `$${i + 2}${json(c) ? '::jsonb' : ''}`).join(', ')})
       ON CONFLICT (product_inventory_sku) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()`,
      [sku, ...cols.map((c) => (json(c) ? JSON.stringify(patch[c]) : patch[c]))]);
  }

  /** Aging, min prices, substitutes and FDA album of one SKU; a SKU the ERP never sent them for reads empty. */
  async extras(sku: string) {
    const [row] = await this.db.query(
      `SELECT product_inventory_sku AS sku, aging_days, min_price, min_selling_unit_price, substitutes, fda_images, updated_at
       FROM product_erp_extras WHERE product_inventory_sku = $1`, [sku]);
    return row ?? { sku, aging_days: null, min_price: null, min_selling_unit_price: null, substitutes: [], fda_images: [], updated_at: null };
  }

  /** The MER queue, newest ERP change first. Without paging: the legacy bare array, capped at 500. */
  pending(search?: string): Promise<PendingMasterRow[]>;
  pending(search: string | undefined, paging: QueuePage | undefined): Promise<PendingMasterRow[] | Paged<PendingMasterRow>>;
  pending(search?: string, paging?: QueuePage): Promise<PendingMasterRow[] | Paged<PendingMasterRow>> {
    return queueList<PendingMasterRow>(this.db, PENDING_SQL, [search?.trim() || null], paging, 500);
  }

  async get(sku: string) {
    const [row] = await this.db.query(`SELECT product_inventory_sku AS sku, fields, source, updated_by, updated_at FROM product_masters WHERE product_inventory_sku = $1`, [sku]);
    if (!row) throw new NotFoundException(`ไม่มีข้อมูลสินค้า (ERP) ของ SKU ${sku} ใน commerce`);
    return row;
  }

  /** MER approves: the pending fields become the live ones (others stay), the queue row goes, josh gets the snapshot. */
  async approve(skus: string[], staffId: string): Promise<{ approved: number }> {
    this.assertOwned();
    return this.db.transaction(async (m) => {
      // TypeORM pg: DELETE … RETURNING resolves to [rows, affectedCount].
      const [rows]: [Array<{ product_inventory_sku: string; patch: Record<string, unknown> }>, number] =
        await m.query(`DELETE FROM product_master_pending WHERE product_inventory_sku = ANY($1) RETURNING product_inventory_sku, patch`, [skus]);
      for (const r of rows) await this.write(m, r.product_inventory_sku, r.patch, 'erp', staffId);
      return { approved: rows.length };
    });
  }

  async reject(skus: string[]): Promise<{ rejected: number }> {
    this.assertOwned();
    const [, n] = await this.db.query(`DELETE FROM product_master_pending WHERE product_inventory_sku = ANY($1)`, [skus]);
    return { rejected: Number(n ?? 0) };
  }

  /** Staff edit from the product form: its master keys (status, brand, units, pack …; category by id). */
  async edit(sku: string, body: Record<string, unknown>, staffId: string) {
    this.assertOwned();
    const { master, categoryId, rest } = splitMaster(body);
    if (Object.keys(rest).length) throw new BadRequestException(`ไม่ใช่ข้อมูลสินค้า (ERP): ${Object.keys(rest).join(', ')}`);
    return this.db.transaction(async (m) => {
      if (categoryId !== undefined) {
        if (categoryId === null) master.category_code = null;
        else {
          const [c] = await m.query(`SELECT category_code FROM product_categories WHERE id::text = $1`, [categoryId]);
          if (!c) throw new BadRequestException('ไม่พบหมวดหมู่สินค้า');
          master.category_code = c.category_code;
        }
      }
      if (!Object.keys(master).length) throw new BadRequestException('ไม่มีข้อมูลให้แก้');
      const [known] = await m.query(`SELECT 1 FROM product_masters WHERE product_inventory_sku = $1
        UNION ALL SELECT 1 FROM josh_catalog_products WHERE sku = $1 LIMIT 1`, [sku]);
      if (!known) throw new NotFoundException(`ไม่พบสินค้า SKU ${sku}`);
      return this.write(m, sku, master, 'staff', staffId);
    });
  }

  private async write(m: EntityManager, sku: string, patch: Record<string, unknown>, source: string, staffId: string) {
    // josh derives the type / units per box / weight per unit from pack_size unless they are given (syncPackFieldsFromErp):
    // a new pack_size without them drops commerce's copies, so the snapshot never feeds josh the old ones.
    const derived = 'pack_size' in patch ? PACK_DERIVED.filter((k) => !(k in patch)) : [];
    const [row]: Array<{ fields: Record<string, unknown> }> = await m.query(
      `INSERT INTO product_masters (product_inventory_sku, fields, source, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (product_inventory_sku) DO UPDATE SET fields = (product_masters.fields - $5::text[]) || EXCLUDED.fields,
         source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING fields`, [sku, JSON.stringify(patch), source, staffId, derived]);
    const snapshot = { sku, fields: row.fields, version: new Date().toISOString() };
    await this.events.publish(new ProductMasterSnapshot(snapshot), m);
    return snapshot;
  }

  private assertOwned() {
    if (!ownsProductMaster()) throw new ConflictException('ข้อมูลสินค้าจาก ERP ยังแก้/อนุมัติที่ josh (COMMERCE_OWNS_PRODUCT_MASTER is not true)');
  }
}
