import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CatalogProduct, CatalogRow, toCatalogProduct } from './app-gaps.helpers';

/**
 * Josh's product catalog for the app (products presented at a visit, quote lines). Commerce reads its copy
 * `josh_catalog_products` (josh `catalog.snapshot` events) — never josh's replica. josh's WinbackCatalogService
 * reads josh's own product tables and returns the same rows.
 */
@Injectable()
export class WinbackCatalogService {
  constructor(private readonly db: DataSource) {}

  async listProducts(opts: { search?: string; ids?: string[]; limit?: number }): Promise<CatalogProduct[]> {
    const params: unknown[] = [];
    const where = [`p.removed_at IS NULL`, `COALESCE(p.status, 'active') = 'active'`];
    if (opts.ids) {
      if (!opts.ids.length) return [];
      params.push(opts.ids);
      where.push(`p.id::text = ANY($${params.length}::text[])`);
    }
    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where.push(`(p.sku ILIKE $${params.length} OR p.translations::text ILIKE $${params.length})`);
    }
    params.push(Math.min(Math.max(opts.limit ?? 500, 1), 1000));
    const rows: CatalogRow[] = await this.db.query(
      `SELECT p.id::text AS id, p.sku,
              (SELECT t->>'product_name' FROM jsonb_array_elements(p.translations) t WHERE t->>'language_code' = 'th' LIMIT 1) AS name_th,
              (SELECT t->>'product_name' FROM jsonb_array_elements(p.translations) t WHERE t->>'language_code' = 'en' LIMIT 1) AS name_en,
              p.brand_name, p.category_name_th AS category_name, p.selling_unit, p.order_taking_unit, NULL::varchar AS sub_packing_unit,
              p.pack_size, p.units_per_box, p.weight_per_unit, p.ordering_price AS selling_price, p.image_url
         FROM josh_catalog_products p
        WHERE ${where.join(' AND ')}
        ORDER BY p.sku
        LIMIT $${params.length}`,
      params,
    );
    return rows.map(toCatalogProduct);
  }
}
