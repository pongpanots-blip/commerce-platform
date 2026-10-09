import { SalesRepIdentity } from '../../core/auth/application/sales-rep-identity.service';
import { OpportunityService } from './opportunity.service';
import { WinbackService } from './winback.service';
import { OpportunityQueryDto } from './dto/app-gaps.dto';
import { BadRequestException, Controller, Get, Query, Req, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { StaffRoles, StaffRequest } from '../../../shared-kernel/presentation/auth.decorators';
import { WinbackReports } from './winback-reports';
import { wrapWinbackResponse } from './winback-response.interceptor';
import { PoolQueryDto } from './dto/pool-query.dto';
import { ScorecardQueryDto } from './dto/scorecard-query.dto';
import { LeadSignalsQueryDto } from './dto/lead-signals-query.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AnalyticsService } from './analytics.service';
import { JoshMatchService } from './josh-match.service';
import { EnrichMatchQueryDto } from './dto/enrich-match-query.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true });

/**
 * winback manager reports for commerce-admin (admin, sales manager, business analyst — the sales app uses `/winback/*`
 * with josh's token). Paths and answers mirror josh `GET /api/winback/*` (same `{data, meta}` camelCase envelope).
 * Existing reports use team scope and WINBACK_REPORTS_SOURCE. Opportunity / my reads use commerce tables;
 * my routes override the class role list and enforce own + unassigned visibility.
 */
@Controller('reports/winback')
@StaffRoles('sales_manager', 'business_analyst')
export class WinbackReportsController {
  constructor(private readonly winback: WinbackReports, private readonly identity: SalesRepIdentity, private readonly opportunities: OpportunityService, private readonly poolService: WinbackService, private readonly analytics: AnalyticsService, private readonly joshMatch: JoshMatchService) {}

  private async answer(fn: () => Promise<unknown>) {
    if (!this.winback.available) throw new ServiceUnavailableException('josh\'s read replica is not connected on this server (JOSH_DATABASE_URL) — set WINBACK_REPORTS_SOURCE=copies to read commerce\'s winback tables.');
    return wrapWinbackResponse(await fn());
  }

  /** These reads use commerce's winback tables, independent of the team reports' source flag. */
  private async saleActor(req: StaffRequest) {
    const ids = await this.identity.repIdsFor(req.staff);
    return { id: ids[0] ?? '', ids, isManager: req.staff.role === 'admin' };
  }

  @Get('opportunities')
  async teamOpportunities(@Query(pipe) q: OpportunityQueryDto) {
    return wrapWinbackResponse(await this.opportunities.list({ id: '', isManager: true }, q));
  }

  @Get('my/opportunities') @StaffRoles('sale')
  async myOpportunities(@Req() req: StaffRequest, @Query(pipe) q: OpportunityQueryDto) {
    return wrapWinbackResponse(await this.opportunities.list(await this.saleActor(req), q));
  }

  @Get('my/pool') @StaffRoles('sale')
  async myPool(@Req() req: StaffRequest, @Query(pipe) q: PoolQueryDto) {
    return wrapWinbackResponse(await this.poolService.findPool(q, await this.saleActor(req), true));
  }

  /** Field visits: rep GPS at check-in/out against the customer's pin, per visit and per rep (commerce tables). */
  @Get('gps-visits')
  async gpsVisits(@Query(pipe) q: AnalyticsQueryDto) {
    return wrapWinbackResponse(await this.analytics.getVisitGps({ id: '', isManager: true }, q.from, q.to, q.sales_user_id));
  }

  /** Leads captured from enriched Market Explorer places: does each match a Josh customer (counts per status + a page). */
  @Get('enrich-match')
  async enrichMatch(@Query(pipe) q: EnrichMatchQueryDto) {
    return wrapWinbackResponse(await this.joshMatch.enrichReport(q));
  }

  @Get('overview') overview() { return this.answer(() => this.winback.overview()); }
  @Get('pool') pool(@Query(pipe) q: PoolQueryDto) { return this.answer(() => this.winback.pool(q)); }
  @Get('aging') aging(@Query('days') days?: string) {
    const n = days === undefined || days === '' ? 3 : Number(days);
    if (!Number.isInteger(n) || n < 0 || n > 365) throw new BadRequestException('days must be an integer 0-365');
    return this.answer(() => this.winback.aging(n));
  }
  @Get('scorecard') scorecard(@Query(pipe) q: ScorecardQueryDto) { return this.answer(() => this.winback.scorecard(q.from, q.to)); }
  @Get('dashboard') dashboard(@Query(pipe) q: ScorecardQueryDto) { return this.answer(() => this.winback.dashboard(q.from, q.to)); }
  @Get('team-stats') teamStats(@Query(pipe) q: ScorecardQueryDto) { return this.answer(() => this.winback.teamStats(q.from, q.to)); }
  @Get('lead-signals') leadSignals(@Query(pipe) q: LeadSignalsQueryDto) { return this.answer(() => this.winback.leadSignals(q.sales_user_id, q.limit)); }
}
