import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JoshOrderCopy, JoshOrderLineCopy } from '../orders/josh-order-copy.entity';
import { Row, toHead, toLine } from '../orders/josh-order-copy';
import { JoshCatalogProduct } from '../josh-catalog-product.entity';
import { JoshCustomerCopy } from './josh-customer-copy.entity';
import { OrderStockService } from '../../../../commerce/inventory/application/order-stock.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface JoshEnvelope { type: string; aggregateId: string; version: string; occurredAt: string; data: any }
export type ApplyResult = 'applied' | 'stale';

/** josh group → commerce copy table (stage 2c; columns named as in josh). */
const REFERENCE_TABLES = { company: 'josh_companies', cuisine: 'josh_cuisines', restaurant_place: 'josh_restaurant_places', staff: 'josh_staff' } as const;

/**
 * Applies josh → commerce events (spec 2026-10-06 §2.2–2.3). A snapshot wins only when its version
 * (josh commerce_snapshot_seq) is newer than the stored one; an advisory lock per aggregate makes the
 * check-then-write safe for two concurrent deliveries of a brand-new aggregate.
 */
@Injectable()
export class JoshEventsService {
  private readonly columns = new Map<string, string[]>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    /** Stage 3: orders deduct the commerce-owned warehouse (STOCK_ORDER_WAREHOUSE_CODE). */
    @Optional() private readonly orderStock?: OrderStockService,
  ) {}

  async apply(e: JoshEnvelope): Promise<ApplyResult> {
    if (!e?.aggregateId || !/^\d+$/.test(String(e.version ?? ''))) throw new BadRequestException('aggregateId and numeric version required');
    switch (e.type) {
      case 'order.snapshot':
        return this.guarded('josh_orders', 'orders_id', e, (m) => this.saveOrder(m, e));
      case 'customer.snapshot':
        return this.guarded('josh_customers', 'id', e, (m) =>
          m.getRepository(JoshCustomerCopy).save({ id: e.aggregateId, data: e.data ?? {}, sourceVersion: e.version, deletedAt: null }));
      case 'customer.deleted':
        // PDPA: wipe the copy (tombstone blocks older snapshots) and everything commerce derived from it.
        // Segment member_count stays as frozen, like josh (its snapshot rows cascade, the count doesn't change).
        return this.guarded('josh_customers', 'id', e, async (m) => {
          await m.getRepository(JoshCustomerCopy).save({ id: e.aggregateId, data: {}, sourceVersion: e.version, deletedAt: new Date() });
          await m.query('DELETE FROM customer_metrics WHERE user_id = $1', [e.aggregateId]);
          await m.query('DELETE FROM segment_members WHERE user_id = $1', [e.aggregateId]);
          // The deleted customer's winback account loses its user link; it reaches josh through the mirror once
          // commerce owns winback.
          await m.query('UPDATE winback_account SET josh_user_id = NULL WHERE josh_user_id = $1', [e.aggregateId]);
        });
      case 'catalog.snapshot':
        return this.guarded('josh_catalog_products', 'id', e, (m) => this.saveCatalog(m, e));
      case 'catalog.deleted':
        // Rows stay: competitor pairs keep their history; removed products drop out of matching.
        return this.guarded('josh_catalog_products', 'id', e, (m) =>
          m.query(`UPDATE josh_catalog_products SET removed_at = now(), source_version = $2 WHERE id = $1`, [e.aggregateId, e.version]));
      case 'erp.fallback.received':
        return this.saveFallback(e);
      default:
        return this.applyReference(e);
    }
  }

  /** Stage 2c: `<group>.snapshot` / `<group>.deleted` for the reference rows winback reads (no josh replica). */
  private applyReference(e: JoshEnvelope): Promise<ApplyResult> {
    const [group, kind] = e.type.split('.');
    const table = REFERENCE_TABLES[group as keyof typeof REFERENCE_TABLES];
    if (table && kind === 'snapshot') return this.reference(table, e, (m) => this.saveReference(m, table, e));
    if (table && kind === 'deleted') {
      return this.reference(table, e, async (m) => {
        await m.query(`DELETE FROM ${table} WHERE id = $1`, [e.aggregateId]);
        await m.query(`INSERT INTO josh_reference_tombstones (tbl, id, source_version) VALUES ($1, $2, $3)
          ON CONFLICT (tbl, id) DO UPDATE SET source_version = EXCLUDED.source_version`, [table, e.aggregateId, e.version]);
        // A deleted staff member is nobody's sales rep any more.
        if (group === 'staff') {
          await m.query('UPDATE company_sales_reps SET assigned_sales_user_id = NULL, updated_at = now() WHERE assigned_sales_user_id = $1', [e.aggregateId]);
          // stage 6: nothing left for commerce to decide about an account josh deleted
          await m.query('DELETE FROM josh_staff_access WHERE id = $1', [e.aggregateId]);
        }
      });
    }
    throw new BadRequestException(`unsupported josh event ${e.type}`);
  }

  /** guarded() for reference copies: an event is also stale against the tombstone of a deleted row. */
  private reference(table: string, e: JoshEnvelope, write: (m: EntityManager) => Promise<unknown>): Promise<ApplyResult> {
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${table}:${e.aggregateId}`]);
      const [row] = await m.query(
        `SELECT GREATEST((SELECT source_version FROM ${table} WHERE id = $1),
                         (SELECT source_version FROM josh_reference_tombstones WHERE tbl = $2 AND id = $1))::text AS version`,
        [e.aggregateId, table]);
      if (row?.version != null && BigInt(row.version) >= BigInt(e.version)) return 'stale';
      await write(m);
      return 'applied';
    });
  }

  /** The columns both sides have, as josh sent them (jsonb_populate_record casts), plus the version. */
  private async saveReference(m: EntityManager, table: string, e: JoshEnvelope) {
    if (!e.data || e.data.id !== e.aggregateId) throw new BadRequestException(`${e.type} data.id must equal the aggregate id`);
    let known = this.columns.get(table);
    if (!known) {
      known = (await m.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]))
        .map((r: { column_name: string }) => r.column_name) as string[];
      this.columns.set(table, known);
    }
    const cols = known.filter((c) => c !== 'source_version' && c in e.data);
    const list = cols.map((c) => `"${c}"`).join(', ');
    const set = [...cols.filter((c) => c !== 'id'), 'source_version'].map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
    await m.query(
      `INSERT INTO ${table} (${list}, source_version) SELECT ${list}, $2 FROM jsonb_populate_record(NULL::${table}, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET ${set}`,
      [JSON.stringify(e.data), e.version]);
  }

  private guarded(table: 'josh_orders' | 'josh_customers' | 'josh_catalog_products', pk: string, e: JoshEnvelope, write: (m: EntityManager) => Promise<unknown>): Promise<ApplyResult> {
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${table}:${e.aggregateId}`]);
      const [row] = await m.query(`SELECT source_version FROM ${table} WHERE ${pk} = $1`, [e.aggregateId]);
      if (row && BigInt(row.source_version) >= BigInt(e.version)) return 'stale';
      await write(m);
      return 'applied';
    });
  }

  private async saveOrder(m: EntityManager, e: JoshEnvelope) {
    const head = e.data?.order as Row | undefined;
    const items = (e.data?.items ?? []) as Row[];
    if (!head || head.orders_id !== e.aggregateId) throw new BadRequestException('order.snapshot needs data.order with the aggregate id');
    await m.getRepository(JoshOrderCopy).upsert([{ ...toHead(head), sourceVersion: e.version }], ['ordersId']);
    // Lines are replaced per order: josh can remove or split lines after checkout (claims, shipments).
    await m.getRepository(JoshOrderLineCopy).delete({ ordersId: e.aggregateId });
    if (items.length) await m.getRepository(JoshOrderLineCopy).insert(items.map(toLine));
    await this.orderStock?.apply(m, { orders_id: e.aggregateId, status: (head.status as string | null) ?? null },
      items.map((i) => ({ id: String(i.id), sku: (i.sku as string | null) ?? null, product_quantity: i.product_quantity as number })));
  }

  /** Raw values exactly as josh stores them (numeric as string): catalogFingerprint must match josh's. */
  private async saveCatalog(m: EntityManager, e: JoshEnvelope) {
    const d = e.data ?? {};
    if (d.id !== e.aggregateId) throw new BadRequestException('catalog.snapshot data.id must equal the aggregate id');
    await m.getRepository(JoshCatalogProduct).upsert([{
      id: d.id, sku: d.sku, status: d.status ?? null, brandCode: d.brand_code ?? null, brandName: d.brand_name ?? null,
      countryCodeSource: d.country_code_source ?? null, storageTemperature: d.storage_temperature ?? null,
      packagingType: d.packaging_type ?? null, packSize: d.pack_size ?? null, unitsPerBox: d.units_per_box ?? null,
      weightPerUnit: d.weight_per_unit ?? null, sellingUnit: d.selling_unit ?? null, vatType: d.vat_type ?? null,
      sellingUnitPrice: d.selling_unit_price ?? null, orderingPrice: d.ordering_price ?? null, orderTakingUnit: d.order_taking_unit ?? null,
      categoryNameTh: d.category_name_th ?? null, categoryNameEn: d.category_name_en ?? null, imageUrl: d.image_url ?? null,
      translations: d.translations ?? [], joshUpdatedAt: new Date(d.updated_at), removedAt: null, syncedAt: new Date(),
      sourceVersion: e.version,
    }], ['id']);
  }

  private async saveFallback(e: JoshEnvelope): Promise<ApplyResult> {
    const d = e.data ?? {};
    await this.db.transaction((m) =>
      m.query(
        `INSERT INTO josh_erp_fallback_calls (josh_outbox_id, method, path, body, received_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (josh_outbox_id) DO NOTHING`,
        [e.version, String(d.method ?? ''), String(d.path ?? ''), JSON.stringify(d.body ?? null), d.receivedAt ?? e.occurredAt],
      ));
    return 'applied';
  }
}
