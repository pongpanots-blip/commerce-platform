import { Injectable } from '@nestjs/common';
import { JoshReplica } from './josh-replica';

/** josh's SETTLED_ORDER_STATUSES (money taken) — the same set its purchases dashboard counts. */
export const JOSH_SETTLED_STATUSES = ['paid', 'preparing', 'shipped', 'delivered'];

export const PERIODS = ['today', 'yesterday', 'this_week', 'last_7_days', 'this_month', 'last_month', 'last_30_days', 'custom'] as const;
export type Period = (typeof PERIODS)[number];
export interface Range { label: string; from: Date; to: Date }

const BKK_MS = 7 * 3600_000; // Asia/Bangkok, no DST
const DAY = 24 * 3600_000;
/** Midnight Bangkok of the Bangkok calendar day containing `t`, as a UTC instant. */
const bkkMidnight = (t: number) => Math.floor((t + BKK_MS) / DAY) * DAY - BKK_MS;
const bkkDate = (t: number) => new Date(t + BKK_MS).toISOString().slice(0, 10);

/**
 * A period in Bangkok time → [from, to) plus the period of the same length right
 * before it, so "this month" can be compared with "last month to the same day".
 * `custom` takes YYYY-MM-DD dates (inclusive, Bangkok).
 */
export function bangkokRange(period: Period, now = Date.now(), fromDate?: string, toDate?: string): { current: Range; previous: Range } {
  const today = bkkMidnight(now);
  const bkkNow = new Date(now + BKK_MS);
  const monthStart = Date.UTC(bkkNow.getUTCFullYear(), bkkNow.getUTCMonth(), 1) - BKK_MS;
  let from: number;
  let to: number;
  switch (period) {
    case 'today': from = today; to = now; break;
    case 'yesterday': from = today - DAY; to = today; break;
    case 'this_week': from = today - ((bkkNow.getUTCDay() + 6) % 7) * DAY; to = now; break; // Monday start
    case 'last_7_days': from = today - 6 * DAY; to = now; break;
    case 'this_month': from = monthStart; to = now; break;
    case 'last_month': from = Date.UTC(bkkNow.getUTCFullYear(), bkkNow.getUTCMonth() - 1, 1) - BKK_MS; to = monthStart; break;
    case 'last_30_days': from = today - 29 * DAY; to = now; break;
    case 'custom': {
      const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
      if (!ok(fromDate) || !ok(toDate)) throw new Error('custom period needs fromDate and toDate as YYYY-MM-DD');
      from = Date.parse(fromDate!) - BKK_MS;
      to = Date.parse(toDate!) - BKK_MS + DAY;
      if (to <= from) throw new Error('toDate must be on or after fromDate');
      if (to - from > 366 * DAY) throw new Error('at most 366 days per question');
      break;
    }
  }
  const len = to - from;
  const label = (a: number, b: number) => `${bkkDate(a)} → ${bkkDate(b - 1)} (Asia/Bangkok)`;
  return {
    current: { label: label(from, to), from: new Date(from), to: new Date(to) },
    previous: { label: label(from - len, from), from: new Date(from - len), to: new Date(from) },
  };
}

const SALES_TOTALS_SQL = `
  SELECT count(*) FILTER (WHERE status::text = ANY($3))::int AS orders,
         COALESCE(sum(total_price) FILTER (WHERE status::text = ANY($3)), 0)::float AS revenue_inc_vat,
         COALESCE(sum(subtotal_ex_vat) FILTER (WHERE status::text = ANY($3)), 0)::float AS subtotal_ex_vat,
         COALESCE(sum(discount_inc_vat) FILTER (WHERE status::text = ANY($3)), 0)::float AS discounts_inc_vat,
         count(DISTINCT user_id) FILTER (WHERE status::text = ANY($3))::int AS buying_customers,
         count(DISTINCT company_id) FILTER (WHERE status::text = ANY($3))::int AS buying_companies,
         count(*) FILTER (WHERE status::text = 'payment_pending')::int AS awaiting_payment,
         count(*) FILTER (WHERE status::text = 'cancelled')::int AS cancelled,
         count(*) FILTER (WHERE status::text = 'refunded')::int AS refunded
    FROM orders WHERE create_date >= $1 AND create_date < $2`;

const SALES_DAILY_SQL = `
  SELECT to_char(create_date AT TIME ZONE 'Asia/Bangkok', $4) AS bucket, count(*)::int AS orders, COALESCE(sum(total_price), 0)::float AS revenue_inc_vat
    FROM orders WHERE create_date >= $1 AND create_date < $2 AND status::text = ANY($3)
   GROUP BY 1 ORDER BY 1`;

