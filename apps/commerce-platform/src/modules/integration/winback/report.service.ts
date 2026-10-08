import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackSalesTarget } from './entities/winback-sales-target.entity';
import { JoshUser as User } from './josh-copies.entity';
import { JoshOrder as Order } from './josh-copies.entity';
import {
  countByKey,
  PIPELINE_CONVERSION_STAGES,
  stageConversion,
} from './analytics.helpers';
import {
  classifyCustomerSegment,
  DASHBOARD_ORDER_STATUSES,
  defaultDashboardRange,
  monthStartUtc,
  pctShare,
  roundBaht,
  type CustomerSegment,
} from './dashboard.helpers';
import { avgDays, CONTACTED_STAGES, isWon } from './report.helpers';
import { WINBACK_ACTIVITY_TYPES, WINBACK_STAGES } from './winback.enums';
import { WINBACK_ASSIGNABLE_ROLES } from './winback-roles';

interface AccRow {
  id: string;
  stage: string;
  health: string;
  create_date: string;
  reactivated_at: string | null;
  lifecycle: string;
  promoted_to_lead_at: string | null;
  reject_reason: string | null;
  assigned_sales_user_id: string | null;
}

export type TeamRepStat = {
  sales_user_id: string;
  email: string | null;
  name: string | null;
  lead_count: number;
  open_count: number;
  signed_count: number;
  rejected_count: number;
  by_stage: Record<string, number>;
  visits: number;
  calls: number;
  gifts: number;
  lines: number;
  pitches: number;
  activities: number;
  won: number;
  /** Baht in the period — the same figure as `/dashboard` `byPerson[].gmv` (its default period when from/to are omitted). */
  gmv?: number;
};

export type DashboardPersonRow = {
  sales_user_id: string;
  name: string | null;
  email: string | null;
  gmv: number;
  order_count: number;
  aov: number;
  customer_count: number;
  contribution_pct: number;
  commission_baht: number | null;
  target: number | null;
  achievement_pct: number | null;
  gap: number | null;
};

