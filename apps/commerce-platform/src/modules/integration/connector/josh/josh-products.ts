import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JoshReplica } from './josh-replica';

/** What needs attention on a product. Each is one SQL condition on josh's product_inventory `p`. */
export const PRODUCT_ISSUES = {
  pending_approval: 'p.erp_pending_at IS NOT NULL',
  no_image: `NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type::text = 'image')`,
  no_category: 'p.category_id IS NULL',
  no_price: 'COALESCE(p.selling_unit_price, 0) <= 0',
  out_of_stock: `COALESCE(p.product_inventory_quantity, 0) <= 0 AND COALESCE(p.order_taking_flag, 'N') <> 'Y'`,
  low_stock: `p.product_inventory_quantity > 0 AND p.product_inventory_quantity <= COALESCE(p.low_stock_threshold, 10) AND COALESCE(p.order_taking_flag, 'N') <> 'Y'`,
} as const;
export type ProductIssue = keyof typeof PRODUCT_ISSUES;

export interface ProductFilters { search?: string; status?: string; issue?: string; categoryId?: string; brand?: string; orderTaking?: string }

/** ERP field in an approval-pending payload → the live value it would replace. */
const PENDING_FIELDS: Record<string, string> = {
  SELLING_UNIT_PRICE: 'selling_unit_price', ORDERING_PRICE: 'ordering_price', PRICE: 'original_price', MOQ: 'moq',
  PRODUCT_NAME_T: 'name_th', PRODUCT_NAME_E: 'name_en', SELLING_UNIT: 'selling_unit', PACK_SIZE: 'pack_size',
  BRAND_NAME: 'brand_name', ORDER_TAKING: 'order_taking_flag', STATUS: 'product_status',
};

/** The rest of the content the product form edits (stage 4b) and the logistics fields (stage 4f). */
const DETAIL_COLUMNS = `p.ingredients, p.allergens, p.expiration_info, p.usage_direction, p.best_paired_food, p.maximum_shelf_life, p.is_organic,
  p.product_short_code, p.buying_price::float AS buying_price, p.reorder_quantity,
  p.unit_ratio, p.sub_packing_unit, p.product_unit, p.expected_restock_at, p.delivery_dates`;

const COLUMNS = `p.product_inventory_id, p.product_inventory_sku, p.product_status, th.product_name AS name_th, en.product_name AS name_en,
  p.category_id, c.category_name_th, c.category_path, p.brand_code, p.brand_name,
  p.selling_unit_price::float AS selling_unit_price, p.ordering_price::float AS ordering_price, p.original_price::float AS original_price,
  p.product_inventory_quantity, p.low_stock_threshold, p.moq, p.selling_unit, p.pack_size, p.order_taking_flag, p.sup_code,
  p.storage_temperature, p.country_code_source, p.erp_pending_source, p.erp_pending_at, p.updated_at,
  (SELECT count(*) FROM product_media m WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type::text = 'image')::int AS image_count,
  (SELECT m.source FROM product_media m WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type::text = 'image' ORDER BY m.sort_order LIMIT 1) AS image_url`;
const JOINS = `LEFT JOIN product_translation th ON th.product_inventory_id = p.product_inventory_id AND th.language_code = 'th'
  LEFT JOIN product_translation en ON en.product_inventory_id = p.product_inventory_id AND en.language_code = 'en'
  LEFT JOIN product_category c ON c.id = p.category_id`;

