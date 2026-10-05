import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { cronConfig } from '../../../../../config/cron.config';
import { JoshReplica } from '../josh-replica';
import { OrderQuoteCheck } from './order-quote-check.entity';
import { diffTotals, isSpecialPriceSource, orderTotals, TOTAL_FIELDS } from './order-totals';

const BATCH = 200;
type JoshOrder = Record<string, number | null> & { orders_id: string; order_number: string | null; create_date: Date };
type JoshLine = { order_id: string; quantity: number; unit_price: number; unit_list_price: number | null; price_source: string | null; fulfillment_type: string | null; vat_type: string | null; vat_changed: boolean };

/**
 * Checkout / orders step 1 (shadow quote): every new josh order's totals are rebuilt from its
 * stored lines with josh's checkout math (copied, `order-totals.ts`) and compared field by field —
 * VAT split, groups by fulfillment type, delivery fee rule, how the checkout discount is spread.
 * Line prices are the price shadow's job; the coupon / credit amount is taken from josh. Reads
 * josh only. 100% for a long stretch = commerce can quote a cart exactly like josh.
 */
@Injectable()
export class OrderQuoteShadow {
  private readonly logger = new Logger(OrderQuoteShadow.name);
  private running = false;

  constructor(private readonly replica: JoshReplica, @InjectRepository(OrderQuoteCheck) private readonly checks: Repository<OrderQuoteCheck>) {}

  get available() { return this.replica.configured; }

  @Cron(cronConfig.orderQuoteShadow.expression, { timeZone: cronConfig.orderQuoteShadow.timeZone, disabled: !cronConfig.orderQuoteShadow.enabled })
  async tick() {
    if (!this.available || this.running) return; // ponytail: in-process guard; one commerce instance runs this cron
    this.running = true;
    try {
      const n = await this.checkNew();
      if (n) this.logger.log(`rebuilt the totals of ${n} josh orders`);
    } catch (error) {
      this.logger.warn(`order quote shadow failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }

  private orders(where: string, params: unknown[]) {
    return this.replica.query<JoshOrder>(`SELECT orders_id, order_number, create_date, ${TOTAL_FIELDS.map((f) => `${f}::float AS ${f}`).join(', ')}
      FROM orders ${where}`, params);
  }

  async checkNew(limit = BATCH): Promise<number> {
    const [{ since }] = await this.checks.query(`SELECT COALESCE(max(ordered_at), now() - interval '24 hours') AS since FROM order_quote_checks`);
    const rows = await this.orders(`WHERE create_date >= $1 ORDER BY create_date LIMIT $2`, [since, limit]);
    if (!rows.length) return 0;
    const done = new Set((await this.checks.find({ where: rows.map((r) => ({ joshOrderId: r.orders_id })), select: ['joshOrderId'] })).map((c) => c.joshOrderId));
    const todo = rows.filter((r) => !done.has(r.orders_id));
    if (!todo.length) return 0;
    const lines = await this.lines(todo.map((r) => r.orders_id));
    for (const o of todo) await this.checkOne(o, lines.filter((l) => l.order_id === o.orders_id));
    return todo.length;
  }

  async recheck(joshOrderId: string) {
    const [o] = await this.orders(`WHERE orders_id = $1`, [joshOrderId]);
    if (!o) throw new NotFoundException(`josh order ${joshOrderId} not found`);
    await this.checks.delete({ joshOrderId });
    return this.checkOne(o, await this.lines([joshOrderId]));
  }

  private lines(orderIds: string[]) {
    return this.replica.query<JoshLine>(`SELECT oi.order_id::text AS order_id, oi.product_quantity AS quantity, oi.product_price::float AS unit_price,
        oi.unit_list_price_inc_vat::float AS unit_list_price, oi.price_source, oi.fulfillment_type, pi.vat_type,
        (pi.updated_at > o.create_date) AS vat_changed
      FROM order_items oi JOIN orders o ON o.orders_id = oi.order_id LEFT JOIN product_inventory pi ON pi.product_inventory_id = oi.product_inventory_id
      WHERE oi.order_id = ANY($1::uuid[])`, [orderIds]);
  }

  private async checkOne(o: JoshOrder, lines: JoshLine[]): Promise<OrderQuoteCheck> {
    const joshTotals = Object.fromEntries(TOTAL_FIELDS.map((f) => [f, o[f] ?? null]));
    const base = { joshOrderId: o.orders_id, orderNumber: o.order_number, orderedAt: o.create_date, joshTotals };
    if (!lines.length) return this.checks.save(this.checks.create({ ...base, matched: false, commerceTotals: null, note: 'order ไม่มีบรรทัดสินค้า' }));
    const commerce = orderTotals(lines.map((l) => ({
      quantity: Number(l.quantity), unitPriceIncVat: Number(l.unit_price), vatType: l.vat_type, fulfillmentType: l.fulfillment_type,
      unitListPriceIncVat: l.unit_list_price, isSpecialPrice: isSpecialPriceSource(l.price_source),
    })), { exVat: Number(o.discount_amount ?? 0), incVat: Number(o.discount_inc_vat ?? 0) });
    const diffs = diffTotals(joshTotals, commerce);
    // VAT type is read from today's product; a product edited after the order can explain a VAT difference.
    const note = diffs.length && lines.some((l) => l.vat_changed) ? 'สินค้าในออเดอร์ถูกแก้หลังสั่ง (อาจเปลี่ยนประเภท VAT)' : null;
    return this.checks.save(this.checks.create({ ...base, matched: diffs.length === 0, diffs, commerceTotals: { ...commerce }, note }));
  }

  async summary(days = 7) {
    const [row] = await this.checks.query(`SELECT count(*)::int AS checked, count(*) FILTER (WHERE matched)::int AS matched,
        count(*) FILTER (WHERE NOT matched AND commerce_totals IS NOT NULL)::int AS mismatched, min(ordered_at) AS first_at, max(ordered_at) AS last_at
      FROM order_quote_checks WHERE ordered_at >= now() - make_interval(days => $1)`, [days]);
    const byField = await this.checks.query(`SELECT d->>'field' AS field, count(*)::int AS n FROM order_quote_checks, jsonb_array_elements(diffs) d
      WHERE ordered_at >= now() - make_interval(days => $1) GROUP BY 1 ORDER BY 2 DESC`, [days]);
    return { days, ...row, matchRate: row.checked ? Math.round((row.matched / row.checked) * 1000) / 10 : null, mismatchByField: byField };
  }

  list(filter: 'all' | 'mismatched' | 'matched' = 'mismatched', page = 1, limit = 50) {
    const where = filter === 'mismatched' ? { matched: false } : filter === 'matched' ? { matched: true } : {};
    return this.checks.findAndCount({ where, order: { orderedAt: 'DESC' }, skip: (page - 1) * limit, take: limit }).then(([items, total]) => ({ items, total, page, limit }));
  }
}
