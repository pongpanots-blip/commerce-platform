import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JoshReplica } from './josh-replica';
import { containsPattern } from '../../../../shared-kernel/helpers/like.helper';
import { ownsPrices } from '../../../commerce/product-prices/product-prices.service';
import { ownsProductMaster } from '../../../commerce/product-masters/product-masters.service';
import { ownsProductContent } from '../../../commerce/product-contents/product-contents.service';
import { ownsProductImages } from '../../../commerce/product-images/product-images.service';
import { ownsCategories } from '../../../commerce/product-categories/category-rules';

/** What needs attention on a product. Each is one SQL condition on josh's product_inventory `p`. */
export const PRODUCT_ISSUES = {
  pending_approval: 'p.erp_pending_at IS NOT NULL',
  no_image: `NOT EXISTS (SELECT 1 FROM product_media m WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type::text = 'image')`,
  no_category: 'p.category_id IS NULL',
  // Same rule as josh's shop: a SKU without a positive selling_price (the red price per sell unit) is hidden.
  no_price: 'COALESCE(p.selling_price, 0) <= 0',
  out_of_stock: `COALESCE(p.product_inventory_quantity, 0) <= 0 AND COALESCE(p.order_taking_flag, 'N') <> 'Y'`,
  low_stock: `p.product_inventory_quantity > 0 AND p.product_inventory_quantity <= COALESCE(p.low_stock_threshold, 10) AND COALESCE(p.order_taking_flag, 'N') <> 'Y'`,
} as const;
export type ProductIssue = keyof typeof PRODUCT_ISSUES;

export interface ProductFilters { search?: string; status?: string; issue?: string; categoryId?: string; brand?: string; orderTaking?: string }

/** ERP field in an approval-pending payload → the live value it would replace. */
const PENDING_FIELDS: Record<string, string> = {
  // josh prices off ERP PRICE (ORDERING_PRICE on older payloads) as selling_price; SELLING_UNIT_PRICE is no longer stored.
  ORDERING_PRICE: 'selling_price', PRICE: 'selling_price', MOQ: 'moq',
  PRODUCT_NAME_T: 'name_th', PRODUCT_NAME_E: 'name_en', SELLING_UNIT: 'selling_unit', PACK_SIZE: 'pack_size',
  BRAND_NAME: 'brand_name', ORDER_TAKING: 'order_taking_flag', STATUS: 'product_status',
};

/** The rest of the content the product form edits (stage 4b) and the logistics fields (stage 4f). */
const DETAIL_COLUMNS = `p.ingredients, p.allergens, p.expiration_info, p.usage_direction, p.best_paired_food, p.maximum_shelf_life, p.is_organic,
  p.product_short_code, p.buying_price::float AS buying_price, p.reorder_quantity,
  p.unit_ratio, p.sub_packing_unit, p.product_unit, p.expected_restock_at, p.delivery_dates`;

const COLUMNS = `p.product_inventory_id, p.product_inventory_sku, p.product_status, th.product_name AS name_th, en.product_name AS name_en,
  p.category_id, c.category_name_th, c.category_path, p.brand_code, p.brand_name,
  p.selling_price::float AS selling_price, p.original_price::float AS original_price,
  p.product_inventory_quantity, p.low_stock_threshold, p.moq, p.selling_unit, p.order_taking_unit, p.pack_size, p.order_taking_flag, p.sup_code,
  p.storage_temperature, p.country_code_source, p.erp_pending_source, p.erp_pending_at, p.updated_at,
  (SELECT count(*) FROM product_media m WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type::text = 'image')::int AS image_count,
  (SELECT m.source FROM product_media m WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type::text = 'image' ORDER BY m.sort_order LIMIT 1) AS image_url`;
const JOINS = `LEFT JOIN product_translation th ON th.product_inventory_id = p.product_inventory_id AND th.language_code = 'th'
  LEFT JOIN product_translation en ON en.product_inventory_id = p.product_inventory_id AND en.language_code = 'en'
  LEFT JOIN product_category c ON c.id = p.category_id`;

/** Where the list's names and issues come from: josh's tables (replica) or the COPY subquery below (copies). */
interface Dialect { nameTh: string; nameEn: string; issues: Record<ProductIssue, string> }
const REPLICA: Dialect = { nameTh: 'th.product_name', nameEn: 'en.product_name', issues: PRODUCT_ISSUES };
const COPIES: Dialect = { nameTh: 'p.name_th', nameEn: 'p.name_en', issues: { ...PRODUCT_ISSUES, no_image: 'p.image_count = 0' } };

