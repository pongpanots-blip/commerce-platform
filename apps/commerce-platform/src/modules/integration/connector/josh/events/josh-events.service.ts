import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JoshOrderCopy, JoshOrderLineCopy } from '../orders/josh-order-copy.entity';
import { Row, toHead, toLine } from '../orders/josh-order-copy';
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
        return this.guarded('josh_customers', 'id', e, (m) =>
          m.getRepository(JoshCustomerCopy).save({ id: e.aggregateId, data: {}, sourceVersion: e.version, deletedAt: new Date() }));
      case 'erp.fallback.received':
        return this.saveFallback(e);
      default:
        throw new BadRequestException(`unsupported josh event ${e.type}`);
    }
  }

  private guarded(table: 'josh_orders' | 'josh_customers', pk: string, e: JoshEnvelope, write: (m: EntityManager) => Promise<unknown>): Promise<ApplyResult> {
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
