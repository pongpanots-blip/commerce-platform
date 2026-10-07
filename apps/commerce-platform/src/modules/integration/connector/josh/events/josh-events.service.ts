import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JoshOrderCopy, JoshOrderLineCopy } from '../orders/josh-order-copy.entity';
import { Row, toHead, toLine } from '../orders/josh-order-copy';
import { JoshCatalogProduct } from '../josh-catalog-product.entity';
import { JoshCustomerCopy } from './josh-customer-copy.entity';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface JoshEnvelope { type: string; aggregateId: string; version: string; occurredAt: string; data: any }
export type ApplyResult = 'applied' | 'stale';

/**
 * Applies josh → commerce events (spec 2026-10-06 §2.2–2.3). A snapshot wins only when its version
 * (josh commerce_snapshot_seq) is newer than the stored one; an advisory lock per aggregate makes the
 * check-then-write safe for two concurrent deliveries of a brand-new aggregate.
 */
@Injectable()
export class JoshEventsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

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
        throw new BadRequestException(`unsupported josh event ${e.type}`);
    }
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
