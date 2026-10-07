import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JoshWinback } from '../connector/josh/winback/josh-winback';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackService } from './winback.service';
import { ReportService } from './report.service';
import { MeetingPrepService } from './meeting-prep.service';
import { PoolQueryDto } from './dto/pool-query.dto';
import { revenueRisk } from './analytics.helpers';

type Source = 'replica' | 'copies';

/**
 * WINBACK_REPORTS_SOURCE: replica (default — josh's report code on josh's replica, as before) · copies (commerce's
 * own winback tables, the ones the sales app reads through `/winback/*`; works without JOSH_DATABASE_URL).
 * No shadow mode: until WINBACK_OWNER=commerce, WinbackMirror already compares every row of the six tables on both sides.
 */
export const winbackReportsSource = (): Source =>
  process.env.WINBACK_REPORTS_SOURCE?.trim().toLowerCase() === 'copies' ? 'copies' : 'replica';

/**
 * The winback manager reports behind `/reports/winback/*` and the MCP winback tools: team scope, no "me".
 * Same answers (snake_case, before `wrapWinbackResponse`) from either source. Stage 5 (S5-2).
 */
@Injectable()
export class WinbackReports {
  constructor(
    private readonly josh: JoshWinback,
    private readonly winback: WinbackService,
    private readonly reports: ReportService,
    private readonly meetingPrep: MeetingPrepService,
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
  ) {}

  get source() { return winbackReportsSource(); }
  get available() { return this.source === 'copies' || this.josh.available; }
  private get copies() { return this.source === 'copies'; }

  /** Pool counts + provinces + revenue at risk. */
  async overview() {
    if (!this.copies) return this.josh.overview();
    const [counts, provinces, risk] = await Promise.all([
      this.winback.getCounts(),
      this.winback.listProvinces(),
      this.accounts.createQueryBuilder('a').select(['a.health AS health', 'a.avg_monthly_revenue AS avg_monthly_revenue']).getRawMany(),
    ]);
    return { counts, provinces, revenueRisk: revenueRisk(risk) };
  }

  pool(q: PoolQueryDto) { return this.copies ? this.winback.findPool(q) : this.josh.pool(q); }
  aging(days = 3) { return this.copies ? this.winback.getAging(days) : this.josh.aging(days); }
  scorecard(from?: string, to?: string) { return this.copies ? this.reports.getScorecard('team', '', from, to) : this.josh.scorecard(from, to); }
  dashboard(from?: string, to?: string) { return this.copies ? this.reports.getDashboard('team', '', from, to) : this.josh.dashboard(from, to); }
  teamStats(from?: string, to?: string) { return this.copies ? this.reports.getTeamStats(from, to) : this.josh.teamStats(from, to); }
  leadSignals(salesUserId?: string, limit?: number) {
    return this.copies
      ? this.meetingPrep.getLeadSignals({ salesUserId: '', isManager: true, requestedSalesUserId: salesUserId }, limit)
      : this.josh.leadSignals(salesUserId, limit);
  }
}