export function productWhere(f: ProductFilters, d: Dialect = REPLICA): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const add = (v: unknown) => `$${params.push(v)}`;
  const w: string[] = [];
  const search = f.search?.trim().slice(0, 100);
  if (search) {
    const s = add(containsPattern(search));
    w.push(`(p.product_inventory_sku ILIKE ${s} ESCAPE '\\' OR ${d.nameTh} ILIKE ${s} ESCAPE '\\' OR ${d.nameEn} ILIKE ${s} ESCAPE '\\')`);
  }
  if (f.status) w.push(`p.product_status = ${add(f.status.slice(0, 20))}`);
  if (f.issue) {
    if (!(f.issue in PRODUCT_ISSUES)) throw new BadRequestException(`issue must be one of: ${Object.keys(PRODUCT_ISSUES).join(', ')}`);
    w.push(d.issues[f.issue as ProductIssue]);
  }
  if (f.categoryId) {
    if (!/^[0-9a-f-]{36}$/i.test(f.categoryId)) throw new BadRequestException('categoryId must be a uuid');
    w.push(`p.category_id = ${add(f.categoryId)}`);
  }
  if (f.brand?.trim()) w.push(`p.brand_name ILIKE ${add(containsPattern(f.brand.trim().slice(0, 100)))} ESCAPE '\\'`);
  if (f.orderTaking === 'Y' || f.orderTaking === 'N') w.push(`COALESCE(p.order_taking_flag, 'N') = ${add(f.orderTaking)}`);
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

type Source = 'replica' | 'copies';
/**
 * PRODUCTS_SOURCE: replica (default) · copies (stage 5, S5-4): `josh_catalog_products` (catalog.snapshot + the S5-11
 * report fields; removed products left out), works without the replica. Where commerce owns a part (COMMERCE_OWNS_*),
 * its own table wins: prices / MOQ (`product_prices`), ERP changes waiting for approval (`product_price_pending`,
 * `product_master_pending` — josh never sees those), galleries (`product_images`), content fields (`product_contents`),
 * the category list (`product_categories`). Not in the copy: josh's `erp_pending_payload` and its full media list
 * (`notCopied` in the detail); quantity is as of the last stock-state change (out / low / ok).
 */
export const productsSource = (): Source => (process.env.PRODUCTS_SOURCE?.trim().toLowerCase() === 'copies' ? 'copies' : 'replica');
const tr = (lang: string) => `(SELECT t->>'product_name' FROM jsonb_array_elements(c.translations) t WHERE t->>'language_code' = '${lang}' LIMIT 1)`;
const trDesc = (lang: string) => `(SELECT t->>'product_description' FROM jsonb_array_elements(c.translations) t WHERE t->>'language_code' = '${lang}' LIMIT 1)`;
/** The copy, with the replica's column names (`p.*` in COLUMNS-equivalent form), overlaid by what commerce owns now. */
function copyFrom() {
  const prices = ownsPrices(), master = ownsProductMaster(), images = ownsProductImages();
  const pending = [prices && 'pp.received_at', master && 'pm.received_at'].filter(Boolean) as string[];
  const pendingAt = pending.length ? `COALESCE(c.erp_pending_at, GREATEST(${pending.join(', ')}))` : 'c.erp_pending_at';
  const pendingSource = pending.length
    ? `CASE WHEN c.erp_pending_at IS NOT NULL THEN c.erp_pending_source WHEN GREATEST(${pending.join(', ')}) IS NOT NULL THEN 'commerce' END`
    : 'c.erp_pending_source';
  return `(SELECT c.id AS product_inventory_id, c.sku AS product_inventory_sku, c.status AS product_status, ${tr('th')} AS name_th, ${tr('en')} AS name_en,
      ${trDesc('th')} AS description_th, ${trDesc('en')} AS description_en,
      c.category_id, c.category_name_th, c.category_path, c.brand_code, c.brand_name,
      c.ordering_price::float AS selling_price, c.original_price::float AS original_price,
      c.product_inventory_quantity, c.low_stock_threshold, ${prices ? 'COALESCE(pr.moq, c.moq)' : 'c.moq'} AS moq, c.selling_unit, c.order_taking_unit, c.pack_size,
      c.order_taking_flag, c.sup_code, c.storage_temperature, c.country_code_source, ${pendingSource} AS erp_pending_source, ${pendingAt} AS erp_pending_at,
      c.josh_updated_at AS updated_at, ${images ? 'COALESCE(jsonb_array_length(pi.images), c.image_count)' : 'c.image_count'} AS image_count,
      ${images ? `COALESCE(pi.images->>0, c.image_url)` : 'c.image_url'} AS image_url, c.vat_type
    FROM josh_catalog_products c
    ${prices ? 'LEFT JOIN product_prices pr ON pr.product_inventory_sku = c.sku LEFT JOIN product_price_pending pp ON pp.product_inventory_sku = c.sku' : ''}
    ${master ? 'LEFT JOIN product_master_pending pm ON pm.product_inventory_sku = c.sku' : ''}
    ${images ? 'LEFT JOIN product_images pi ON pi.product_inventory_sku = c.sku' : ''}
    WHERE c.removed_at IS NULL) p`;
}
const COPY_COLUMNS = `p.product_inventory_id, p.product_inventory_sku, p.product_status, p.name_th, p.name_en, p.category_id, p.category_name_th, p.category_path,
  p.brand_code, p.brand_name, p.selling_price, p.original_price, p.product_inventory_quantity, p.low_stock_threshold, p.moq,
  p.selling_unit, p.order_taking_unit, p.pack_size, p.order_taking_flag, p.sup_code, p.storage_temperature, p.country_code_source, p.erp_pending_source, p.erp_pending_at,
  p.updated_at, p.image_count, p.image_url`;
