import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { cronConfig } from '../../../../../config/cron.config';
import { paidOrderSql } from '../josh-insights';
import { JoshReplica } from '../josh-replica';
import { JoshOrderCopy, JoshOrderLineCopy } from './josh-order-copy.entity';

const BATCH = 500;
/** Statuses an order can still leave — re-read until it settles. */
const OPEN = ['payment_pending', 'paid', 'preparing', 'shipped'];
const REFRESH_DAYS = 7;

const HEAD = `o.orders_id::text AS orders_id, o.order_number, o.status::text AS status, o.payment_type, ${paidOrderSql('o')} AS paid, o.fulfillment_type,
  o.user_id::text AS user_id, o.company_id::text AS company_id, o.branch_id::text AS branch_id, o.customer_code, o.checkout_batch_id::text AS checkout_batch_id,
  o.total_price, o.subtotal_ex_vat, o.vat_amount, o.delivery_fee, o.discount_amount, o.discount_inc_vat, o.product_discount_ex_vat, o.gross_ex_vat,
  o.delivery_date::text AS delivery_date, o.po_number, o.document_no, o.remark, o.create_date, o.end_date`;

export type Row = Record<string, unknown>;
export const toHead = (r: Row): Partial<JoshOrderCopy> => ({
  ordersId: r.orders_id as string, orderNumber: r.order_number as string, status: r.status as string, paymentType: r.payment_type as string, paid: !!r.paid,
  fulfillmentType: r.fulfillment_type as string, userId: r.user_id as string, companyId: r.company_id as string, branchId: r.branch_id as string,
  customerCode: r.customer_code as string, checkoutBatchId: r.checkout_batch_id as string, totalPrice: r.total_price as string, subtotalExVat: r.subtotal_ex_vat as string,
  vatAmount: r.vat_amount as string, deliveryFee: r.delivery_fee as string, discountAmount: r.discount_amount as string, discountIncVat: r.discount_inc_vat as string,
  productDiscountExVat: r.product_discount_ex_vat as string, grossExVat: r.gross_ex_vat as string, deliveryDate: r.delivery_date as string, poNumber: r.po_number as string,
  documentNo: r.document_no as string, remark: r.remark as string, createDate: r.create_date as Date, endDate: r.end_date as Date, copiedAt: new Date(),
});
export const toLine = (r: Row): Partial<JoshOrderLineCopy> => ({
  id: r.id as string, ordersId: r.order_id as string, productInventoryId: r.product_inventory_id as string, sku: r.sku as string, productPrice: r.product_price as string,
  productQuantity: Number(r.product_quantity), status: r.status as string, fulfillmentType: r.fulfillment_type as string, priceSource: r.price_source as string,
  promotionMechanicId: r.promotion_mechanic_id as string, unitListPriceIncVat: r.unit_list_price_inc_vat as string, lineRevenue: r.line_revenue as string, shipmentId: r.shipment_id as string,
});

/**
 * Checkout step 2: commerce keeps its own copy of every josh order (josh_orders / josh_order_lines).
 * Each run: new orders after the newest copied one (backfills everything, BATCH at a time) and
 * orders that can still change (open statuses, or the last REFRESH_DAYS days) — josh orders have
 * no updated_at. `copyOne` is the instant path josh calls after checkout. Reads josh only; josh's
 * checkout never waits for commerce.
 */
@Injectable()
export class JoshOrderCopyService {
  private readonly logger = new Logger(JoshOrderCopyService.name);
  private running = false;

  constructor(
    private readonly replica: JoshReplica,
    @InjectRepository(JoshOrderCopy) private readonly orders: Repository<JoshOrderCopy>,
    @InjectRepository(JoshOrderLineCopy) private readonly lines: Repository<JoshOrderLineCopy>,
  ) {}

  get available() { return this.replica.configured; }

