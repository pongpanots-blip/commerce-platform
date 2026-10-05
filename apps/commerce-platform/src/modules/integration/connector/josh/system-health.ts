import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DeliveryMonitor } from '../../webhook-subscription/application/delivery-monitor';
import { JoshInsights, Range } from './josh-insights';

const COMMERCE_FAILURES_SQL = `
  SELECT (SELECT count(*) FROM webhook_deliveries WHERE status = 'failed' AND updated_at >= $1 AND updated_at < $2)::int AS deliveries_dead_lettered,
         (SELECT count(*) FROM webhook_deliveries WHERE status = 'success' AND updated_at >= $1 AND updated_at < $2)::int AS deliveries_succeeded,
         (SELECT count(*) FROM erp_ingest_records WHERE status = 'failed' AND created_at >= $1 AND created_at < $2)::int AS erp_intake_failed,
         (SELECT count(*) FROM erp_ingest_records WHERE created_at >= $1 AND created_at < $2)::int AS erp_intake_total`;

export const NO_REPLICA = { available: false, reason: 'Shop data is read from josh\'s read replica, which is not configured on this server (JOSH_DATABASE_URL).' };

/** "Is anything broken now, and what failed in a period" — one answer for the MCP tool and the admin report page. */
@Injectable()
export class SystemHealthReport {
  constructor(private readonly db: DataSource, private readonly monitor: DeliveryMonitor, private readonly insights: JoshInsights) {}

  async report(range: Range) {
    const [problemsNow, [commerce]] = await Promise.all([
      this.monitor.check(),
      this.db.query(COMMERCE_FAILURES_SQL, [range.from, range.to]),
    ]);
    let josh: unknown = NO_REPLICA;
    if (this.insights.available) {
      try { josh = await this.insights.failures(range); } catch (error) { josh = { available: false, reason: `josh replica query failed: ${error instanceof Error ? error.message : error}` }; }
    }
    return { period: range.label, now: { ok: problemsNow.length === 0, problems: problemsNow.map((p) => p.message) }, commerce, josh };
  }
}