// ponytail: order_items has no order_id index in josh's migrations — this hash-joins
// order_items on the replica; fine there, add an index in josh if it gets slow.
const TOP_PRODUCTS_SQL = `
  SELECT pi.product_inventory_sku AS sku, COALESCE(th.product_name, pi.product_inventory_sku) AS name,
         sum(oi.product_quantity)::float AS qty, sum(COALESCE(oi.line_revenue, oi.product_price * oi.product_quantity))::float AS revenue_inc_vat
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.orders_id
    JOIN product_inventory pi ON pi.product_inventory_id = oi.product_inventory_id
    LEFT JOIN product_translation th ON th.product_inventory_id = pi.product_inventory_id AND th.language_code = 'th'
   WHERE o.create_date >= $1 AND o.create_date < $2 AND o.status::text = ANY($3)
   GROUP BY 1, 2 ORDER BY revenue_inc_vat DESC LIMIT $4`;

const NEW_CUSTOMERS_SQL = `SELECT count(*)::int AS n FROM customer_metrics WHERE first_order_at >= $1 AND first_order_at < $2`;
const REFUNDS_SQL = `SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::float AS amount FROM order_refunds
                      WHERE status::text = 'refunded' AND created_at >= $1 AND created_at < $2`;

const TRAFFIC_TOTALS_SQL = `
  SELECT count(DISTINCT session_id)::int AS sessions, count(DISTINCT individual_id)::int AS visitors,
         count(DISTINCT user_id)::int AS logged_in_users,
         count(*) FILTER (WHERE event_name = 'search')::int AS searches,
         count(*) FILTER (WHERE event_name = 'view_item')::int AS product_views,
         count(*) FILTER (WHERE event_name = 'add_to_cart')::int AS add_to_carts,
         count(*) FILTER (WHERE event_name = 'begin_checkout')::int AS checkouts_started,
         count(*) FILTER (WHERE event_name = 'purchase')::int AS purchases
    FROM analytics_events WHERE occurred_at >= $1 AND occurred_at < $2`;
const TRAFFIC_BY_PLATFORM_SQL = `
  SELECT platform, count(DISTINCT session_id)::int AS sessions, count(DISTINCT individual_id)::int AS visitors
    FROM analytics_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY 1 ORDER BY 2 DESC`;
const TRAFFIC_DAILY_SQL = `
  SELECT to_char(occurred_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day, count(DISTINCT session_id)::int AS sessions
    FROM analytics_events WHERE occurred_at >= $1 AND occurred_at < $2 GROUP BY 1 ORDER BY 1`;
/** Kept after the raw events are purged (90 days): sessions reaching each funnel step per Bangkok day. */
const FUNNEL_SQL = `
  SELECT step, sum(session_count)::int AS sessions FROM analytics_funnel_daily
   WHERE day >= ($1::timestamptz AT TIME ZONE 'Asia/Bangkok')::date
     AND day <= (($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Asia/Bangkok')::date
   GROUP BY 1`;
const TOP_SEARCHES_SQL = `
  SELECT lower(trim(query_text)) AS query, count(*)::int AS searches, count(*) FILTER (WHERE result_count = 0)::int AS no_results
    FROM user_search_history WHERE created_at >= $1 AND created_at < $2 AND trim(query_text) <> ''
   GROUP BY 1 ORDER BY 2 DESC LIMIT $3`;

const JOSH_FAILURES_SQL = `
  SELECT 'payments_failed' AS kind, count(*)::int AS n FROM payment_transactions WHERE status::text = 'failed' AND created_at >= $1 AND created_at < $2
  UNION ALL
  SELECT 'jagota_order_sync_failed', count(*)::int FROM jagota_order_sync WHERE sync_status = 'failed' AND created_at >= $1 AND created_at < $2
  UNION ALL
  SELECT 'marketing_runs_failed', count(*)::int FROM marketing_workflow_scheduled_runs WHERE status::text = 'failed' AND fired_at >= $1 AND fired_at < $2
  UNION ALL
  SELECT 'push_campaigns_failed', count(*)::int FROM push_campaigns WHERE status::text = 'failed' AND updated_at >= $1 AND updated_at < $2`;
