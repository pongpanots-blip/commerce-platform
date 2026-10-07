import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { cronConfig } from '../../../config/cron.config';
import { joshApiConfigured, postToJosh } from '../connector/josh/josh-api';

/**
 * josh's ACTIVE_ORDER_STATUSES (shared/enums/order-status-sets.ts). Sent with every batch; josh refuses
 * (409) a batch computed with a different list, so a drift fails loudly and josh's own cron takes over.
 */
export const JOSH_ACTIVE_ORDER_STATUSES = ['payment_pending', 'paid', 'preparing', 'shipped', 'delivered'];
const BATCH = 1000;
const COLUMNS = ['lifetime_order_count', 'lifetime_spend', 'avg_order_value', 'first_order_at', 'last_order_at', 'order_count_90d', 'spend_90d'];

/**
 * josh's CustomerMetricsService.reconcile() aggregation, over commerce's copies: josh_orders (order.snapshot) for
 * the orders and segment_customers (customer.snapshot, PDPA-deleted excluded) for who is a customer. Same set of
 * users as josh — anyone with an active order or an existing row — and a row only changes when its values do.
 */
const RECOMPUTE_SQL = `
  WITH agg AS (
    SELECT o.user_id, COUNT(*) AS n, COALESCE(SUM(o.total_price), 0) AS spend, MIN(o.create_date) AS first_at, MAX(o.create_date) AS last_at,
           COUNT(*) FILTER (WHERE o.create_date >= now() - interval '90 days') AS n90,
           COALESCE(SUM(o.total_price) FILTER (WHERE o.create_date >= now() - interval '90 days'), 0) AS spend90
    FROM josh_orders o WHERE o.status = ANY($1::text[]) AND o.user_id IS NOT NULL GROUP BY o.user_id
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
    JOIN segment_customers c ON c.id = u.user_id
    LEFT JOIN agg a ON a.user_id = u.user_id
  )
  INSERT INTO customer_metrics (user_id, ${COLUMNS.join(', ')}, computed_at)
  SELECT user_id, ${COLUMNS.join(', ')}, now() FROM calc
  ON CONFLICT (user_id) DO UPDATE SET ${COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, computed_at = now()
  WHERE (${COLUMNS.map((c) => `customer_metrics.${c}`).join(', ')}) IS DISTINCT FROM (${COLUMNS.map((c) => `EXCLUDED.${c}`).join(', ')})
  RETURNING user_id`;

// Timestamps as text: a JS Date would drop the microseconds and josh would see every row as changed.
const PUSH_SELECT = `SELECT user_id, lifetime_order_count, lifetime_spend, avg_order_value, first_order_at::text AS first_order_at,
  last_order_at::text AS last_order_at, order_count_90d, spend_90d FROM customer_metrics`;

type Mode = 'shadow' | 'on';

/**
 * Customer metrics owned by commerce (stage 2a), pushed to josh through its existing receiver
 * (POST /api/internal/customer-metrics). CUSTOMER_METRICS_TO_JOSH:
 * - off (default): computed here only;
 * - shadow: every row sent as a dry run — josh compares with its own numbers and writes nothing;
 * - on: rows changed since josh last accepted them, then `done` (josh assigns tiers, skips its own 03:00 run).
 * If anything fails no `done` is sent and josh's own cron runs as before — josh never depends on this.
 */
@Injectable()
export class CustomerMetricsService {
  private readonly logger = new Logger(CustomerMetricsService.name);
  private running = false;

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  post = (body: Record<string, unknown>) => postToJosh<{ written?: number; different?: number }>('/internal/customer-metrics', body);

  async recompute(): Promise<{ changed: string[] }> {
    return this.db.transaction(async (m) => {
      const rows: { user_id: string }[] = await m.query(RECOMPUTE_SQL, [JOSH_ACTIVE_ORDER_STATUSES]);
      // A customer deleted (PDPA) or no longer a customer: no metrics kept.
      await m.query(`DELETE FROM customer_metrics m WHERE NOT EXISTS (SELECT 1 FROM segment_customers c WHERE c.id = m.user_id)`);
      return { changed: rows.map((r) => r.user_id) };
    });
  }

  async push(mode: Mode): Promise<{ sent: number; different?: number }> {
    const computedAt = new Date().toISOString();
    const base = { computedAt, statuses: JOSH_ACTIVE_ORDER_STATUSES };
    const rows: Record<string, unknown>[] = await this.db.query(
      mode === 'shadow' ? PUSH_SELECT : `${PUSH_SELECT} WHERE pushed_at IS NULL OR computed_at > pushed_at`);
    let different = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const answer = await this.post({ ...base, rows: batch, ...(mode === 'shadow' ? { dryRun: true } : {}) });
      if (mode === 'shadow') { different += answer.different ?? 0; continue; }
      await this.db.query(`UPDATE customer_metrics SET pushed_at = $2 WHERE user_id = ANY($1::uuid[])`, [batch.map((r) => r.user_id), computedAt]);
    }
    if (mode === 'shadow') return { sent: rows.length, different };
    await this.post({ ...base, rows: [], done: true, changed: rows.length });
    return { sent: rows.length };
  }

  @Cron(cronConfig.joshCustomerMetrics.expression, { timeZone: cronConfig.joshCustomerMetrics.timeZone, disabled: !cronConfig.joshCustomerMetrics.enabled })
  async scheduled() {
    if (this.running) return;
    this.running = true;
    const started = Date.now();
    try {
      const { changed } = await this.recompute();
      const mode = process.env.CUSTOMER_METRICS_TO_JOSH;
      if ((mode === 'shadow' || mode === 'on') && joshApiConfigured()) {
        this.logger.log(`customer metrics → josh (${mode}): ${JSON.stringify(await this.push(mode))} (${Date.now() - started} ms)`);
      } else {
        this.logger.log(`customer metrics recomputed: ${changed.length} changed (${Date.now() - started} ms)`);
      }
    } catch (error) {
      this.logger.error(`customer metrics failed — josh's own cron runs: ${error instanceof Error ? error.message : error}`);
    } finally { this.running = false; }
  }
}
