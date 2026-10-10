import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { repScopeSql } from './sales-rep-scope';
import { containsPattern } from '../../../../shared-kernel/helpers/like.helper';
import { JoshReplica } from './josh-replica';
import { maskEmail, maskPersonName, maskPhone } from './winback/pii.helper';
import { paidOrderSql } from './josh-insights';

const UUID = /^[0-9a-f-]{36}$/i;
/** josh order statuses where the order should already be at Jagota (paid onward, not cancelled). */
const SHOULD_BE_AT_JAGOTA = `('paid','preparing','shipped','delivered')`;

/**
 * Latest Jagota sync per order (josh `jagota_order_sync`, one row per send attempt / shipment).
 * `sent`/`confirmed`/`reserved`/`skipped` = handled; `failed`; `pending`; none = never tried.
 */
const latestSync = (table: string) => `LEFT JOIN LATERAL (
    SELECT s.sync_status, s.error_message, s.doc_book, s.doc_no, s.created_at
      FROM ${table} s WHERE s.order_id = o.orders_id ORDER BY s.created_at DESC LIMIT 1
  ) js ON TRUE`;

type Source = 'replica' | 'copies';
/**
 * ORDERS_SOURCE: replica (default) · copies (stage 5, S5-7): `josh_orders` (`paid` from josh's builder), `josh_companies`,
 * commerce's `jagota_order_sync_history` (jagota_sync.snapshot events + the old import), lines from `josh_order_lines` +
 * catalog names; since S5-11 also `josh_branches`, `josh_order_payments` / `_shipments`, `sending_date`, the company's ERP
 * code and the orderer's phone (customer copy, masked). Copied payments include batch payments (josh's replica detail
 * lists only the order's own). Not copied, answered as null: a line's order_taking_flag.
 */
export const ordersSource = (): Source => (process.env.ORDERS_SOURCE?.trim().toLowerCase() === 'copies' ? 'copies' : 'replica');
const T = {
  replica: { orders: 'orders', company: 'company', sync: 'jagota_order_sync', paid: paidOrderSql('o') },
  copies: { orders: 'josh_orders', company: 'josh_companies', sync: 'jagota_order_sync_history', paid: 'o.paid' },
} as const;
const NOT_COPIED = ['items.order_taking_flag'];
/** Latest copied payment per order — the copy's LATEST_PAYMENT. */
const LATEST_PAYMENT_COPY = `LEFT JOIN LATERAL (
    SELECT t.status, t.payment_method, t.paid_at FROM josh_order_payments t WHERE t.orders_id = o.orders_id ORDER BY t.created_at DESC LIMIT 1
  ) pt ON TRUE`;
const LATEST_PAYMENT = `LEFT JOIN LATERAL (
    SELECT t.status::text AS status, t.payment_method, t.paid_at FROM payment_transactions t WHERE t.order_id = o.orders_id ORDER BY t.created_at DESC LIMIT 1
  ) pt ON TRUE`;

export const SYNC_STATES = {
  failed: `js.sync_status = 'failed'`,
  not_sent: `o.status::text IN ${SHOULD_BE_AT_JAGOTA} AND js.sync_status IS NULL`,
  pending: `js.sync_status = 'pending'`,
  sent: `js.sync_status IN ('sent','confirmed','reserved','skipped')`,
} as const;

export interface OrderFilters { search?: string; status?: string; sync?: string; companyId?: string; from?: string; to?: string; payment?: string; repIds?: string[] }

