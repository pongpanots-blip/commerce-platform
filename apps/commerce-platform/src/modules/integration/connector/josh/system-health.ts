import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DeliveryMonitor } from '../../webhook-subscription/application/delivery-monitor';
import { JoshInsights, Range } from './josh-insights';
import { JoshErpLogs } from './josh-erp-logs';

const COMMERCE_FAILURES_SQL = `
  SELECT (SELECT count(*) FROM webhook_deliveries WHERE status = 'failed' AND updated_at >= $1 AND updated_at < $2)::int AS deliveries_dead_lettered,
         (SELECT count(*) FROM webhook_deliveries WHERE status = 'success' AND updated_at >= $1 AND updated_at < $2)::int AS deliveries_succeeded,
         (SELECT count(*) FROM erp_ingest_records WHERE status = 'failed' AND created_at >= $1 AND created_at < $2)::int AS erp_intake_failed,
         (SELECT count(*) FROM erp_ingest_records WHERE created_at >= $1 AND created_at < $2)::int AS erp_intake_total`;

/** josh's ERP-send failures from commerce's copy of `jagota_order_sync` — same filters as josh-insights' replica SQL. */
const JAGOTA_COPY_FAILED_SQL = `SELECT count(*)::int AS n, max(imported_at) AS copied_up_to FROM jagota_order_sync_history
  WHERE sync_status = 'failed' AND created_at >= $1 AND created_at < $2`;
const JAGOTA_COPY_ERRORS_SQL = `SELECT left(error_message, 200) AS error, count(*)::int AS n, max(created_at) AS last_at FROM jagota_order_sync_history
  WHERE sync_status = 'failed' AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
const JAGOTA_COPY_FRESHNESS_SQL = `SELECT max(imported_at) AS copied_up_to FROM jagota_order_sync_history`;

export const NO_REPLICA = { available: false, reason: 'Shop data is read from josh\'s read replica, which is not configured on this server (JOSH_DATABASE_URL).' };

/** "Is anything broken now, and what failed in a period" — one answer for the MCP tool and the admin report page. */
@Injectable()
export class SystemHealthReport {
  constructor(private readonly db: DataSource, private readonly monitor: DeliveryMonitor, private readonly insights: JoshInsights, private readonly erpLogs: JoshErpLogs) {}

  async report(range: Range) {
    const [problemsNow, [commerce]] = await Promise.all([
      this.monitor.check(),
      this.db.query(COMMERCE_FAILURES_SQL, [range.from, range.to]),
    ]);
    let josh: unknown = NO_REPLICA;
    if (this.insights.available) {
      try { josh = await this.insights.failures(range); } catch (error) { josh = { available: false, reason: `josh replica query failed: ${error instanceof Error ? error.message : error}` }; }
    } else {
      josh = await this.joshFromCopies(range).catch((error) => ({ ...NO_REPLICA, reason: `${NO_REPLICA.reason} commerce's ERP-send copy failed too: ${error instanceof Error ? error.message : error}` }));
    }
    let joshErpInbound: unknown = { available: false, reason: 'josh\'s log database is not connected (JOSH_MONGO_URL).' };
    if (this.erpLogs.configured) {
      try { joshErpInbound = await this.erpLogs.summary(range.from, range.to); } catch (error) { joshErpInbound = { available: false, reason: `josh log query failed: ${error instanceof Error ? error.message : error}` }; }
    }
    return { period: range.label, now: { ok: problemsNow.length === 0, problems: problemsNow.map((p) => p.message) }, commerce, josh, joshErpInbound };
  }

  /**
   * Without the replica (stage 5, S5-9): the ERP-send part from `jagota_order_sync_history` — only as fresh as its last
   * import (`jagotaSyncImport` reads the replica; events for it are S5-11). Payments, workflow runs and push campaigns
   * are josh's own health: josh-admin shows them.
   */
  private async joshFromCopies(range: Range) {
    const [[failed], errors, [fresh]] = await Promise.all([
      this.db.query(JAGOTA_COPY_FAILED_SQL, [range.from, range.to]),
      this.db.query(JAGOTA_COPY_ERRORS_SQL, [range.from, range.to]),
      this.db.query(JAGOTA_COPY_FRESHNESS_SQL),
    ]);
    const upTo = fresh?.copied_up_to ? new Date(fresh.copied_up_to).toISOString() : null;
    return {
      source: 'commerce copy (jagota_order_sync_history)',
      copiedUpTo: upTo,
      counts: { jagota_order_sync_failed: failed?.n ?? 0 },
      jagotaOrderSyncErrors: errors,
      notAvailable: `ERP sends from commerce's copy, imported up to ${upTo ?? 'never'}. Failed payments, marketing workflow runs and push campaigns are josh's own health — see josh-admin (JOSH_DATABASE_URL is not set here).`,
    };
  }
}