/** The detail's content fields (DETAIL_COLUMNS) — commerce has them only where it owns content. */
const CONTENT_KEYS = ['ingredients', 'allergens', 'expiration_info', 'usage_direction', 'best_paired_food', 'maximum_shelf_life', 'is_organic',
  'product_short_code', 'buying_price', 'reorder_quantity'];

/**
 * josh's product catalog, READ-ONLY, from josh's replica (headless plan step 3 starts here: commerce
 * shows the catalog before it owns it). Field names are josh's columns. Editing, approving ERP
 * changes and images stay in josh admin until product ownership moves.
 */
@Injectable()
export class JoshProducts {
  constructor(private readonly replica: JoshReplica, private readonly db: DataSource) {}

  get available() { return productsSource() === 'copies' || this.replica.configured; }

  /** Counts for the issue tiles: one scan of product_inventory. */
  async summary() {
    if (productsSource() === 'copies') return this.summaryFromCopies();
    const issues = Object.entries(PRODUCT_ISSUES).map(([k, cond]) => `count(*) FILTER (WHERE ${cond})::int AS ${k}`).join(', ');
    const [[row], byStatus] = await Promise.all([
      this.replica.query(`SELECT count(*)::int AS total, ${issues} FROM product_inventory p`),
      this.replica.query(`SELECT product_status AS status, count(*)::int AS n FROM product_inventory GROUP BY 1 ORDER BY 2 DESC`),
    ]);
    return { ...row, byStatus };
  }

  async list(f: ProductFilters, page = 1, limit = 50) {
    if (productsSource() === 'copies') return this.listFromCopies(f, page, limit);
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
    if (productsSource() === 'copies') return this.detailFromCopies(idOrSku);
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
    if (productsSource() === 'copies') {
      return ownsCategories()
        ? this.db.query(`SELECT id, category_name_th, category_name_en, category_path FROM product_categories WHERE is_active IS NOT FALSE ORDER BY category_path NULLS LAST, category_name_th`)
        // Not owned: the categories the copied products use (josh's empty categories are not in the copy).
        : this.db.query(`SELECT DISTINCT category_id AS id, category_name_th, category_name_en, category_path FROM josh_catalog_products
            WHERE removed_at IS NULL AND category_id IS NOT NULL ORDER BY category_path NULLS LAST, category_name_th`);
    }
    return this.replica.query(`SELECT id, category_name_th, category_name_en, category_path FROM product_category WHERE is_active IS NOT FALSE ORDER BY category_path NULLS LAST, category_name_th`);
  }

