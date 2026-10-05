import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { cronConfig } from '../../../../../config/cron.config';
import { JoshReplica } from '../josh-replica';
import { buildErpCreateOrderRequest, diffErpRequests, ErpCreateOrderRequest, ErpOrderInput, InventoryRow } from './erp-order-request';
import { JagotaShadowCheck } from './jagota-shadow-check.entity';

const BATCH = 200;
type SyncRow = { id: string; order_id: string | null; shipment_id: string | null; sync_status: string | null; created_at: Date; erp: ErpCreateOrderRequest | null };

/**
 * Shadow mode for "orders reach Jagota through commerce" (step 1 of 3). josh keeps sending
 * to Jagota exactly as today; josh already stores each request it sent in
 * `jagota_order_sync.request_json.erp`. Commerce reads those from josh's replica, rebuilds the
 * same request from josh's data with josh's builder (copied), and records whether they match.
 * Nothing is sent to Jagota and nothing changes in josh.
 */
@Injectable()
export class JagotaShadow {
  private readonly logger = new Logger(JagotaShadow.name);
  private running = false;

  constructor(
    private readonly replica: JoshReplica,
    @InjectRepository(JagotaShadowCheck) private readonly checks: Repository<JagotaShadowCheck>,
  ) {}

  get available() { return this.replica.configured; }

