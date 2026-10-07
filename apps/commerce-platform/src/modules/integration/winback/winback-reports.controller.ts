import { BadRequestException, Controller, Get, Query, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { WinbackReports } from './winback-reports';
import { wrapWinbackResponse } from './winback-response.interceptor';
import { PoolQueryDto } from './dto/pool-query.dto';
import { ScorecardQueryDto } from './dto/scorecard-query.dto';
import { LeadSignalsQueryDto } from './dto/lead-signals-query.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true });

/**
 * winback manager reports for commerce-admin (admin only — the guard default; the sales app uses `/winback/*`
 * with josh's token). Paths and answers mirror josh `GET /api/winback/*` (same `{data, meta}` camelCase envelope).
 * `scope` is always team here. Source: WINBACK_REPORTS_SOURCE (winback-reports.ts).
 */
@Controller('reports/winback')
export class WinbackReportsController {
  constructor(private readonly winback: WinbackReports) {}

  private async answer(fn: () => Promise<unknown>) {
    if (!this.winback.available) throw new ServiceUnavailableException('josh\'s read replica is not connected on this server (JOSH_DATABASE_URL) — set WINBACK_REPORTS_SOURCE=copies to read commerce\'s winback tables.');
    return wrapWinbackResponse(await fn());
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