/** `paid` = the paid-order test for `o` (the replica's payment_transactions EXISTS, or the copy's `o.paid`). */
export function orderWhere(f: OrderFilters, paid = paidOrderSql('o'), copies = false): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const add = (v: unknown) => `$${params.push(v)}`;
  const w: string[] = [];
  const s = f.search?.trim().slice(0, 100);
  if (s) { const p = add(containsPattern(s)); w.push(`(o.order_number ILIKE ${p} ESCAPE '\\' OR o.customer_code ILIKE ${p} ESCAPE '\\' OR o.po_number ILIKE ${p} ESCAPE '\\' OR c.name ILIKE ${p} ESCAPE '\\')`); }
  if (f.status) w.push(`o.status::text = ${add(f.status.slice(0, 30))}`);
  if (f.sync) {
    if (!(f.sync in SYNC_STATES)) throw new BadRequestException(`sync must be one of: ${Object.keys(SYNC_STATES).join(', ')}`);
    w.push(SYNC_STATES[f.sync as keyof typeof SYNC_STATES]);
  }
  if (f.payment) {
    // 'missing' = a paid / fulfilled status but no successful non-test payment (not counted as sales)
    if (f.payment !== 'missing') throw new BadRequestException('payment must be missing');
    w.push(`o.status::text IN ${SHOULD_BE_AT_JAGOTA} AND NOT ${paid}`);
  }
  if (f.companyId) { if (!UUID.test(f.companyId)) throw new BadRequestException('companyId must be a uuid'); w.push(`o.company_id = ${add(f.companyId)}`); }
  for (const [k, op] of [['from', '>='], ['to', '<']] as const) {
    const v = f[k];
    if (!v) continue;
    if (Number.isNaN(Date.parse(v))) throw new BadRequestException(`${k} must be a date`);
    w.push(`o.create_date ${op} ${add(new Date(v))}`);
  }
  if (f.repIds !== undefined) w.push(repScopeSql('c', add(f.repIds), copies));
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

/**
 * josh orders, READ-ONLY from josh's replica or commerce's copies (ORDERS_SOURCE): status, payment, and whether each
 * order reached Jagota (ERP). Orders keep being created, paid and sent by josh. Customer contact data is
 * masked like josh's winback screens.
 */
@Injectable()
export class JoshOrders {
  constructor(private readonly replica: JoshReplica, @InjectDataSource() private readonly db: DataSource) {}

  get source() { return ordersSource(); }
  get available() { return this.source === 'copies' || this.replica.configured; }

  private q<R = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<R[]> {
    return this.source === 'copies' ? this.db.query(sql, params) : this.replica.query<R>(sql, params);
  }

  /** Bounded planning evidence using the original paid-order rule, without inferring payment from status. */
  async planningOrders(companyId: string, repIds?: string[]) {
    const t=T[this.source], {where,params}=orderWhere({companyId,repIds},t.paid,this.source==='copies');
    const rows=await this.q(`SELECT o.orders_id,o.order_number,o.status::text AS status,o.create_date,${t.paid} AS paid FROM ${t.orders} o LEFT JOIN ${t.company} c ON c.id=o.company_id ${where} ORDER BY o.create_date DESC,o.orders_id LIMIT 21`,params);
    return {items:rows.slice(0,20),hasMore:rows.length>20};
  }

  async summary(f: OrderFilters = {}) {
    const t = T[this.source];
    const { where, params } = orderWhere(f, t.paid, this.source === 'copies');
    const sync = Object.entries(SYNC_STATES).map(([k, cond]) => `count(*) FILTER (WHERE ${cond})::int AS sync_${k}`).join(', ');
    const from = `FROM ${t.orders} o LEFT JOIN ${t.company} c ON c.id = o.company_id ${latestSync(t.sync)} ${where}`;
    const [[row], byStatus] = await Promise.all([
      this.q(`SELECT count(*)::int AS total, ${sync},
          count(*) FILTER (WHERE o.status::text = 'payment_pending')::int AS awaiting_payment,
          COALESCE(sum(o.total_price) FILTER (WHERE o.status::text IN ${SHOULD_BE_AT_JAGOTA} AND ${t.paid}), 0)::float AS paid_value,
          count(*) FILTER (WHERE o.status::text IN ${SHOULD_BE_AT_JAGOTA} AND NOT ${t.paid})::int AS settled_without_payment
        ${from}`, params),
      this.q(`SELECT o.status::text AS status, count(*)::int AS n ${from} GROUP BY 1 ORDER BY 2 DESC`, params),
    ]);
    return { ...row, byStatus, source: this.source };
  }

