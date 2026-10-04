import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { cronConfig } from '../../../../config/cron.config';
import { joshApiConfigured, postToJosh } from './josh-api';
import { JoshReplica } from './josh-replica';

/**
 * josh's ACTIVE_ORDER_STATUSES (shared/enums/order-status-sets.ts). Sent with every batch; josh refuses
 * (409) a batch computed with a different list, so a drift fails loudly and josh's own cron takes over.
 */
export const JOSH_ACTIVE_ORDER_STATUSES = ['payment_pending', 'paid', 'preparing', 'shipped', 'delivered'];
const BATCH = 1000;

/**
 * The same aggregation josh's CustomerMetricsService.reconcile() runs, done on
 * the replica and narrowed to the rows whose values actually changed (cast to
 * the column types, so equal values compare equal). josh then writes only
 * those rows instead of every customer_metrics row every night.
 */
export const CHANGED_METRICS_SQL = `
  WITH agg AS (
    SELECT user_id, COUNT(*) AS n, COALESCE(SUM(total_price), 0) AS spend, MIN(create_date) AS first_at, MAX(create_date) AS last_at,
           COUNT(*) FILTER (WHERE create_date >= now() - interval '90 days') AS n90,
           COALESCE(SUM(total_price) FILTER (WHERE create_date >= now() - interval '90 days'), 0) AS spend90
    FROM orders WHERE status = ANY($1::text[]) AND user_id IS NOT NULL GROUP BY user_id
  ),
  calc AS (
    SELECT u.user_id,
      COALESCE(a.n, 0)::int AS lifetime_order_count,
      COALESCE(a.spend, 0)::numeric(14,2) AS lifetime_spend,
      COALESCE(a.spend / NULLIF(a.n, 0), 0)::numeric(14,2) AS avg_order_value,
      a.first_at AS first_order_at, a.last_at AS last_order_at,
      COALESCE(a.n90, 0)::int AS order_count_90d,
      COALESCE(a.spend90, 0)::numeric(14,2) AS spend_90d
    FROM (SELECT user_id FROM agg UNION SELECT user_id FROM customer_metrics) u
    LEFT JOIN agg a ON a.user_id = u.user_id
  )
  -- timestamps as text: a JS Date would drop the microseconds and the row would look changed forever
  SELECT c.user_id, c.lifetime_order_count, c.lifetime_spend, c.avg_order_value,
         c.first_order_at::text AS first_order_at, c.last_order_at::text AS last_order_at, c.order_count_90d, c.spend_90d
  FROM calc c LEFT JOIN customer_metrics m ON m.user_id = c.user_id
  WHERE m.user_id IS NULL
     OR (m.lifetime_order_count, m.lifetime_spend, m.avg_order_value, m.first_order_at, m.last_order_at, m.order_count_90d, m.spend_90d)
        IS DISTINCT FROM
        (c.lifetime_order_count, c.lifetime_spend, c.avg_order_value, c.first_order_at, c.last_order_at, c.order_count_90d, c.spend_90d)`;

/**
 * Task 9 (offload): nightly customer metrics for josh, computed here. Read side
 * on josh's replica; josh applies the changed rows + its own tier assignment
 * via POST /api/internal/customer-metrics. If any step fails the final "done"
 * is never sent, josh's heartbeat stays old, and josh's own 03:00 cron runs as
 * before — josh never depends on this job.
 */
@Injectable()
export class CustomerMetricsOffloadJob {
  private readonly logger = new Logger(CustomerMetricsOffloadJob.name);
  private running = false;

  constructor(private readonly replica: JoshReplica) {}

  get configured() { return this.replica.configured && joshApiConfigured(); }

  private post(body: unknown) { return postToJosh<{ written?: number }>('/internal/customer-metrics', body); }

  /** Returns how many changed rows were sent; throws (and sends no "done") on any failure. */
  async run(): Promise<{ changed: number; written: number }> {
    const computedAt = new Date().toISOString();
    const rows = await this.replica.query(CHANGED_METRICS_SQL, [JOSH_ACTIVE_ORDER_STATUSES]);
    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      written += (await this.post({ computedAt, statuses: JOSH_ACTIVE_ORDER_STATUSES, rows: rows.slice(i, i + BATCH) })).written ?? 0;
    }
    await this.post({ computedAt, statuses: JOSH_ACTIVE_ORDER_STATUSES, rows: [], done: true, changed: rows.length });
    return { changed: rows.length, written };
  }

  @Cron(cronConfig.joshCustomerMetrics.expression, { timeZone: cronConfig.joshCustomerMetrics.timeZone, disabled: !cronConfig.joshCustomerMetrics.enabled })
  async scheduled() {
    if (this.running || !this.configured) return;
    this.running = true;
    const started = Date.now();
    try {
      const { changed, written } = await this.run();
      this.logger.log(`customer metrics for josh: ${changed} changed rows sent, ${written} written by josh (${Date.now() - started} ms)`);
    } catch (error) {
      this.logger.error(`customer metrics offload failed — josh's own cron will run: ${error instanceof Error ? error.message : error}`);
    } finally { this.running = false; }
  }
}
