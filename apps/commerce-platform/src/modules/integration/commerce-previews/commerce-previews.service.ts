import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JoshReplica } from '../connector/josh/josh-replica';
import { paidOrderSql } from '../connector/josh/josh-insights';
import { OrderReviewInput, OrderSnapshot, reviewOrder, StockDeductionEvidence, SyncEvidence } from './order-review';
import { rehearsePromotion } from './promotion-rehearsal';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 100;
const iso = (v: unknown): string => v instanceof Date ? v.toISOString() : String(v ?? '');
type Row = Record<string, unknown>;
const version = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v) && v !== '0' ? v : null;
const text = (v: unknown) => v == null ? null : String(v);

/** Explicit internal readers only. No URL, table name, SQL fragment, credentials or retry operation is accepted from callers. */
@Injectable()
export class CommercePreviewsService {
  constructor(@InjectDataSource() private readonly db: DataSource, private readonly replica: JoshReplica) {}

  promotion(raw: unknown) { return rehearsePromotion(raw); }

  async order(orderId: string, policy: OrderReviewInput['policy'], clock: () => Date = () => new Date()) {
    if (!UUID.test(orderId)) throw new BadRequestException('orderId must be a UUID');
    orderId = orderId.toLowerCase();
    // Validate context before any source reads. Empty sources remain an incomplete result, not a fake success.
    reviewOrder({ orderId, at: clock().toISOString(), policy, josh: null, commerce: null, sync: null, stockDeductions: null });
    const unavailableSources: string[] = [];
    const truncatedSources: string[] = [];
    const captures: Record<string, string> = {};
    const read = async (name: string, query: () => Promise<Row[]>) => {
      try { const rows = await query(); captures[name] = clock().toISOString(); return rows; }
      catch { unavailableSources.push(name); return null; } // No exception bodies, SQL or credentials in the public response.
    };
    // Fixed projections exclude customer PII and gateway/request payloads. Queries are parameterized and read-only.
    const joshRows = this.replica.configured ? await read('josh', () => this.replica.query<Row>(
      `SELECT o.orders_id::text AS id, o.order_number, o.status::text AS status, o.total_price::text AS total,
        ${paidOrderSql('o')} AS paid, o.create_date, o.commerce_snapshot_seq::text AS version
       FROM orders o WHERE o.orders_id = $1`, [orderId])) : null;
    if (!this.replica.configured) unavailableSources.push('josh');
    const commerceRows = await read('commerce', () => this.db.query(
      `SELECT orders_id::text AS id, order_number, status, total_price::text AS total, paid, create_date,
        source_version::text AS version, copied_at FROM josh_orders WHERE orders_id = $1`, [orderId]));
    const syncRows = await read('sync', () => this.db.query(
      `SELECT id::text AS id, order_id::text AS order_id, shipment_id::text AS shipment_id, source_version::text AS version,
        sync_status, doc_no, created_at, imported_at FROM jagota_order_sync_history WHERE order_id = $1 ORDER BY created_at DESC, id LIMIT $2`, [orderId, LIMIT + 1]));
    const stockRows = await read('stock', () => this.db.query(
      `SELECT l.id::text AS line_id, l.sku, l.product_quantity AS ordered, m.quantity::text AS deducted, m.state, m.updated_at
       FROM josh_order_lines l LEFT JOIN josh_order_stock_moves m ON m.order_line_id = l.id AND m.orders_id = l.orders_id
       WHERE l.orders_id = $1 ORDER BY l.id LIMIT $2`, [orderId, LIMIT + 1]));
    const snapshot = (rows: Row[] | null, source: OrderSnapshot['source']): OrderSnapshot | null => {
      if (!rows?.length) return null;
      if (rows.length > 1) unavailableSources.push(source); // A stable ID must resolve once.
      const r = rows[0];
      return { source, id: String(r.id), version: version(r.version), capturedAt: captures[source], createdAt: iso(r.create_date), changedAt: null,
        storedAt: source === 'commerce' && r.copied_at != null ? iso(r.copied_at) : null,
        values: { orderNumber: text(r.order_number), status: String(r.status ?? ''), totalIncVat: text(r.total), paid: typeof r.paid === 'boolean' ? r.paid : null } };
    };
    const sync: SyncEvidence[] | null = syncRows?.slice(0, LIMIT).map(r => ({ id: String(r.id), orderId: String(r.order_id),
      shipmentId: text(r.shipment_id), version: version(r.version), capturedAt: captures.sync, importedAt: r.imported_at == null ? null : iso(r.imported_at),
      createdAt: iso(r.created_at), status: String(r.sync_status), docNo: text(r.doc_no) })) ?? null;
    const stockDeductions: StockDeductionEvidence[] | null = stockRows?.slice(0, LIMIT).map(r => ({ lineId: String(r.line_id), orderId,
      sku: text(r.sku), ordered: Number(r.ordered), deducted: r.deducted == null ? NaN : Number(r.deducted), state: String(r.state ?? 'none'),
      capturedAt: captures.stock, updatedAt: iso(r.updated_at) })) ?? null;
    if ((syncRows?.length ?? 0) > LIMIT) truncatedSources.push('sync');
    if ((stockRows?.length ?? 0) > LIMIT) truncatedSources.push('stock');
    const result = reviewOrder({ orderId, at: clock().toISOString(), policy, josh: snapshot(joshRows, 'josh'), commerce: snapshot(commerceRows, 'commerce'),
      sync, stockDeductions, unavailableSources, truncatedSources });
    return { ...result, integrationLimits: [
      'Snapshot sequence is compared only within the same Josh order aggregate; version 0/absent is unversioned.',
      'These order schemas do not provide source change time; a lag cannot be declared inside grace from read time.',
      'Pending-sync age threshold is caller-selected review policy, not proof of an SLA breach.',
      'Reading a sync copy now does not renew imported_at; stale or unknown import time makes risk coverage partial.',
      'Stock findings inspect recorded Commerce deductions, not a live availability or repack forecast.',
      'No shipping milestone deadlines are inferred. Paid/delivery milestones require additional authoritative fields.',
    ] };
  }
}