  @Cron(cronConfig.joshOrderCopy.expression, { timeZone: cronConfig.joshOrderCopy.timeZone, disabled: !cronConfig.joshOrderCopy.enabled })
  async tick() {
    if (!this.available || this.running) return; // ponytail: in-process guard; one commerce instance runs this cron
    this.running = true;
    try {
      const r = await this.copyNew();
      if (r.added || r.refreshed) this.logger.log(`josh orders: +${r.added} new, ${r.refreshed} refreshed`);
    } catch (error) {
      this.logger.warn(`josh order copy failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }

  private async save(heads: Row[]) {
    if (!heads.length) return;
    const ids = heads.map((h) => h.orders_id as string);
    const items = await this.replica.query<Row>(`SELECT oi.id::text AS id, oi.order_id::text AS order_id, oi.product_inventory_id::text AS product_inventory_id,
        pi.product_inventory_sku AS sku, oi.product_price, oi.product_quantity, oi.status::text AS status, oi.fulfillment_type, oi.price_source,
        oi.promotion_mechanic_id::text AS promotion_mechanic_id, oi.unit_list_price_inc_vat, oi.line_revenue, oi.shipment_id::text AS shipment_id
      FROM order_items oi LEFT JOIN product_inventory pi ON pi.product_inventory_id = oi.product_inventory_id WHERE oi.order_id = ANY($1::uuid[])`, [ids]);
    await this.orders.manager.transaction(async (m) => {
      for (let i = 0; i < heads.length; i += 500) await m.getRepository(JoshOrderCopy).upsert(heads.slice(i, i + 500).map(toHead), ['ordersId']);
      // Lines are replaced per order: josh can remove or split lines after checkout (claims, shipments).
      await m.getRepository(JoshOrderLineCopy).delete({ ordersId: In(ids) });
      for (let i = 0; i < items.length; i += 500) await m.getRepository(JoshOrderLineCopy).insert(items.slice(i, i + 500).map(toLine));
    });
  }

  async copyNew(limit = BATCH) {
    const [{ newest }] = await this.orders.query(`SELECT max(create_date) AS newest FROM josh_orders`);
    const fresh = await this.replica.query<Row>(`SELECT ${HEAD} FROM orders o ${newest ? 'WHERE o.create_date >= $1' : ''} ORDER BY o.create_date LIMIT ${newest ? '$2' : '$1'}`,
      newest ? [newest, limit] : [limit]);
    const known = new Set(fresh.length ? (await this.orders.find({ where: { ordersId: In(fresh.map((r) => r.orders_id as string)) }, select: ['ordersId'] })).map((o) => o.ordersId) : []);
    const open = newest ? await this.replica.query<Row>(`SELECT ${HEAD} FROM orders o
        WHERE o.status::text = ANY($1) OR o.create_date >= now() - make_interval(days => $2)`, [OPEN, REFRESH_DAYS]) : [];
    const all = [...new Map([...open, ...fresh].map((r) => [r.orders_id as string, r])).values()];
    for (let i = 0; i < all.length; i += BATCH) await this.save(all.slice(i, i + BATCH));
    return { added: fresh.filter((r) => !known.has(r.orders_id as string)).length, refreshed: open.length };
  }

  /** One order now (josh just placed it). The replica may lag a moment behind josh: retry briefly. */
  async copyOne(ordersId: string, tries = 3): Promise<boolean> {
    for (let i = 0; i < tries; i++) {
      const rows = await this.replica.query<Row>(`SELECT ${HEAD} FROM orders o WHERE o.orders_id = $1`, [ordersId]);
      if (rows.length) { await this.save(rows); return true; }
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
    return false;
  }

  async summary() {
    const [row] = await this.orders.query(`SELECT count(*)::int AS orders, max(create_date) AS newest, max(copied_at) AS last_copied,
        count(*) FILTER (WHERE create_date >= now() - interval '1 day')::int AS last_day FROM josh_orders`);
    return row;
  }
}