const JAGOTA_SYNC_ERRORS_SQL = `
  SELECT left(error_message, 200) AS error, count(*)::int AS n, max(created_at) AS last_at FROM jagota_order_sync
   WHERE sync_status = 'failed' AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;

/** josh's `customer_order_targetgroup_summary` view: per customer, how many order-taking SKUs they buy and how often they can be delivered. */
const ORDER_TARGETGROUP_SQL = `
  SELECT cust_code, total_skus_ordered, ot_skus_ordered, ot_skus_with_active_period, max_shipments_per_week, delivery_weekdays,
         count(*) OVER ()::int AS total
    FROM customer_order_targetgroup_summary
   WHERE max_shipments_per_week >= $1 AND ($2::text IS NULL OR cust_code ILIKE $2)
   ORDER BY max_shipments_per_week DESC, ot_skus_ordered DESC, cust_code
   LIMIT $3 OFFSET $4`;

const round = (n: number) => Math.round(n * 100) / 100;
const change = (now: number, before: number) => (before ? round(((now - before) / before) * 100) : null);

/**
 * Answers "how are sales / traffic / errors" from josh's READ REPLICA
 * (JOSH_DATABASE_URL) — josh's primary and josh's code are never touched.
 * Used by the MCP tools. What josh keeps only in Mongo (HTTP request logs,
 * 5xx counts) is not reachable from here and is reported as such.
 */
@Injectable()
export class JoshInsights {
  constructor(private readonly replica: JoshReplica) {}

  get available() { return this.replica.configured; }

  async sales(r: { current: Range; previous: Range }, top = 10) {
    const q = (sql: string, range: Range, ...extra: unknown[]) => this.replica.query(sql, [range.from, range.to, ...extra]);
    const days = (r.current.to.getTime() - r.current.from.getTime()) / DAY;
    const [[now], [before], series, products, [newCustomers], [refunds]] = await Promise.all([
      q(SALES_TOTALS_SQL, r.current, JOSH_SETTLED_STATUSES),
      q(SALES_TOTALS_SQL, r.previous, JOSH_SETTLED_STATUSES),
      q(SALES_DAILY_SQL, r.current, JOSH_SETTLED_STATUSES, days > 62 ? 'YYYY-MM' : 'YYYY-MM-DD'),
      q(TOP_PRODUCTS_SQL, r.current, JOSH_SETTLED_STATUSES, top),
      q(NEW_CUSTOMERS_SQL, r.current),
      q(REFUNDS_SQL, r.current),
    ]);
    const revenue = Number(now.revenue_inc_vat);
    const orders = Number(now.orders);
    return {
      period: r.current.label,
      counted: `orders with status ${JOSH_SETTLED_STATUSES.join('/')} (paid); THB incl. VAT after discounts`,
      totals: { ...now, average_order_inc_vat: orders ? round(revenue / orders) : 0, new_customers: newCustomers.n, refunds },
      vsPreviousPeriod: { period: r.previous.label, revenue_inc_vat: before.revenue_inc_vat, orders: before.orders,
        revenue_change_percent: change(revenue, Number(before.revenue_inc_vat)), orders_change_percent: change(orders, Number(before.orders)) },
      [days > 62 ? 'byMonth' : 'byDay']: series,
      topProducts: products,
    };
  }

  async traffic(r: { current: Range; previous: Range }, top = 10) {
    const q = (sql: string, range: Range, ...extra: unknown[]) => this.replica.query(sql, [range.from, range.to, ...extra]);
    const [[now], [before], platforms, daily, funnel, searches] = await Promise.all([
      q(TRAFFIC_TOTALS_SQL, r.current), q(TRAFFIC_TOTALS_SQL, r.previous), q(TRAFFIC_BY_PLATFORM_SQL, r.current),
      q(TRAFFIC_DAILY_SQL, r.current), q(FUNNEL_SQL, r.current), q(TOP_SEARCHES_SQL, r.current, top),
    ]);
    return {
      period: r.current.label,
      note: 'sessions = visits (30 min idle ends one); visitors = distinct devices. Raw events are kept 90 days — older periods only have the funnel.',
      totals: now,
      vsPreviousPeriod: { period: r.previous.label, sessions: before.sessions, visitors: before.visitors,
        sessions_change_percent: change(Number(now.sessions), Number(before.sessions)) },
      byPlatform: platforms,
      sessionsByDay: daily,
      funnelSessions: Object.fromEntries(funnel.map((f) => [f.step, f.sessions])),
      topSearches: searches,
    };
  }

  async orderTargetgroup(o: { minShipmentsPerWeek?: number; custCode?: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(o.limit ?? 100, 1), 1000);
    const rows = await this.replica.query(ORDER_TARGETGROUP_SQL,
      [o.minShipmentsPerWeek ?? 0, o.custCode ? `%${o.custCode}%` : null, limit, Math.max(o.offset ?? 0, 0)]);
    return { total: rows[0]?.total ?? 0, items: rows.map(({ total: _t, ...r }: Record<string, unknown>) => r) };
  }

  async failures(range: Range) {
    const [counts, jagotaErrors] = await Promise.all([
      this.replica.query(JOSH_FAILURES_SQL, [range.from, range.to]),
      this.replica.query(JAGOTA_SYNC_ERRORS_SQL, [range.from, range.to]),
    ]);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
      jagotaOrderSyncErrors: jagotaErrors,
      notAvailable: 'HTTP request logs / 5xx counts and ERP request logs are kept in josh\'s Mongo (api_logs), which commerce cannot read.',
    };
  }
}