  @Cron(cronConfig.jagotaShadow.expression, { timeZone: cronConfig.jagotaShadow.timeZone, disabled: !cronConfig.jagotaShadow.enabled })
  async tick() {
    if (!this.available || this.running) return; // ponytail: in-process guard; one commerce instance runs this cron
    this.running = true;
    try {
      const n = await this.checkNew();
      if (n) this.logger.log(`checked ${n} josh → Jagota sends`);
    } catch (error) {
      this.logger.warn(`shadow check failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }

  /** Every josh send not checked yet (after the newest checked one; first run: last 24h). */
  async checkNew(limit = BATCH): Promise<number> {
    const [{ since }] = await this.checks.query(`SELECT COALESCE(max(josh_sent_at), now() - interval '24 hours') AS since FROM jagota_shadow_checks`);
    const rows = await this.replica.query<SyncRow>(
      `SELECT id::text AS id, order_id, shipment_id, sync_status, created_at, request_json -> 'erp' AS erp FROM jagota_order_sync
        WHERE request_json ? 'erp' AND created_at >= $1 ORDER BY created_at LIMIT $2`, [since, limit]);
    if (!rows.length) return 0;
    const done = new Set((await this.checks.find({ where: rows.map((r) => ({ joshSyncId: r.id })), select: ['joshSyncId'] })).map((c) => c.joshSyncId));
    let n = 0;
    for (const row of rows.filter((r) => !done.has(r.id))) { await this.checkOne(row); n++; }
    return n;
  }

  /** Re-check one josh send (by its jagota_order_sync id). */
  async recheck(joshSyncId: string) {
    const [row] = await this.replica.query<SyncRow>(
      `SELECT id::text AS id, order_id, shipment_id, sync_status, created_at, request_json -> 'erp' AS erp FROM jagota_order_sync WHERE id::text = $1`, [joshSyncId]);
    if (!row) throw new NotFoundException(`josh jagota_order_sync ${joshSyncId} not found`);
    if (!row.erp) throw new BadRequestException('that sync row has no ERP request (skipped or blocked before sending)');
    await this.checks.delete({ joshSyncId });
    return this.checkOne(row);
  }

  private async checkOne(row: SyncRow): Promise<JagotaShadowCheck> {
    const base = { joshSyncId: row.id, joshOrderId: row.order_id, joshShipmentId: row.shipment_id, joshSyncStatus: row.sync_status,
      joshSentAt: row.created_at, joshRequest: row.erp, orderReference: row.erp?.MAGENTO_ORDER_NO ?? null };
    try {
      const { input, inventory, branchSeq, changedAfterSend } = await this.loadInput(row);
      const commerce = buildErpCreateOrderRequest(input, inventory, branchSeq, new Date(row.created_at));
      const diffs = diffErpRequests(row.erp!, commerce);
      const note = diffs.length && changedAfterSend.length ? `ข้อมูลเปลี่ยนหลังส่ง: ${changedAfterSend.join(', ')}` : null;
      return await this.checks.save(this.checks.create({ ...base, matched: diffs.length === 0, diffs, commerceRequest: commerce, note }));
    } catch (error) {
      return this.checks.save(this.checks.create({ ...base, matched: false, diffs: [], commerceRequest: null,
        note: `commerce สร้าง request ไม่ได้: ${error instanceof Error ? error.message : error}` }));
    }
  }

  /** josh's JagotaOrderSyncInput, from josh's rows: per shipment (shipment number, its lines) or per order (order number, all lines). */
  private async loadInput(row: SyncRow) {
    if (!row.order_id) throw new Error('sync row has no order_id');
    const [order] = await this.replica.query<{ order_number: string; customer_code: string | null; branch_id: string | null; po_number: string | null; remark: string | null; delivery_date: string | null }>(
      `SELECT order_number, customer_code, branch_id, po_number, remark, delivery_date::text AS delivery_date FROM orders WHERE orders_id = $1`, [row.order_id]);
    if (!order) throw new Error(`order ${row.order_id} not found`);
    let input: ErpOrderInput;
    let items: { product_inventory_id: string; quantity: number; unit_price: number }[];
    const ITEM_COLS = `product_inventory_id, product_quantity::float AS quantity, product_price::float AS unit_price`;
    if (row.shipment_id) {
      const [shipment] = await this.replica.query<{ shipment_number: string; delivery_date: string | null }>(
        `SELECT shipment_number, delivery_date::text AS delivery_date FROM shipments WHERE id = $1`, [row.shipment_id]);
      if (!shipment) throw new Error(`shipment ${row.shipment_id} not found`);
      items = await this.replica.query(`SELECT ${ITEM_COLS} FROM order_items WHERE shipment_id = $1`, [row.shipment_id]);
      input = { orderNumber: shipment.shipment_number, parentOrderNumber: order.order_number ?? undefined, customerCode: order.customer_code, deliveryDate: shipment.delivery_date,
        poNumber: order.po_number, remark: order.remark, lineItems: [] };
    } else {
      items = await this.replica.query(`SELECT ${ITEM_COLS} FROM order_items WHERE order_id = $1`, [row.order_id]);
      input = { orderNumber: order.order_number, customerCode: order.customer_code, deliveryDate: order.delivery_date, poNumber: order.po_number, remark: order.remark, lineItems: [] };
    }
    input.lineItems = items.map((i) => ({ productInventoryId: i.product_inventory_id, quantity: i.quantity, unitPrice: i.unit_price }));
    const ids = [...new Set(items.map((i) => i.product_inventory_id))];
    const [inv, [branch]] = await Promise.all([
      ids.length ? this.replica.query<InventoryRow & { updated_at: Date }>(`SELECT product_inventory_id, product_inventory_sku, selling_unit, order_taking_unit, order_taking_flag,
          erp_ordering_units, packaging_type, pack_size, units_per_box, weight_per_unit, updated_at FROM product_inventory WHERE product_inventory_id = ANY($1)`, [ids]) : Promise.resolve([]),
      order.branch_id ? this.replica.query<{ erp_branch_seq: string | null }>(`SELECT erp_branch_seq FROM branch WHERE id = $1`, [order.branch_id]) : Promise.resolve([undefined]),
    ]);
    const sentAt = new Date(row.created_at).getTime();
    return {
      input, branchSeq: branch?.erp_branch_seq ?? null,
      inventory: new Map(inv.map((p) => [p.product_inventory_id, p])),
      changedAfterSend: inv.filter((p) => p.updated_at && new Date(p.updated_at).getTime() > sentAt).map((p) => `สินค้า ${p.product_inventory_sku}`),
    };
  }

  async summary(days = 7) {
    const [row] = await this.checks.query(`SELECT count(*)::int AS checked, count(*) FILTER (WHERE matched)::int AS matched,
        count(*) FILTER (WHERE NOT matched AND commerce_request IS NOT NULL)::int AS mismatched,
        count(*) FILTER (WHERE commerce_request IS NULL)::int AS could_not_build,
        min(josh_sent_at) AS first_at, max(josh_sent_at) AS last_at
      FROM jagota_shadow_checks WHERE josh_sent_at >= now() - make_interval(days => $1)`, [days]);
    const topFields = await this.checks.query(`SELECT regexp_replace(d->>'path', '\\[[^]]*\\]', '[]', 'g') AS field, count(*)::int AS n
        FROM jagota_shadow_checks, jsonb_array_elements(diffs) d WHERE josh_sent_at >= now() - make_interval(days => $1) GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, [days]);
    return { days, ...row, matchRate: row.checked ? Math.round((row.matched / row.checked) * 1000) / 10 : null, topFields };
  }

  list(filter: 'all' | 'mismatched' | 'matched' = 'mismatched', page = 1, limit = 50) {
    const where = filter === 'mismatched' ? { matched: false } : filter === 'matched' ? { matched: true } : {};
    return this.checks.findAndCount({ where, order: { joshSentAt: 'DESC' }, skip: (page - 1) * limit, take: limit,
      select: ['id', 'joshSyncId', 'orderReference', 'joshSyncStatus', 'joshSentAt', 'matched', 'diffs', 'note', 'checkedAt'] })
      .then(([items, total]) => ({ items, total, page, limit }));
  }

  async detail(id: string) {
    const row = await this.checks.findOneBy({ id });
    if (!row) throw new NotFoundException('shadow check not found');
    return row;
  }
}