  async list(f: OrderFilters, page = 1, limit = 50) {
    const copies = this.source === 'copies', t = T[this.source];
    const { where, params } = orderWhere(f, t.paid, this.source === 'copies');
    const n = params.length;
    const base = copies
      ? `FROM josh_orders o LEFT JOIN josh_companies c ON c.id = o.company_id LEFT JOIN josh_branches b ON b.id = o.branch_id ${latestSync(t.sync)} ${LATEST_PAYMENT_COPY} ${where}`
      : `FROM orders o LEFT JOIN company c ON c.id = o.company_id LEFT JOIN branch b ON b.id = o.branch_id ${latestSync(t.sync)} ${LATEST_PAYMENT} ${where}`;
    const payment = `b.name AS branch_name, pt.status AS payment_status, pt.payment_method, pt.paid_at`;
    const [items, [{ total }]] = await Promise.all([
      this.q(`SELECT o.orders_id, o.order_number, o.status::text AS status, o.create_date, o.delivery_date::text AS delivery_date, o.total_price::float AS total_price,
          o.customer_code, o.po_number, c.name AS company_name, ${payment},
          js.sync_status AS jagota_sync_status, js.error_message AS jagota_error, js.doc_book, js.doc_no, js.created_at AS jagota_synced_at
        ${base} ORDER BY o.create_date DESC LIMIT $${n + 1} OFFSET $${n + 2}`, [...params, limit, (page - 1) * limit]),
      this.q<{ total: number }>(`SELECT count(*)::int AS total ${base}`, params),
    ]);
    return { items, total, page, limit, ...(copies ? { source: 'copies', notCopied: NOT_COPIED } : {}) };
  }

  async detail(idOrNumber: string, repIds?: string[]) {
    if (this.source === 'copies') return this.detailFromCopies(idOrNumber, repIds);
    const byId = UUID.test(idOrNumber);
    const [order] = await this.replica.query<Record<string, unknown>>(
      `SELECT o.orders_id, o.order_number, o.status::text AS status, o.fulfillment_type::text AS fulfillment_type, o.payment_type::text AS payment_type, o.create_date, o.delivery_date::text AS delivery_date, o.sending_date::text AS sending_date, o.customer_code, o.po_number, o.remark,
          o.total_price::float AS total_price, o.subtotal_ex_vat::float AS subtotal_ex_vat, o.vat_amount::float AS vat_amount,
          o.discount_inc_vat::float AS discount_inc_vat, o.delivery_fee::float AS delivery_fee,
          c.id AS company_id, c.name AS company_name, c.erp_customer_code, b.name AS branch_name, b.erp_branch_code,
          u.first_name, u.last_name, u.email, u.mobile_phone
        FROM orders o LEFT JOIN company c ON c.id = o.company_id LEFT JOIN branch b ON b.id = o.branch_id LEFT JOIN users u ON u.id = o.user_id
       WHERE ${byId ? 'o.orders_id = $1' : 'o.order_number = $1'} ${repIds !== undefined ? `AND ${repScopeSql('c', '$2', false)}` : ''} LIMIT 1`, repIds !== undefined ? [idOrNumber.trim().slice(0, 64), repIds] : [idOrNumber.trim().slice(0, 64)]);
    if (!order) throw new NotFoundException(`order ${idOrNumber} not found in josh`);
    const id = order.orders_id;
    const [items, shipments, jagota, payments] = await Promise.all([
      this.replica.query(`SELECT pi.product_inventory_sku AS sku, COALESCE(th.product_name, pi.product_inventory_sku) AS name, oi.product_quantity::float AS qty,
          oi.product_price::float AS unit_price, oi.line_revenue::float AS line_revenue, oi.price_source::text AS price_source, oi.order_taking_flag
        FROM order_items oi JOIN product_inventory pi ON pi.product_inventory_id = oi.product_inventory_id
        LEFT JOIN product_translation th ON th.product_inventory_id = pi.product_inventory_id AND th.language_code = 'th'
       WHERE oi.order_id = $1 ORDER BY pi.product_inventory_sku`, [id]),
      this.replica.query(`SELECT shipment_number, status::text AS status, fulfillment_type::text AS fulfillment_type, delivery_date::text AS delivery_date, shipped_at, delivered_at, cancelled_at, total_inc_vat::float AS total_inc_vat,
          erp_sync_status, three_pl_status FROM shipments WHERE order_id = $1 ORDER BY created_at`, [id]),
      this.replica.query(`SELECT sync_status, transaction_type, doc_book, doc_no, error_message, payment_method, payment_success, created_at
        FROM jagota_order_sync WHERE order_id = $1 ORDER BY created_at`, [id]),
      this.replica.query(`SELECT status::text AS status, payment_method, amount::float AS amount, gateway_provider, paid_at, created_at
        FROM payment_transactions WHERE order_id = $1 ORDER BY created_at`, [id]),
    ]);
    // Who ordered: masked the same way josh's winback masks people (full values stay in josh's audited reveal).
    const { first_name, last_name, email, mobile_phone, ...rest } = order;
    return {
      ...rest,
      orderedBy: { name: maskPersonName(first_name as string, last_name as string), email: maskEmail(email as string), phone: maskPhone(mobile_phone as string) },
      items, shipments, jagotaSync: jagota, payments,
    };
  }