export function productWhere(f: ProductFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const add = (v: unknown) => `$${params.push(v)}`;
  const w: string[] = [];
  const search = f.search?.trim().slice(0, 100);
  if (search) {
    const s = add(`%${search}%`);
    w.push(`(p.product_inventory_sku ILIKE ${s} OR th.product_name ILIKE ${s} OR en.product_name ILIKE ${s})`);
  }
  if (f.status) w.push(`p.product_status = ${add(f.status.slice(0, 20))}`);
  if (f.issue) {
    if (!(f.issue in PRODUCT_ISSUES)) throw new BadRequestException(`issue must be one of: ${Object.keys(PRODUCT_ISSUES).join(', ')}`);
    w.push(PRODUCT_ISSUES[f.issue as ProductIssue]);
  }
  if (f.categoryId) {
    if (!/^[0-9a-f-]{36}$/i.test(f.categoryId)) throw new BadRequestException('categoryId must be a uuid');
    w.push(`p.category_id = ${add(f.categoryId)}`);
  }
  if (f.brand?.trim()) w.push(`p.brand_name ILIKE ${add(`%${f.brand.trim().slice(0, 100)}%`)}`);
  if (f.orderTaking === 'Y' || f.orderTaking === 'N') w.push(`COALESCE(p.order_taking_flag, 'N') = ${add(f.orderTaking)}`);
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

/**
 * josh's product catalog, READ-ONLY, from josh's replica (headless plan step 3 starts here: commerce
 * shows the catalog before it owns it). Field names are josh's columns. Editing, approving ERP
 * changes and images stay in josh admin until product ownership moves.
 */
@Injectable()
export class JoshProducts {
  constructor(private readonly replica: JoshReplica) {}

  get available() { return this.replica.configured; }

  /** Counts for the issue tiles: one scan of product_inventory. */
  async summary() {
    const issues = Object.entries(PRODUCT_ISSUES).map(([k, cond]) => `count(*) FILTER (WHERE ${cond})::int AS ${k}`).join(', ');
    const [[row], byStatus] = await Promise.all([
      this.replica.query(`SELECT count(*)::int AS total, ${issues} FROM product_inventory p`),
      this.replica.query(`SELECT product_status AS status, count(*)::int AS n FROM product_inventory GROUP BY 1 ORDER BY 2 DESC`),
    ]);
    return { ...row, byStatus };
  }

  async list(f: ProductFilters, page = 1, limit = 50) {
    const { where, params } = productWhere(f);
    const n = params.length;
    const [items, [{ total }]] = await Promise.all([
      this.replica.query(`SELECT ${COLUMNS} FROM product_inventory p ${JOINS} ${where}
        ORDER BY p.erp_pending_at DESC NULLS LAST, p.updated_at DESC, p.product_inventory_sku LIMIT $${n + 1} OFFSET $${n + 2}`, [...params, limit, (page - 1) * limit]),
      this.replica.query(`SELECT count(*)::int AS total FROM product_inventory p ${JOINS} ${where}`, params),
    ]);
    return { items, total, page, limit };
  }

  /** One product with all its images, and — if the ERP sent a change still waiting for approval in josh — each pending field next to its live value. */
  async detail(idOrSku: string) {
    const bySku = !/^[0-9a-f-]{36}$/i.test(idOrSku);
    const [row] = await this.replica.query<Record<string, unknown>>(
      `SELECT ${COLUMNS}, p.vat_type, p.erp_pending_payload, p.created_at, th.product_description AS description_th, en.product_description AS description_en,
        ${DETAIL_COLUMNS} FROM product_inventory p ${JOINS}
        WHERE ${bySku ? 'p.product_inventory_sku = $1' : 'p.product_inventory_id = $1'} LIMIT 1`, [idOrSku.trim().slice(0, 100)]);
    if (!row) throw new NotFoundException(`product ${idOrSku} not found in josh`);
    const media = await this.replica.query(
      `SELECT product_media_id::text AS id, source, media_type::text AS media_type, sort_order FROM product_media WHERE product_inventory_id = $1 ORDER BY sort_order, created_at`, [row.product_inventory_id]);
    const payload = (row.erp_pending_payload ?? null) as Record<string, unknown> | null;
    const pendingChanges = payload
      ? Object.entries(payload).map(([field, next]) => {
        const column = PENDING_FIELDS[field.toUpperCase()];
        const current = column ? row[column] : undefined;
        return { field, column: column ?? null, current: current ?? null, pending: next, changed: column ? String(current ?? '') !== String(next ?? '') : null };
      })
      : [];
    return { ...row, media, pendingChanges };
  }

  categories() {
    return this.replica.query(`SELECT id, category_name_th, category_name_en, category_path FROM product_category WHERE is_active IS NOT FALSE ORDER BY category_path NULLS LAST, category_name_th`);
  }
}
