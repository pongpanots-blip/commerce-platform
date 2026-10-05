import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JoshReplica } from '../josh-replica';
import { RestaurantPlaces } from '../restaurant-places';
import { Order, User, WinbackAccount, WinbackActivity, WinbackMeetingAck, WinbackSalesTarget, WinbackStageHistory } from './josh-tables';
import { ReportService } from './report.service';
import { MeetingPrepService } from './meeting-prep.service';
import { WinbackPoolService } from './winback-pool.service';
import { PoolQueryDto } from './pool-query.dto';
import { revenueRisk } from './analytics.helpers';
import { toCamelCaseDeep } from './winback-camel.util';

/** josh's WinbackResponseInterceptor: `{data, meta?}` with every key camelCased — so commerce's answer diffs 1:1 with josh's. */
export function wrapWinbackResponse(payload: unknown): { data: unknown; meta?: unknown } {
  if (payload === undefined) return { data: null };
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const keys = Object.keys(payload);
    if (keys.includes('data') && keys.every((k) => k === 'data' || k === 'meta')) {
      const p = payload as { data: unknown; meta?: unknown };
      return 'meta' in p ? { data: toCamelCaseDeep(p.data), meta: toCamelCaseDeep(p.meta) } : { data: toCamelCaseDeep(p.data) };
    }
  }
  return { data: toCamelCaseDeep(payload) };
}

/**
 * josh winback (sales win-back CRM) — the manager reports, served from josh's READ REPLICA
 * by josh's own report code (copied into this folder). Read-only: every write, the rep app
 * (check-in, activities, my-day), the three notify crons and the intake form stay in josh.
 * Commerce staff see the manager view (team scope, no "me").
 */
@Injectable()
export class JoshWinback {
  constructor(private readonly replica: JoshReplica, private readonly places: RestaurantPlaces) {}

  get available() { return this.replica.configured; }

  private services(ds: DataSource) {
    const r = <T extends object>(e: new () => T) => ds.getRepository(e);
    return {
      accounts: r(WinbackAccount),
      reports: new ReportService(r(WinbackAccount), r(WinbackActivity), r(User), r(Order), r(WinbackSalesTarget)),
      meetingPrep: new MeetingPrepService(r(WinbackAccount), r(WinbackActivity), r(WinbackStageHistory), r(WinbackMeetingAck), r(User)),
      pool: new WinbackPoolService(r(WinbackAccount), this.places),
    };
  }

  private run<T>(fn: (s: ReturnType<JoshWinback['services']>) => Promise<T>) {
    return this.replica.run((ds) => fn(this.services(ds)));
  }

  /** Pool counts + provinces + revenue at risk (josh GET /pool/counts, /provinces, analytics revenueRisk). */
  overview() {
    return this.run(async (s) => {
      const [counts, provinces, risk] = await Promise.all([
        s.pool.getCounts(),
        s.pool.listProvinces(),
        s.accounts.createQueryBuilder('a').select(['a.health AS health', 'a.avg_monthly_revenue AS avg_monthly_revenue']).getRawMany(),
      ]);
      return { counts, provinces, revenueRisk: revenueRisk(risk) };
    });
  }

  pool(q: PoolQueryDto) { return this.run((s) => s.pool.findPool(q)); }
  aging(days = 3) { return this.run((s) => s.pool.getAging(days)); }
  scorecard(from?: string, to?: string) { return this.run((s) => s.reports.getScorecard('team', '', from, to)); }
  dashboard(from?: string, to?: string) { return this.run((s) => s.reports.getDashboard('team', '', from, to)); }
  teamStats(from?: string, to?: string) { return this.run((s) => s.reports.getTeamStats(from, to)); }
  leadSignals(salesUserId?: string, limit?: number) {
    return this.run((s) => s.meetingPrep.getLeadSignals({ salesUserId: '', isManager: true, requestedSalesUserId: salesUserId }, limit));
  }
}