  /** One order from the copies; what is not copied yet is null and listed in `notCopied`. */
  private async detailFromCopies(idOrNumber: string, repIds?: string[]) {
    const byId = UUID.test(idOrNumber);
    const [order] = await this.db.query(
      `SELECT o.orders_id, o.order_number, o.status, o.fulfillment_type, o.payment_type, o.create_date, o.delivery_date::text AS delivery_date,
          o.sending_date::text AS sending_date, o.customer_code, o.po_number, o.remark,
          o.total_price::float AS total_price, o.subtotal_ex_vat::float AS subtotal_ex_vat, o.vat_amount::float AS vat_amount,
          o.discount_inc_vat::float AS discount_inc_vat, o.delivery_fee::float AS delivery_fee,
          CASE WHEN o.paid THEN 'success' ELSE 'not paid' END AS payment_status,
          c.id AS company_id, c.name AS company_name, c.erp_customer_code, b.name AS branch_name, b.erp_branch_code,
          u.first_name, u.last_name, u.email, jc.data->>'mobile_phone' AS mobile_phone
        FROM josh_orders o LEFT JOIN josh_companies c ON c.id = o.company_id LEFT JOIN josh_users u ON u.id = o.user_id
        LEFT JOIN josh_branches b ON b.id = o.branch_id LEFT JOIN josh_customers jc ON jc.id = o.user_id AND jc.deleted_at IS NULL
       WHERE ${byId ? 'o.orders_id = $1' : 'o.order_number = $1'} ${repIds !== undefined ? `AND ${repScopeSql('c', '$2', true)}` : ''} LIMIT 1`, repIds !== undefined ? [idOrNumber.trim().slice(0, 64), repIds] : [idOrNumber.trim().slice(0, 64)]);
    if (!order) throw new NotFoundException(`order ${idOrNumber} not found in commerce's copy of josh orders`);
    const id = order.orders_id;
    const [items, jagota, shipments, payments] = await Promise.all([
      this.db.query(`SELECT l.sku, COALESCE((SELECT t->>'product_name' FROM jsonb_array_elements(cp.translations) t WHERE t->>'language_code' = 'th' LIMIT 1), l.sku) AS name,
          l.product_quantity::float AS qty, l.product_price::float AS unit_price, l.line_revenue::float AS line_revenue, l.price_source, NULL::text AS order_taking_flag
        FROM josh_order_lines l LEFT JOIN josh_catalog_products cp ON cp.id = l.product_inventory_id
       WHERE l.orders_id = $1 ORDER BY l.sku`, [id]),
      this.db.query(`SELECT sync_status, transaction_type, doc_book, doc_no, error_message, payment_method, payment_success, created_at
        FROM jagota_order_sync_history WHERE order_id = $1 ORDER BY created_at`, [id]),
      this.db.query(`SELECT shipment_number, status, fulfillment_type, delivery_date::text AS delivery_date, shipped_at, delivered_at, cancelled_at,
          total_inc_vat::float AS total_inc_vat, erp_sync_status, three_pl_status FROM josh_order_shipments WHERE orders_id = $1 ORDER BY created_at, id`, [id]),
      this.db.query(`SELECT status, payment_method, amount::float AS amount, allocated_amount::float AS allocated_amount, gateway_provider, paid_at, created_at
        FROM josh_order_payments WHERE orders_id = $1 ORDER BY created_at, id`, [id]),
    ]);
    const { first_name, last_name, email, mobile_phone, ...rest } = order;
    return {
      ...rest,
      orderedBy: { name: maskPersonName(first_name, last_name), email: maskEmail(email), phone: maskPhone(mobile_phone) },
      items, shipments, jagotaSync: jagota, payments, source: 'copies', notCopied: NOT_COPIED,
    };
  }
}