  /** `missing_report_fields` = copied products not yet re-sent with the S5-11 fields (backfill `catalog` until 0). */
  private async summaryFromCopies() {
    const issues = Object.entries(COPIES.issues).map(([k, cond]) => `count(*) FILTER (WHERE ${cond})::int AS ${k}`).join(', ');
    const [[row], byStatus] = await Promise.all([
      this.db.query(`SELECT count(*)::int AS total, ${issues}, count(*) FILTER (WHERE p.image_count IS NULL)::int AS missing_report_fields FROM ${copyFrom()}`),
      this.db.query(`SELECT product_status AS status, count(*)::int AS n FROM ${copyFrom()} GROUP BY 1 ORDER BY 2 DESC`),
    ]);
    return { ...row, byStatus };
  }

  private async listFromCopies(f: ProductFilters, page: number, limit: number) {
    const { where, params } = productWhere(f, COPIES);
    const n = params.length;
    const from = copyFrom();
    const [items, [{ total }]] = await Promise.all([
      this.db.query(`SELECT ${COPY_COLUMNS} FROM ${from} ${where}
        ORDER BY p.erp_pending_at DESC NULLS LAST, p.updated_at DESC, p.product_inventory_sku LIMIT $${n + 1} OFFSET $${n + 2}`, [...params, limit, (page - 1) * limit]),
      this.db.query(`SELECT count(*)::int AS total FROM ${from} ${where}`, params),
    ]);
    return { items, total, page, limit };
  }

  /**
   * The replica's detail shape from the copy. pendingChanges: commerce's own approval queues when it owns prices / the
   * ERP master (josh's erp_pending_payload is not copied). media: commerce's gallery when owned, else the first image only.
   */
  private async detailFromCopies(idOrSku: string) {
    const bySku = !/^[0-9a-f-]{36}$/i.test(idOrSku);
    const [row] = await this.db.query(`SELECT ${COPY_COLUMNS}, p.vat_type, p.description_th, p.description_en FROM ${copyFrom()}
      WHERE ${bySku ? 'p.product_inventory_sku = $1' : 'p.product_inventory_id = $1'} LIMIT 1`, [idOrSku.trim().slice(0, 100)]);
    if (!row) throw new NotFoundException(`product ${idOrSku} not found in commerce's copy of josh`);
    const sku = row.product_inventory_sku as string;
    const one = async (sql: string) => ((await this.db.query(sql, [sku])) as Record<string, unknown>[])[0];
    const [content, gallery, pricePending, masterPending] = await Promise.all([
      ownsProductContent() ? one(`SELECT fields FROM product_contents WHERE product_inventory_sku = $1`) : undefined,
      ownsProductImages() ? one(`SELECT images FROM product_images WHERE product_inventory_sku = $1`) : undefined,
      ownsPrices() ? one(`SELECT ordering_price::float AS selling_price, moq FROM product_price_pending WHERE product_inventory_sku = $1`) : undefined,
      ownsProductMaster() ? one(`SELECT patch FROM product_master_pending WHERE product_inventory_sku = $1`) : undefined,
    ]);
    const fields = (content?.fields ?? {}) as Record<string, unknown>;
    const detail = Object.fromEntries(CONTENT_KEYS.map((k) => [k, fields[k] ?? null]));
    const images = gallery ? (gallery.images as string[]) : row.image_url ? [row.image_url as string] : [];
    const media = images.map((source, i) => ({ id: null, source, media_type: 'image', sort_order: i }));
    const pending: Record<string, unknown> = { ...((masterPending?.patch ?? {}) as Record<string, unknown>),
      ...Object.fromEntries(Object.entries(pricePending ?? {}).filter(([, v]) => v != null)) };
    const pendingChanges = Object.entries(pending).map(([column, next]) => {
      const known = column in row;
      const current = known ? row[column] : undefined;
      return { field: column, column: known ? column : null, current: current ?? null, pending: next, changed: known ? String(current ?? '') !== String(next ?? '') : null };
    });
    const notCopied = [...(content ? [] : ['content fields (ingredients … reorder_quantity)']), ...(gallery ? [] : ['media (all images)']),
      ...(ownsPrices() || ownsProductMaster() ? [] : ['erp_pending_payload'])];
    return { ...row, erp_pending_payload: null, created_at: null, ...detail, media, pendingChanges, notCopied };
  }
}