@Injectable()
export class ReportService {
  constructor(
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackActivity) private readonly activities: Repository<WinbackActivity>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(WinbackSalesTarget)
    private readonly salesTargets: Repository<WinbackSalesTarget>,
  ) {}

  async getScorecard(scope: 'team' | 'me', salesUserId: string, from?: string, to?: string) {
    const qb = this.accounts
      .createQueryBuilder('a')
      .select([
        'a.id AS id',
        'a.stage AS stage',
        'a.health AS health',
        'a.create_date AS create_date',
        'a.reactivated_at AS reactivated_at',
        'a.lifecycle AS lifecycle',
        'a.promoted_to_lead_at AS promoted_to_lead_at',
        'a.reject_reason AS reject_reason',
        'a.assigned_sales_user_id AS assigned_sales_user_id',
      ]);
    if (scope === 'me') {
      qb.where('(a.assigned_sales_user_id = :uid OR a.created_by_sales_user_id = :uid)', {
        uid: salesUserId || '',
      });
    }
    if (from && to) qb.andWhere('a.create_date BETWEEN :from AND :to', { from, to });
    const rows = await qb.getRawMany<AccRow>();

    // funnel
    const funnel: Record<string, number> = {};
    for (const s of WINBACK_STAGES) funnel[s] = 0;
    for (const r of rows) funnel[r.stage] = (funnel[r.stage] ?? 0) + 1;

    // reactivation
    const total = rows.length;
    const won = rows.filter((r) => isWon(r.stage, r.health)).length;
    const contacted = rows.filter((r) => CONTACTED_STAGES.has(r.stage)).length;
    const reactivation = {
      total,
      won,
      rate: total ? Math.round((won / total) * 1000) / 10 : 0,
      contacted,
      rateOfContacted: contacted ? Math.round((won / contacted) * 1000) / 10 : 0,
    };

    // timing
    const ids = rows.map((r) => r.id);
    let firstByAccount = new Map<string, string>();
    if (ids.length) {
      const firsts = await this.activities
        .createQueryBuilder('act')
        .select('act.account_id', 'account_id')
        .addSelect('MIN(act.activity_at)', 'first_at')
        .where('act.account_id IN (:...ids)', { ids })
        .groupBy('act.account_id')
        .getRawMany<{ account_id: string; first_at: string }>();
      firstByAccount = new Map(firsts.map((f) => [f.account_id, f.first_at]));
    }
    const toFirstContact = avgDays(
      rows.map((r) => ({ start: r.create_date, end: firstByAccount.get(r.id) ?? null })),
    );
    const toFirstOrder = avgDays(rows.map((r) => ({ start: r.create_date, end: r.reactivated_at })));
    const timing = {
      avgDaysToFirstContact: toFirstContact.avg,
      sampleContact: toFirstContact.sample,
      avgDaysToFirstOrder: toFirstOrder.avg,
      sampleOrder: toFirstOrder.sample,
    };

    const perRep =
      scope === 'team' ? await this.buildPerRep(rows, from, to) : [];

    const [activityByType, outcomeByType] = await Promise.all([
      this.countActivitiesByType(scope, salesUserId, from, to),
      this.countActivityOutcomes(scope, salesUserId, from, to),
    ]);
    const tmpCohort = rows.filter(
      (row) => row.lifecycle === 'tmp' || row.promoted_to_lead_at != null,
    );
    const promoted = tmpCohort.filter((row) => {
      if (!row.promoted_to_lead_at) return false;
      if (!from || !to) return true;
      const promotedAt = new Date(row.promoted_to_lead_at).getTime();
      return promotedAt >= new Date(from).getTime() && promotedAt <= new Date(to).getTime();
    }).length;
    const tmpCreated = tmpCohort.length;
    const tmpToLead = {
      tmpCreated,
      promoted,
      rate: tmpCreated ? Math.round((promoted / tmpCreated) * 1000) / 10 : 0,
    };
    const rejectMix = countByKey(
      rows
        .filter((row) => ['rejected', 'lost'].includes(row.stage))
        .map((row) => ({ key: row.reject_reason })),
    );
    const conversion = stageConversion(funnel, PIPELINE_CONVERSION_STAGES);

    return {
      funnel,
      reactivation,
      timing,
      perRep,
      activityByType,
      conversion,
      outcomeByType,
      rejectMix,
      tmpToLead,
    };
  }

  private async countActivityOutcomes(
    scope: 'team' | 'me',
    salesUserId: string,
    from?: string,
    to?: string,
  ): Promise<Record<string, number>> {
    const qb = this.activities
      .createQueryBuilder('act')
      .select('act.outcome', 'key')
      .where("act.status = 'done'");
    if (scope === 'me') qb.andWhere('act.sales_user_id = :uid', { uid: salesUserId || '' });
    if (from && to) qb.andWhere('act.activity_at BETWEEN :from AND :to', { from, to });
    return countByKey(await qb.getRawMany<{ key: string | null }>());
  }

  private async countActivitiesByType(
    scope: 'team' | 'me',
    salesUserId: string,
    from?: string,
    to?: string,
  ): Promise<Record<string, number>> {
    const qb = this.activities
      .createQueryBuilder('act')
      .select('act.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where("act.status = 'done'")
      .groupBy('act.type');
    if (scope === 'me') qb.andWhere('act.sales_user_id = :uid', { uid: salesUserId || '' });
    if (from && to) qb.andWhere('act.activity_at BETWEEN :from AND :to', { from, to });
    const raw = await qb.getRawMany<{ type: string; count: string }>();
    const out: Record<string, number> = {};
    for (const t of WINBACK_ACTIVITY_TYPES) out[t] = 0;
    for (const r of raw) out[r.type] = Number(r.count);
    return out;
  }

  /** Sales KPI dashboard (whiteboard): GMV / orders / AOV / customers / contribution. */
  async getDashboard(
    scope: 'team' | 'me',
    salesUserId: string,
    from?: string,
    to?: string,
  ) {
    const range = from && to ? { from, to } : defaultDashboardRange();
    const periodStart = new Date(range.from);
    const periodEnd = new Date(range.to);
    const segMonthStart = monthStartUtc(periodStart);

    const accQb = this.accounts
      .createQueryBuilder('a')
      .select('a.id', 'id')
      .addSelect('a.customer_code', 'customer_code')
      .addSelect('a.inactive_days', 'inactive_days')
      .addSelect('a.create_date', 'create_date')
      .addSelect('a.stage', 'stage')
      .addSelect('a.health', 'health')
      .addSelect('a.assigned_sales_user_id', 'assigned_sales_user_id');
    if (scope === 'me') {
      accQb.where('(a.assigned_sales_user_id = :uid OR a.created_by_sales_user_id = :uid)', {
        uid: salesUserId || '',
      });
    }
    const accounts = await accQb.getRawMany<{
      id: string;
      customer_code: string;
      inactive_days: string | number;
      create_date: string;
      stage: string;
      health: string;
      assigned_sales_user_id: string | null;
    }>();

    const codes = [
      ...new Set(
        accounts
          .map((a) => (a.customer_code || '').trim().toUpperCase())
          .filter(Boolean),
      ),
    ];

    const orderByCode = new Map<string, { gmv: number; order_count: number }>();
    const lifetimeOrdersByCode = new Map<string, number>();

    if (codes.length) {
      const chunks: string[][] = [];
      for (let i = 0; i < codes.length; i += 500) chunks.push(codes.slice(i, i + 500));

      for (const chunk of chunks) {
        const lifeRows = await this.orders
          .createQueryBuilder('o')
          .select('UPPER(TRIM(o.customer_code))', 'code')
          .addSelect('COUNT(*)', 'cnt')
          .where('UPPER(TRIM(o.customer_code)) IN (:...codes)', { codes: chunk })
          .andWhere('o.status IN (:...statuses)', { statuses: [...DASHBOARD_ORDER_STATUSES] })
          .groupBy('UPPER(TRIM(o.customer_code))')
          .getRawMany<{ code: string; cnt: string }>();
        for (const r of lifeRows) lifetimeOrdersByCode.set(r.code, Number(r.cnt) || 0);

        const periodRows = await this.orders
          .createQueryBuilder('o')
          .select('UPPER(TRIM(o.customer_code))', 'code')
          .addSelect('COALESCE(SUM(o.total_price), 0)', 'gmv')
          .addSelect('COUNT(*)', 'order_count')
          .where('UPPER(TRIM(o.customer_code)) IN (:...codes)', { codes: chunk })
          .andWhere('o.status IN (:...statuses)', { statuses: [...DASHBOARD_ORDER_STATUSES] })
          .andWhere('o.create_date BETWEEN :from AND :to', {
            from: periodStart.toISOString(),
            to: periodEnd.toISOString(),
          })
          .groupBy('UPPER(TRIM(o.customer_code))')
          .getRawMany<{ code: string; gmv: string; order_count: string }>();
        for (const r of periodRows) {
          orderByCode.set(r.code, {
            gmv: Number(r.gmv) || 0,
            order_count: Number(r.order_count) || 0,
          });
        }
      }
    }

    const segments: Record<CustomerSegment, number> = {
      repeat: 0,
      new: 0,
      reengage: 0,
      inactive: 0,
    };

    type PersonBucket = { gmv: number; order_count: number; customers: Set<string> };
    const byPerson = new Map<string, PersonBucket>();

    let totalGmv = 0;
    let totalOrders = 0;
    const seenCodes = new Set<string>();

    for (const a of accounts) {
      const code = (a.customer_code || '').trim().toUpperCase();
      if (!code || seenCodes.has(code)) continue;
      seenCodes.add(code);

      const lifeOrders = lifetimeOrdersByCode.get(code) ?? 0;
      const seg = classifyCustomerSegment({
        inactiveDays: Number(a.inactive_days) || 0,
        createDate: a.create_date,
        orderCount: lifeOrders,
        stage: a.stage,
        health: a.health,
        monthStart: segMonthStart,
      });
      segments[seg] += 1;

      const period = orderByCode.get(code);
      if (!period) continue;

      totalGmv += period.gmv;
      totalOrders += period.order_count;

      const owner = a.assigned_sales_user_id || (scope === 'me' ? salesUserId : '');
      if (!owner) continue;
      const bucket = byPerson.get(owner) ?? {
        gmv: 0,
        order_count: 0,
        customers: new Set<string>(),
      };
      bucket.gmv += period.gmv;
      bucket.order_count += period.order_count;
      bucket.customers.add(code);
      byPerson.set(owner, bucket);
    }

    totalGmv = roundBaht(totalGmv);
    const aov = totalOrders ? roundBaht(totalGmv / totalOrders) : 0;

    const periodMonth = `${periodEnd.getFullYear()}-${String(periodEnd.getMonth() + 1).padStart(2, '0')}`;
    const targetUserIds =
      scope === 'me'
        ? salesUserId
          ? [salesUserId]
          : []
        : [
            ...new Set([
              ...byPerson.keys(),
              ...(await this.users.find({
                where: { role: In([...WINBACK_ASSIGNABLE_ROLES]), is_active: true },
                select: ['id'],
                take: 200,
              })).map((u) => u.id),
            ]),
          ];
    const targetRows = targetUserIds.length
      ? await this.salesTargets.find({
          where: {
            period_month: periodMonth,
            sales_user_id: In(targetUserIds),
          },
        })
      : [];
    const targetByUser = new Map<string, number>(
      targetRows.map((t) => [t.sales_user_id, Number(t.gmv_target)]),
    );
    const targetConfigured = targetRows.length > 0;
    const totalTarget = roundBaht(
      targetRows.reduce((sum, target) => sum + Number(target.gmv_target), 0),
    );
    const achievementPct =
      targetConfigured && totalTarget > 0
        ? Math.round((totalGmv / totalTarget) * 1000) / 10
        : targetConfigured
          ? 0
          : null;
    const targetGap = targetConfigured ? roundBaht(totalTarget - totalGmv) : null;

    const userIds = [...new Set([...byPerson.keys(), ...targetByUser.keys()])];
    if (scope === 'me' && salesUserId && !userIds.includes(salesUserId)) {
      userIds.push(salesUserId);
    }
    const usersById = new Map<string, { email: string | null; name: string | null }>();
    if (userIds.length) {
      const users = await this.users.find({
        where: { id: In(userIds) },
        select: ['id', 'email', 'first_name', 'last_name'],
      });
      for (const u of users) {
        usersById.set(u.id, {
          email: u.email,
          name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email,
        });
      }
    }

    const by_person: DashboardPersonRow[] = userIds
      .map((id) => {
        const b = byPerson.get(id) ?? { gmv: 0, order_count: 0, customers: new Set<string>() };
        const gmv = roundBaht(b.gmv);
        const info = usersById.get(id);
        const t = targetByUser.get(id);
        const target = t != null ? roundBaht(Number(t)) : null;
        const achievement_pct =
          target != null && target > 0
            ? Math.round((gmv / target) * 1000) / 10
            : target === 0
              ? 0
              : null;
        const gap = target != null ? roundBaht(target - gmv) : null;
        return {
          sales_user_id: id,
          email: info?.email ?? null,
          name: info?.name ?? null,
          gmv,
          order_count: b.order_count,
          aov: b.order_count ? roundBaht(gmv / b.order_count) : 0,
          contribution_pct: pctShare(gmv, totalGmv),
          commission_baht: null,
          customer_count: b.customers.size,
          target,
          achievement_pct,
          gap,
        };
      })
      .filter(
        (r) =>
          scope === 'me' ||
          r.gmv > 0 ||
          r.customer_count > 0 ||
          r.order_count > 0 ||
          r.target != null,
      )
      .sort((a, b) => b.gmv - a.gmv || b.order_count - a.order_count);

    return {
      period: { from: range.from, to: range.to },
      scope,
      target_configured: targetConfigured,
      gmv: totalGmv,
      target: {
        set: targetConfigured,
        baht: targetConfigured ? totalTarget : null,
        pct: targetConfigured ? 100 : null,
        message: targetConfigured ? 'เป้ายอดขายประจำเดือน' : 'ยังไม่ได้ตั้งเป้า',
      },
      achievement: {
        baht: totalGmv,
        pct: achievementPct,
      },
      gap: {
        baht: targetGap,
        message: targetConfigured ? 'เหลือถึงเป้า' : 'ยังไม่ได้ตั้งเป้า',
      },
      orders: {
        total: totalOrders,
        aov,
      },
      customers: {
        total: seenCodes.size,
        repeat: segments.repeat,
        new: segments.new,
        reengage: segments.reengage,
        inactive: segments.inactive,
      },
      by_person,
      commission: {
        set: false as const,
        message: 'ยังไม่ได้ตั้งสูตรคอมมิชชัน',
      },
    };
  }

  /** Manager-only: per-subordinate lead counts + activity KPIs. */
  async getTeamStats(from?: string, to?: string): Promise<{ reps: TeamRepStat[] }> {
    const qb = this.accounts
      .createQueryBuilder('a')
      .select([
        'a.id AS id',
        'a.stage AS stage',
        'a.health AS health',
        'a.create_date AS create_date',
        'a.reactivated_at AS reactivated_at',
        'a.assigned_sales_user_id AS assigned_sales_user_id',
      ]);
    if (from && to) qb.andWhere('a.create_date BETWEEN :from AND :to', { from, to });
    const rows = await qb.getRawMany<AccRow>();
    const [perRep, dashboard] = await Promise.all([
      this.buildPerRep(rows, from, to),
      this.getDashboard('team', '', from, to),
    ]);
    const gmvByRep = new Map(dashboard.by_person.map((p) => [p.sales_user_id, p.gmv]));
    return { reps: perRep.map((r) => ({ ...r, gmv: gmvByRep.get(r.sales_user_id) ?? 0 })) };
  }

  private async buildPerRep(
    accountRows: AccRow[],
    from?: string,
    to?: string,
  ): Promise<TeamRepStat[]> {
    const CLOSED = new Set(['signed', 'won', 'reactivated', 'ordering_again']);
    const REJECTED = new Set(['rejected', 'lost']);

    const byOwner = new Map<string, AccRow[]>();
    for (const r of accountRows) {
      if (!r.assigned_sales_user_id) continue;
      const list = byOwner.get(r.assigned_sales_user_id) ?? [];
      list.push(r);
      byOwner.set(r.assigned_sales_user_id, list);
    }

    const actQb = this.activities
      .createQueryBuilder('act')
      .select('act.sales_user_id', 'sales_user_id')
      .addSelect('COUNT(*)', 'activities')
      .addSelect(`COUNT(*) FILTER (WHERE act.type IN ('visit','store_visit'))`, 'visits')
      .addSelect(`COUNT(*) FILTER (WHERE act.type IN ('call','cold_call'))`, 'calls')
      .addSelect(`COUNT(*) FILTER (WHERE act.type = 'gift')`, 'gifts')
      .addSelect(`COUNT(*) FILTER (WHERE act.type = 'line')`, 'lines')
      .addSelect(`COUNT(*) FILTER (WHERE act.type IN ('pitching','delivery'))`, 'pitches')
      .groupBy('act.sales_user_id');
    if (from && to) actQb.where('act.activity_at BETWEEN :from AND :to', { from, to });
    const actRows = await actQb.getRawMany<{
      sales_user_id: string;
      activities: string;
      visits: string;
      calls: string;
      gifts: string;
      lines: string;
      pitches: string;
    }>();
    const actById = new Map(
      actRows.map((r) => [
        r.sales_user_id,
        {
          activities: Number(r.activities),
          visits: Number(r.visits),
          calls: Number(r.calls),
          gifts: Number(r.gifts),
          lines: Number(r.lines),
          pitches: Number(r.pitches),
        },
      ]),
    );

    const staff = await this.users.find({
      where: { role: In([...WINBACK_ASSIGNABLE_ROLES]), is_active: true },
      select: ['id', 'email', 'first_name', 'last_name'],
      take: 200,
    });
    const staffIds = new Set(staff.map((u) => u.id));
    for (const id of byOwner.keys()) staffIds.add(id);
    for (const id of actById.keys()) if (id) staffIds.add(id);

    const usersById = new Map<string, { email: string | null; name: string | null }>();
    for (const u of staff) {
      usersById.set(u.id, {
        email: u.email,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email,
      });
    }
    const missing = [...staffIds].filter((id) => !usersById.has(id));
    if (missing.length) {
      const extra = await this.users.find({
        where: { id: In(missing) },
        select: ['id', 'email', 'first_name', 'last_name'],
      });
      for (const u of extra) {
        usersById.set(u.id, {
          email: u.email,
          name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email,
        });
      }
    }

    const reps: TeamRepStat[] = [];
    for (const id of staffIds) {
      const owned = byOwner.get(id) ?? [];
      const by_stage: Record<string, number> = {};
      for (const s of WINBACK_STAGES) by_stage[s] = 0;
      let signed_count = 0;
      let rejected_count = 0;
      for (const r of owned) {
        by_stage[r.stage] = (by_stage[r.stage] ?? 0) + 1;
        if (CLOSED.has(r.stage) || isWon(r.stage, r.health)) signed_count += 1;
        if (REJECTED.has(r.stage)) rejected_count += 1;
      }
      const open_count = owned.length - signed_count - rejected_count;
      const act = actById.get(id) ?? {
        activities: 0,
        visits: 0,
        calls: 0,
        gifts: 0,
        lines: 0,
        pitches: 0,
      };
      const info = usersById.get(id);
      reps.push({
        sales_user_id: id,
        email: info?.email ?? null,
        name: info?.name ?? null,
        lead_count: owned.length,
        open_count: Math.max(0, open_count),
        signed_count,
        rejected_count,
        by_stage,
        visits: act.visits,
        calls: act.calls,
        gifts: act.gifts,
        lines: act.lines,
        pitches: act.pitches,
        activities: act.activities,
        won: signed_count,
      });
    }

    return reps.sort(
      (a, b) => b.lead_count - a.lead_count || b.activities - a.activities,
    );
  }
}
