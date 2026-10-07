import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { JoshOrder as Order } from './josh-copies.entity';
import { JoshUser as User } from './josh-copies.entity';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackSalesTarget } from './entities/winback-sales-target.entity';
import { WinbackStageHistory } from './entities/winback-stage-history.entity';
import {
  assignAccountSequences,
  assignDailySequences,
  avgVisitMinutes,
  countByKey,
  gpsVisitRate,
  PIPELINE_CONVERSION_STAGES,
  revenueRisk,
  stageConversion,
  weekBuckets,
} from './analytics.helpers';
import {
  DASHBOARD_ORDER_STATUSES,
  defaultDashboardRange,
  roundBaht,
} from './dashboard.helpers';
import { UpsertTargetDto } from './dto/upsert-target.dto';
import { isWon } from './report.helpers';
import { ReportService } from './report.service';
import { WinbackService } from './winback.service';
import { WINBACK_ASSIGNABLE_ROLES } from './winback-roles';

export type TargetRow = {
  id: string;
  sales_user_id: string;
  period_month: string;
  gmv_target: number;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type Requester = { id: string; isManager: boolean };

type RepRow = {
  sales_user_id: string;
  name: string | null;
  email: string | null;
};

export type TeamLocation = RepRow & {
  lat: number;
  lng: number;
  activity_id: string;
  account_id: string;
  account_name: string | null;
  activity_type: string;
  checkin_at: string | null;
  activity_at: string;
  visit_n: number;
  daily_k: number;
  is_today: boolean;
};

export type TeamActivityFeedRow = RepRow & {
  activity_id: string;
  activity_at: string;
  type: string;
  outcome: string | null;
  account_id: string;
  account_name: string | null;
  visit_n: number;
  daily_k: number;
  stage_after: string | null;
};

type AnalyticsAccount = {
  id: string;
  customer_code: string;
  stage: string;
  health: string;
  lifecycle: string;
  lead_source: string | null;
  reject_reason: string | null;
  assigned_sales_user_id: string | null;
  created_by_sales_user_id: string | null;
  create_date: Date;
  promoted_to_lead_at: Date | null;
  reactivated_at: Date | null;
  /** Monthly revenue while ordering — the figure revenue-at-risk is built from. */
  avg_monthly_revenue: number | string | null;
};

type AnalyticsPerRep = RepRow & {
  lead_count: number;
  open_count: number;
  signed_count: number;
  conversion_rate: number;
  activities: number;
  won: number;
  gmv: number;
  target: number | null;
  achievement_pct: number | null;
};

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(WinbackSalesTarget)
    private readonly targets: Repository<WinbackSalesTarget>,
    @InjectRepository(WinbackActivity)
    private readonly activities: Repository<WinbackActivity>,
    @InjectRepository(WinbackAccount)
    private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(WinbackStageHistory)
    private readonly stageHistory: Repository<WinbackStageHistory>,
    private readonly reports: ReportService,
    private readonly winback: WinbackService,
  ) {}

  async listTargets(
    periodMonth: string,
    requester: { id: string; isManager: boolean },
  ): Promise<TargetRow[]> {
    if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
      throw new BadRequestException('period_month must be YYYY-MM');
    }

    const targets = await this.targets.find({
      where: {
        period_month: periodMonth,
        ...(requester.isManager ? {} : { sales_user_id: requester.id }),
      },
      order: { sales_user_id: 'ASC' },
    });
    return targets.map((target) => this.toTargetRow(target));
  }

  async upsertTarget(
    dto: UpsertTargetDto,
    createdBy: string,
    isManager: boolean,
  ): Promise<TargetRow> {
    if (!isManager) {
      throw new ForbiddenException('เฉพาะ manager ที่ตั้งเป้ายอดขายได้');
    }
    if (dto.gmv_target < 0) {
      throw new BadRequestException('gmv_target must be greater than or equal to 0');
    }

    await this.targets
      .createQueryBuilder()
      .insert()
      .into(WinbackSalesTarget)
      .values({
        sales_user_id: dto.sales_user_id,
        period_month: dto.period_month,
        gmv_target: dto.gmv_target,
        created_by: createdBy,
      })
      .orUpdate(
        ['gmv_target', 'updated_at'],
        ['sales_user_id', 'period_month'],
      )
      .execute();

    const target = await this.targets.findOneByOrFail({
      sales_user_id: dto.sales_user_id,
      period_month: dto.period_month,
    });
    return this.toTargetRow(target);
  }

  async getTeamLocations(
    requester: Requester,
    filterSalesUserId?: string,
  ): Promise<{ locations: TeamLocation[]; repsWithoutLocation: RepRow[] }> {
    let reps = await this.visibleReps(requester);
    if (filterSalesUserId && requester.isManager) {
      reps = reps.filter((rep) => rep.sales_user_id === filterSalesUserId);
    }
    const visibleIds = reps.map((rep) => rep.sales_user_id);
    if (!visibleIds.length) return { locations: [], repsWithoutLocation: [] };

    const gpsActivities = await this.activities.find({
      where: {
        sales_user_id: In(visibleIds),
        status: 'done',
        lat: Not(IsNull()),
        lng: Not(IsNull()),
      },
      order: { activity_at: 'DESC', id: 'DESC' },
    });
    const latestByRep = new Map<string, WinbackActivity>();
    for (const activity of gpsActivities) {
      if (!latestByRep.has(activity.sales_user_id)) {
        latestByRep.set(activity.sales_user_id, activity);
      }
    }

    const latest = [...latestByRep.values()];
    const { accountSequences, dailySequences } =
      await this.sequenceMaps(latest);
    const accountsById = await this.accountNames(
      latest.map((activity) => activity.account_id),
    );
    const repById = new Map(reps.map((rep) => [rep.sales_user_id, rep]));
    const today = this.localDayKey(new Date());

    const locations = latest.map((activity): TeamLocation => {
      const rep = repById.get(activity.sales_user_id);
      return {
        sales_user_id: activity.sales_user_id,
        name: rep?.name ?? null,
        email: rep?.email ?? null,
        lat: Number(activity.lat),
        lng: Number(activity.lng),
        activity_id: activity.id,
        account_id: activity.account_id,
        account_name: accountsById.get(activity.account_id) ?? null,
        activity_type: activity.type,
        checkin_at: activity.checkin_at
          ? new Date(activity.checkin_at).toISOString()
          : null,
        activity_at: new Date(activity.activity_at).toISOString(),
        visit_n: accountSequences.get(activity.id) ?? 0,
        daily_k: dailySequences.get(activity.id) ?? 0,
        is_today: this.localDayKey(new Date(activity.activity_at)) === today,
      };
    });
    const repsWithoutLocation = reps.filter(
      (rep) => !latestByRep.has(rep.sales_user_id),
    );
    return { locations, repsWithoutLocation };
  }

  async getTeamActivityFeed(
    requester: Requester,
    from?: string,
    to?: string,
    filterSalesUserId?: string,
  ): Promise<TeamActivityFeedRow[]> {
    const reps = await this.visibleReps(requester);
    let visibleIds = reps.map((rep) => rep.sales_user_id);
    if (filterSalesUserId && requester.isManager) {
      visibleIds = visibleIds.includes(filterSalesUserId)
        ? [filterSalesUserId]
        : [];
    }
    if (!visibleIds.length) return [];

    const range = this.activityRange(from, to);
    const feed = await this.activities.find({
      where: {
        sales_user_id: In(visibleIds),
        status: 'done',
        activity_at: Between(range.from, range.to),
      },
      order: { activity_at: 'DESC', id: 'DESC' },
    });
    if (!feed.length) return [];

    const { accountSequences, dailySequences } =
      await this.sequenceMaps(feed);
    const accountsById = await this.accountNames(
      feed.map((activity) => activity.account_id),
    );
    const repById = new Map(reps.map((rep) => [rep.sales_user_id, rep]));

    return feed.map((activity): TeamActivityFeedRow => {
      const rep = repById.get(activity.sales_user_id);
      return {
        activity_id: activity.id,
        activity_at: new Date(activity.activity_at).toISOString(),
        sales_user_id: activity.sales_user_id,
        name: rep?.name ?? null,
        email: rep?.email ?? null,
        type: activity.type,
        outcome: activity.outcome,
        account_id: activity.account_id,
        account_name: accountsById.get(activity.account_id) ?? null,
        visit_n: accountSequences.get(activity.id) ?? 0,
        daily_k: dailySequences.get(activity.id) ?? 0,
        stage_after: activity.stage_after,
      };
    });
  }

  async getAnalytics(
    scope: 'team' | 'me',
    salesUserId: string,
    from?: string,
    to?: string,
    filterSalesUserId?: string,
  ) {
    const range = this.analyticsRange(from, to);
    const effectiveSalesUserId =
      scope === 'team' && filterSalesUserId ? filterSalesUserId : salesUserId;
    const effectiveScope: 'team' | 'me' =
      scope === 'team' && !filterSalesUserId ? 'team' : 'me';

    if (scope === 'team' && filterSalesUserId) {
      const visibleIds = (await this.visibleReps({ id: salesUserId, isManager: true })).map(
        (rep) => rep.sales_user_id,
      );
      if (!visibleIds.includes(filterSalesUserId)) {
        return this.emptyAnalytics(range);
      }
    }

    const [allAccounts, activities, dashboard, agingRows] = await Promise.all([
      this.analyticsAccounts(effectiveScope, effectiveSalesUserId),
      this.analyticsActivities(effectiveScope, effectiveSalesUserId, range),
      this.reports.getDashboard(
        effectiveScope,
        effectiveSalesUserId,
        range.from.toISOString(),
        range.to.toISOString(),
      ),
      this.winback.getAging(3),
    ]);
    const periodAccounts = allAccounts.filter((account) =>
      this.inRange(account.create_date, range),
    );
    const reactivatedAccounts = allAccounts.filter(
      (account) =>
        account.reactivated_at && this.inRange(account.reactivated_at, range),
    );
    const periodMonth = this.localMonthKey(range.to);
    const repIds = await this.analyticsRepIds(
      effectiveScope,
      effectiveSalesUserId,
      periodAccounts,
      activities,
    );

    const [targets, attributedOrders, dwell] = await Promise.all([
      repIds.length
        ? this.targets.find({
            where: {
              period_month: periodMonth,
              sales_user_id: In(repIds),
            },
          })
        : Promise.resolve([]),
      this.orderRows(
        reactivatedAccounts.map((account) => account.customer_code),
        range,
      ),
      this.buildDwell(
        allAccounts.map((account) => account.id),
        range,
      ),
    ]);

    const funnel: Record<string, number> = {};
    for (const stage of PIPELINE_CONVERSION_STAGES) funnel[stage] = 0;
    for (const account of periodAccounts) {
      funnel[account.stage] = (funnel[account.stage] ?? 0) + 1;
    }
    const won = periodAccounts.filter((account) =>
      isWon(account.stage, account.health),
    ).length;
    const tmpCohort = periodAccounts.filter(
      (account) =>
        account.lifecycle === 'tmp' || account.promoted_to_lead_at != null,
    );
    const promoted = tmpCohort.filter(
      (account) =>
        account.promoted_to_lead_at &&
        this.inRange(account.promoted_to_lead_at, range),
    ).length;
    const tmpCreated = tmpCohort.length;
    const targetByRep = new Map(
      targets.map((target) => [target.sales_user_id, Number(target.gmv_target)]),
    );
    const totalTarget = roundBaht(
      targets.reduce((sum, target) => sum + Number(target.gmv_target), 0),
    );
    const portfolioGmv = roundBaht(Number(dashboard.gmv) || 0);
    const attributedGmv = roundBaht(
      attributedOrders.reduce((sum, order) => sum + order.gmv, 0),
    );
    const targetConfigured = targets.length > 0;
    const accountIds = new Set(allAccounts.map((account) => account.id));
    const agingCount =
      effectiveScope === 'team'
        ? agingRows.length
        : agingRows.filter((row) => accountIds.has(row.id)).length;
    const visitRows = activities.filter((activity) =>
      ['visit', 'store_visit'].includes(activity.type),
    );
    const visitDuration = avgVisitMinutes(visitRows);
    const visitGps = gpsVisitRate(visitRows);

    return {
      period: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      kpis: {
        reactivation: {
          total: periodAccounts.length,
          won,
          rate: this.rate(won, periodAccounts.length),
        },
        conversion: stageConversion(funnel, PIPELINE_CONVERSION_STAGES),
        tmpToLead: {
          tmpCreated,
          promoted,
          rate: this.rate(promoted, tmpCreated),
        },
        attributedGmv,
        agingCount,
        // Whole portfolio, not the selected period: a customer is at risk today
        // regardless of which date range the manager is looking at.
        revenueRisk: revenueRisk(allAccounts),
        achievement: {
          gmv: portfolioGmv,
          target: totalTarget,
          gap: roundBaht(totalTarget - portfolioGmv),
          target_configured: targetConfigured,
          pct: targetConfigured ? this.rate(portfolioGmv, totalTarget) : null,
        },
      },
      outcomeByType: countByKey(
        activities.map((activity) => ({ key: activity.outcome })),
      ),
      rejectMix: countByKey(
        periodAccounts
          .filter((account) => ['rejected', 'lost'].includes(account.stage))
          .map((account) => ({ key: account.reject_reason })),
      ),
      byLeadSource: this.byLeadSource(periodAccounts),
      visitQuality: {
        avgMinutes: visitDuration.avg,
        sample: visitDuration.sample,
        gpsRate: visitGps.rate,
        visitTotal: visitGps.total,
      },
      trends: this.buildTrends(
        range,
        periodAccounts,
        activities,
        attributedOrders,
      ),
      dwell,
      perRep: await this.buildAnalyticsPerRep(
        repIds,
        periodAccounts,
        activities,
        dashboard.by_person,
        targetByRep,
      ),
    };
  }

  private async visibleReps(requester: Requester): Promise<RepRow[]> {
    const users = requester.isManager
      ? await this.users.find({
          where: {
            role: In([...WINBACK_ASSIGNABLE_ROLES]),
            is_active: true,
          },
          select: ['id', 'email', 'first_name', 'last_name'],
          take: 200,
          order: { first_name: 'ASC', last_name: 'ASC' },
        })
      : await this.users.find({
          where: { id: requester.id },
          select: ['id', 'email', 'first_name', 'last_name'],
          take: 1,
        });

    if (!requester.isManager && !users.length) {
      return [{ sales_user_id: requester.id, name: null, email: null }];
    }
    return users.map((user) => ({
      sales_user_id: user.id,
      email: user.email ?? null,
      name:
        [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
        user.email ||
        null,
    }));
  }

  private analyticsRange(
    from?: string,
    to?: string,
  ): { from: Date; to: Date } {
    const defaults = defaultDashboardRange();
    const parsed = this.activityRange(from ?? defaults.from, to ?? defaults.to);
    return { from: parsed.from, to: parsed.to };
  }

  private async analyticsAccounts(
    scope: 'team' | 'me',
    salesUserId: string,
  ): Promise<AnalyticsAccount[]> {
    const qb = this.accounts.createQueryBuilder('a').select([
      'a.id AS id',
      'a.customer_code AS customer_code',
      'a.stage AS stage',
      'a.health AS health',
      'a.lifecycle AS lifecycle',
      'a.lead_source AS lead_source',
      'a.reject_reason AS reject_reason',
      'a.assigned_sales_user_id AS assigned_sales_user_id',
      'a.created_by_sales_user_id AS created_by_sales_user_id',
      'a.create_date AS create_date',
      'a.promoted_to_lead_at AS promoted_to_lead_at',
      'a.reactivated_at AS reactivated_at',
      'a.avg_monthly_revenue AS avg_monthly_revenue',
    ]);
    if (scope === 'me') {
      qb.where(
        '(a.assigned_sales_user_id = :uid OR a.created_by_sales_user_id = :uid)',
        { uid: salesUserId || '' },
      );
    }
    const rows = await qb.getRawMany<AnalyticsAccount>();
    return rows.map((row) => ({
      ...row,
      create_date: new Date(row.create_date),
      promoted_to_lead_at: row.promoted_to_lead_at
        ? new Date(row.promoted_to_lead_at)
        : null,
      reactivated_at: row.reactivated_at
        ? new Date(row.reactivated_at)
        : null,
    }));
  }

  private async analyticsActivities(
    scope: 'team' | 'me',
    salesUserId: string,
    range: { from: Date; to: Date },
  ): Promise<WinbackActivity[]> {
    return this.activities.find({
      where: {
        ...(scope === 'me' ? { sales_user_id: salesUserId } : {}),
        status: 'done',
        activity_at: Between(range.from, range.to),
      },
      order: { activity_at: 'ASC', id: 'ASC' },
    });
  }

  private async analyticsRepIds(
    scope: 'team' | 'me',
    salesUserId: string,
    accounts: AnalyticsAccount[],
    activities: WinbackActivity[],
  ): Promise<string[]> {
    if (scope === 'me') return salesUserId ? [salesUserId] : [];
    const reps = await this.visibleReps({ id: salesUserId, isManager: true });
    return [
      ...new Set([
        ...reps.map((rep) => rep.sales_user_id),
        ...accounts
          .map((account) => account.assigned_sales_user_id)
          .filter((id): id is string => Boolean(id)),
        ...activities.map((activity) => activity.sales_user_id),
      ]),
    ];
  }

  private async orderRows(
    customerCodes: string[],
    range: { from: Date; to: Date },
  ): Promise<{ code: string; gmv: number; create_date: Date }[]> {
    const codes = [
      ...new Set(
        customerCodes
          .map((code) => (code || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    const output: { code: string; gmv: number; create_date: Date }[] = [];
    for (let index = 0; index < codes.length; index += 500) {
      const chunk = codes.slice(index, index + 500);
      const rows = await this.orders
        .createQueryBuilder('o')
        .select('UPPER(TRIM(o.customer_code))', 'code')
        .addSelect('o.total_price', 'gmv')
        .addSelect('o.create_date', 'create_date')
        .where('UPPER(TRIM(o.customer_code)) IN (:...codes)', { codes: chunk })
        .andWhere('o.status IN (:...statuses)', {
          statuses: [...DASHBOARD_ORDER_STATUSES],
        })
        .andWhere('o.create_date BETWEEN :from AND :to', {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        })
        .getRawMany<{ code: string; gmv: string; create_date: string }>();
      output.push(
        ...rows.map((row) => ({
          code: row.code,
          gmv: Number(row.gmv) || 0,
          create_date: new Date(row.create_date),
        })),
      );
    }
    return output;
  }

  private async buildDwell(
    accountIds: string[],
    range: { from: Date; to: Date },
  ): Promise<{ stage: string; avgDays: number | null; sample: number }[]> {
    if (!accountIds.length) return [];
    const history = await this.stageHistory.find({
      where: {
        account_id: In(accountIds),
        changed_at: LessThanOrEqual(range.to),
      },
      order: { account_id: 'ASC', changed_at: 'ASC', id: 'ASC' },
    });
    const byStage = new Map<string, number[]>();
    const previousByAccount = new Map<string, WinbackStageHistory>();
    for (const row of history) {
      const previous = previousByAccount.get(row.account_id);
      if (
        previous &&
        row.from_stage &&
        this.inRange(row.changed_at, range)
      ) {
        const days =
          (new Date(row.changed_at).getTime() -
            new Date(previous.changed_at).getTime()) /
          86_400_000;
        if (days >= 0) {
          const samples = byStage.get(row.from_stage) ?? [];
          samples.push(days);
          byStage.set(row.from_stage, samples);
        }
      }
      previousByAccount.set(row.account_id, row);
    }
    return [...byStage.entries()]
      .map(([stage, samples]) => ({
        stage,
        avgDays:
          samples.length > 0
            ? Math.round(
                (samples.reduce((sum, value) => sum + value, 0) /
                  samples.length) *
                  10,
              ) / 10
            : null,
        sample: samples.length,
      }))
      .sort((a, b) => a.stage.localeCompare(b.stage));
  }

  private byLeadSource(accounts: AnalyticsAccount[]) {
    const grouped = new Map<string, { total: number; won: number }>();
    for (const account of accounts) {
      const source = account.lead_source ?? 'unknown';
      const current = grouped.get(source) ?? { total: 0, won: 0 };
      current.total += 1;
      if (isWon(account.stage, account.health)) current.won += 1;
      grouped.set(source, current);
    }
    return [...grouped.entries()]
      .map(([source, value]) => ({
        source,
        total: value.total,
        won: value.won,
        rate: this.rate(value.won, value.total),
      }))
      .sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));
  }

  private buildTrends(
    range: { from: Date; to: Date },
    accounts: AnalyticsAccount[],
    activities: WinbackActivity[],
    orders: { create_date: Date; gmv: number }[],
  ) {
    return weekBuckets(range.from, range.to).map((bucket) => {
      const weeklyAccounts = accounts.filter((account) =>
        this.inRange(account.create_date, bucket),
      );
      const weeklyWon = weeklyAccounts.filter((account) =>
        isWon(account.stage, account.health),
      ).length;
      return {
        week: bucket.key,
        attributedGmv: roundBaht(
          orders
            .filter((order) => this.inRange(order.create_date, bucket))
            .reduce((sum, order) => sum + order.gmv, 0),
        ),
        reactivationRate: this.rate(weeklyWon, weeklyAccounts.length),
        activityCount: activities.filter((activity) =>
          this.inRange(activity.activity_at, bucket),
        ).length,
      };
    });
  }

  private async buildAnalyticsPerRep(
    repIds: string[],
    accounts: AnalyticsAccount[],
    activities: WinbackActivity[],
    dashboardRows: {
      sales_user_id: string;
      name: string | null;
      email: string | null;
      gmv: number;
    }[],
    targetByRep: Map<string, number>,
  ): Promise<AnalyticsPerRep[]> {
    if (!repIds.length) return [];
    const users = await this.users.find({
      where: { id: In(repIds) },
      select: ['id', 'email', 'first_name', 'last_name'],
    });
    const userById = new Map(
      users.map((user) => [
        user.id,
        {
          email: user.email ?? null,
          name:
            [user.first_name, user.last_name]
              .filter(Boolean)
              .join(' ')
              .trim() ||
            user.email ||
            null,
        },
      ]),
    );
    const dashboardByRep = new Map(
      dashboardRows.map((row) => [row.sales_user_id, row]),
    );
    const closed = new Set([
      'signed',
      'won',
      'reactivated',
      'ordering_again',
    ]);
    const rejected = new Set(['rejected', 'lost']);

    return repIds
      .map((id): AnalyticsPerRep => {
        const owned = accounts.filter(
          (account) =>
            account.assigned_sales_user_id === id ||
            (!account.assigned_sales_user_id &&
              account.created_by_sales_user_id === id),
        );
        const signed = owned.filter(
          (account) =>
            closed.has(account.stage) ||
            isWon(account.stage, account.health),
        ).length;
        const rejectedCount = owned.filter((account) =>
          rejected.has(account.stage),
        ).length;
        const wonCount = owned.filter((account) =>
          isWon(account.stage, account.health),
        ).length;
        const dashboard = dashboardByRep.get(id);
        const info = userById.get(id);
        const target = targetByRep.get(id) ?? null;
        const gmv = roundBaht(Number(dashboard?.gmv) || 0);
        return {
          sales_user_id: id,
          name: info?.name ?? dashboard?.name ?? null,
          email: info?.email ?? dashboard?.email ?? null,
          lead_count: owned.length,
          open_count: Math.max(0, owned.length - signed - rejectedCount),
          signed_count: signed,
          conversion_rate: this.rate(signed, owned.length),
          activities: activities.filter(
            (activity) => activity.sales_user_id === id,
          ).length,
          won: wonCount,
          gmv,
          target,
          achievement_pct:
            target == null ? null : this.rate(gmv, target),
        };
      })
      .sort(
        (a, b) =>
          b.gmv - a.gmv ||
          b.lead_count - a.lead_count ||
          (a.name ?? '').localeCompare(b.name ?? ''),
      );
  }

  private emptyAnalytics(range: { from: Date; to: Date }) {
    return {
      period: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      kpis: {
        reactivation: { total: 0, won: 0, rate: 0 },
        conversion: stageConversion({}, PIPELINE_CONVERSION_STAGES),
        tmpToLead: { tmpCreated: 0, promoted: 0, rate: 0 },
        attributedGmv: 0,
        agingCount: 0,
        revenueRisk: revenueRisk([]),
        achievement: {
          gmv: 0,
          target: 0,
          gap: 0,
          target_configured: false,
          pct: null,
        },
      },
      outcomeByType: {},
      rejectMix: {},
      byLeadSource: [],
      visitQuality: {
        avgMinutes: null,
        sample: 0,
        gpsRate: 0,
        visitTotal: 0,
      },
      trends: weekBuckets(range.from, range.to).map((bucket) => ({
        week: bucket.key,
        attributedGmv: 0,
        reactivationRate: 0,
        activityCount: 0,
      })),
      dwell: [],
      perRep: [],
    };
  }

  private inRange(
    value: Date | string,
    range: { from: Date; to: Date } | { start: Date; end: Date },
  ): boolean {
    const time = new Date(value).getTime();
    const from = 'from' in range ? range.from : range.start;
    const to = 'to' in range ? range.to : range.end;
    return time >= from.getTime() && time <= to.getTime();
  }

  private rate(part: number, whole: number): number {
    if (!whole || whole <= 0) return 0;
    return Math.round((part / whole) * 1000) / 10;
  }

  private localMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private async sequenceMaps(seed: WinbackActivity[]): Promise<{
    accountSequences: Map<string, number>;
    dailySequences: Map<string, number>;
  }> {
    if (!seed.length) {
      return {
        accountSequences: new Map<string, number>(),
        dailySequences: new Map<string, number>(),
      };
    }
    const accountIds = [...new Set(seed.map((activity) => activity.account_id))];
    const salesUserIds = [
      ...new Set(seed.map((activity) => activity.sales_user_id)),
    ];
    const dates = seed.map((activity) => new Date(activity.activity_at));
    const dayFrom = this.startOfLocalDay(
      new Date(Math.min(...dates.map((date) => date.getTime()))),
    );
    const dayTo = this.endOfLocalDay(
      new Date(Math.max(...dates.map((date) => date.getTime()))),
    );

    const [accountHistory, dailyHistory] = await Promise.all([
      this.activities.find({
        where: { account_id: In(accountIds), status: 'done' },
        order: { activity_at: 'ASC', id: 'ASC' },
      }),
      this.activities.find({
        where: {
          sales_user_id: In(salesUserIds),
          status: 'done',
          activity_at: Between(dayFrom, dayTo),
        },
        order: { activity_at: 'ASC', id: 'ASC' },
      }),
    ]);
    return {
      accountSequences: assignAccountSequences(accountHistory),
      dailySequences: assignDailySequences(
        dailyHistory,
        (date) => this.localDayKey(date),
      ),
    };
  }

  private async accountNames(ids: string[]): Promise<Map<string, string | null>> {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return new Map();
    const accounts = await this.accounts.find({
      where: { id: In(uniqueIds) },
      select: ['id', 'display_name'],
    });
    return new Map(
      accounts.map((account) => [account.id, account.display_name]),
    );
  }

  private activityRange(from?: string, to?: string): { from: Date; to: Date } {
    const anchor = from ?? to;
    const anchorDate = anchor ? new Date(anchor) : new Date();
    if (Number.isNaN(anchorDate.getTime())) {
      throw new BadRequestException('from and to must be valid ISO dates');
    }
    const range = {
      from: from ? this.parseBoundary(from, false) : this.startOfLocalDay(anchorDate),
      to: to ? this.parseBoundary(to, true) : this.endOfLocalDay(anchorDate),
    };
    if (range.from > range.to) {
      throw new BadRequestException('from must be before or equal to to');
    }
    return range;
  }

  private parseBoundary(value: string, end: boolean): Date {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const date = dateOnly
      ? new Date(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3]),
        )
      : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('from and to must be valid ISO dates');
    }
    return dateOnly
      ? end
        ? this.endOfLocalDay(date)
        : this.startOfLocalDay(date)
      : date;
  }

  private startOfLocalDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  private endOfLocalDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  private localDayKey(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  private toTargetRow(target: WinbackSalesTarget): TargetRow {
    return {
      ...target,
      gmv_target: Number(target.gmv_target),
    };
  }
}
