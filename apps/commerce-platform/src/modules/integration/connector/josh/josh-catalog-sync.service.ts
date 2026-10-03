import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource, Repository } from 'typeorm';
import { cronConfig } from '../../../../config/cron.config';
import { JoshCatalogProduct } from './josh-catalog-product.entity';

const SELECT = `SELECT p.product_inventory_id AS id, p.product_inventory_sku AS sku, p.product_status AS status,
  p.brand_code, p.brand_name, p.country_code_source, p.storage_temperature, p.packaging_type, p.pack_size,
  p.units_per_box, p.weight_per_unit, p.selling_unit, p.vat_type, p.selling_unit_price, p.updated_at,
  COALESCE((SELECT json_agg(json_build_object('language_code', t.language_code, 'product_name', t.product_name,
    'product_description', t.product_description, 'product_detail', t.product_detail) ORDER BY t.language_code)
    FROM product_translation t WHERE t.product_inventory_id = p.product_inventory_id), '[]'::json) AS translations
  FROM product_inventory p`;

const COLUMNS = ['sku', 'status', 'brand_code', 'brand_name', 'country_code_source', 'storage_temperature', 'packaging_type',
  'pack_size', 'units_per_box', 'weight_per_unit', 'selling_unit', 'vat_type', 'selling_unit_price', 'translations'];

// Only rows that actually changed are rewritten (product fields bump josh's updated_at; translations are compared).
const UPSERT = `INSERT INTO josh_catalog_products (id, ${COLUMNS.join(', ')}, josh_updated_at, removed_at, synced_at)
  SELECT r.id, ${COLUMNS.map((c) => `r.${c}`).join(', ')}, r.updated_at, NULL, now()
  FROM jsonb_to_recordset($1::jsonb) AS r(id uuid, sku varchar, status varchar, brand_code varchar, brand_name varchar,
    country_code_source varchar, storage_temperature varchar, packaging_type varchar, pack_size varchar, units_per_box varchar,
    weight_per_unit varchar, selling_unit varchar, vat_type varchar, selling_unit_price numeric, translations jsonb, updated_at timestamptz)
  ON CONFLICT (id) DO UPDATE SET ${COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
    josh_updated_at = EXCLUDED.josh_updated_at, removed_at = NULL, synced_at = now()
  WHERE josh_catalog_products.josh_updated_at IS DISTINCT FROM EXCLUDED.josh_updated_at
    OR josh_catalog_products.translations IS DISTINCT FROM EXCLUDED.translations
    OR josh_catalog_products.removed_at IS NOT NULL`;

/**
 * Pulls josh's catalog into commerce (step 1 of "commerce as the product hub").
 * Reads josh with one SELECT per run — point JOSH_DATABASE_URL at the read
 * replica / a read-only user so josh's primary never sees this load. No josh
 * code is involved: every way josh writes a product (admin, ERP, MER approve)
 * shows up here. josh down → the last copy stays and the next run catches up.
 */
@Injectable()
export class JoshCatalogSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(JoshCatalogSyncService.name);
  private josh: DataSource | null = null;
  private running = false;

  constructor(@InjectRepository(JoshCatalogProduct) private readonly products: Repository<JoshCatalogProduct>) {}

  get configured() { return !!process.env.JOSH_DATABASE_URL?.trim(); }

  private async source() {
    if (!this.josh) {
      const josh = new DataSource({ type: 'postgres', url: process.env.JOSH_DATABASE_URL, entities: [],
        applicationName: 'commerce-josh-catalog-sync', extra: { max: 1, statement_timeout: 60_000, connectionTimeoutMillis: 5_000 } });
      await josh.initialize();
      this.josh = josh;
    }
    return this.josh;
  }

  private async upsert(rows: Record<string, unknown>[]) {
    // ponytail: 1000 rows per statement; ~6k products today = 6 statements per run.
    for (let i = 0; i < rows.length; i += 1000) await this.products.query(UPSERT, [JSON.stringify(rows.slice(i, i + 1000))]);
  }

  /** Full pull. Returns how many josh products were seen. */
  async syncAll(): Promise<number> {
    const rows: Record<string, unknown>[] = await (await this.source()).query(SELECT);
    // An empty result is far likelier a wrong database than an empty catalog — never mark everything removed.
    if (!rows.length) throw new Error('josh returned no products — check JOSH_DATABASE_URL');
    await this.upsert(rows);
    await this.products.query(`UPDATE josh_catalog_products SET removed_at = now() WHERE removed_at IS NULL AND NOT (id = ANY($1::uuid[]))`,
      [rows.map((r) => r.id)]);
    return rows.length;
  }

  /** Pull one SKU now (MER typed a SKU that was added after the last run). Null if josh has no such SKU. */
  async syncSku(sku: string): Promise<JoshCatalogProduct | null> {
    const rows: Record<string, unknown>[] = await (await this.source()).query(`${SELECT} WHERE p.product_inventory_sku = $1`, [sku]);
    if (!rows.length) return null;
    await this.upsert(rows);
    return this.products.findOneBy({ id: rows[0].id as string });
  }

  @Cron(cronConfig.joshCatalogSync.expression, { timeZone: cronConfig.joshCatalogSync.timeZone, disabled: !cronConfig.joshCatalogSync.enabled })
  async scheduled() {
    if (this.running || !this.configured) return;
    this.running = true;
    try {
      this.logger.log(`josh catalog synced: ${await this.syncAll()} products`);
    } catch (error) {
      this.logger.warn(`josh catalog sync failed, keeping the last copy: ${error instanceof Error ? error.message : error}`);
      await this.josh?.destroy().catch(() => undefined);
      this.josh = null;
    } finally { this.running = false; }
  }

  async onModuleDestroy() { await this.josh?.destroy().catch(() => undefined); }
}
