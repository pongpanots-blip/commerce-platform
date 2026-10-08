import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackHealth } from './winback.enums';
import { buildWorklist } from './worklist.helpers';
import { assignAccountSequences, assignDailySequences } from './analytics.helpers';

@Injectable()
export class DiaryService {
  constructor(
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackActivity) private readonly activities: Repository<WinbackActivity>,
  ) {}

  /** A rep "owns" a lead if it is assigned to them OR they created it. */
  private ownFilter(salesUserId: string) {
    return [
      { assigned_sales_user_id: salesUserId },
      { created_by_sales_user_id: salesUserId },
    ];
  }

  private emptyMyDay() {
    const empty = { count: 0, items: [] as unknown[] };
    return {
      dueToday: empty,
      overdue: empty,
      notVisited: empty,
      newLeads: empty,
      bought: empty,
      worklist: empty,
      activityByType: {} as Record<string, number>,
    };
  }

  async getMyDay(salesUserId: string, dateISO?: string) {
    if (!salesUserId) return this.emptyMyDay();
    const now = dateISO ? new Date(dateISO) : new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const owns = this.ownFilter(salesUserId);
    const withOwn = (extra: object) => owns.map((o) => ({ ...o, ...extra }));

    const [dueToday, overdue, notVisited, ownedAll, bought, slipping] = await Promise.all([
      this.accounts.find({
        where: withOwn({ next_follow_up_at: Between(startOfDay, endOfDay) }),
        take: 50,
        order: { next_follow_up_at: 'ASC' },
      }),
      this.accounts.find({
        where: withOwn({ next_follow_up_at: LessThan(startOfDay) }),
        take: 50,
        order: { next_follow_up_at: 'ASC' },
      }),
      this.accounts.find({
        where: withOwn({ visit_count: 0 }),
        take: 50,
        order: { create_date: 'DESC' },
      }),
      this.accounts.find({ where: owns, take: 100, order: { create_date: 'DESC' } }),
      this.accounts.find({
        where: withOwn({ health: WinbackHealth.ACTIVE_AGAIN, reactivated_at: Not(IsNull()) }),
        take: 50,
        order: { reactivated_at: 'DESC' },
      }),
      // Worklist candidates: the orders say these are slipping, and no follow-up
      // is booked. Anything with a follow-up date already shows in dueToday or
      // overdue, so filtering on IsNull keeps the buckets from overlapping.
      this.accounts.find({
        where: withOwn({
          health: In([WinbackHealth.WATCH, WinbackHealth.DORMANT]),
          next_follow_up_at: IsNull(),
        }),
        // Over-fetch, then rank: delay_ratio alone is not the ranking, but it is
        // the best single predictor of which rows are worth scoring at all.
        take: 200,
        order: { delay_ratio: 'DESC' },
      }),
    ]);

    const worklist = buildWorklist(slipping);

    const newLeads = ownedAll.filter((a) => a.create_date && new Date(a.create_date) >= weekAgo);

    const todayActs = await this.activities
      .createQueryBuilder('act')
      .select('act.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('act.sales_user_id = :uid', { uid: salesUserId })
      .andWhere('act.activity_at BETWEEN :from AND :to', { from: startOfDay, to: endOfDay })
      .andWhere("act.status = 'done'")
      .groupBy('act.type')
      .getRawMany<{ type: string; count: string }>();
    const activityByType: Record<string, number> = {};
    for (const r of todayActs) activityByType[r.type] = Number(r.count);

    const brief = (rows: WinbackAccount[]) =>
      rows.slice(0, 8).map((a) => ({
        id: a.id,
        customer_code: a.customer_code,
        display_name: a.display_name,
        stage: a.stage,
        lifecycle: a.lifecycle,
        next_follow_up_at: a.next_follow_up_at,
        visit_count: a.visit_count,
        activity_count: a.activity_count,
      }));

    return {
      dueToday: { count: dueToday.length, items: brief(dueToday) },
      overdue: { count: overdue.length, items: brief(overdue) },
      notVisited: { count: notVisited.length, items: brief(notVisited) },
      newLeads: { count: newLeads.length, items: brief(newLeads) },
      bought: { count: bought.length, items: brief(bought) },
      worklist: { count: worklist.length, items: worklist },
      activityByType,
    };
  }

  async getDiary(salesUserId: string, fromISO?: string, toISO?: string) {
    if (!salesUserId) return [];
    const where: Record<string, unknown> = { sales_user_id: salesUserId };
    if (fromISO && toISO) where.activity_at = Between(new Date(fromISO), new Date(toISO));
    const rows = await this.activities.find({
      where,
      order: { activity_at: 'DESC' },
      take: 200,
    });

    const [withAccounts, sequences] = await Promise.all([this.withAccounts(rows), this.sequences(rows)]);
    return withAccounts.map((r) => ({
      ...r,
      visit_n: sequences.account.get(r.id) ?? null,
      daily_k: sequences.daily.get(r.id) ?? null,
    }));
  }

  /**
   * `visit_n` = the activity's place among its account's done activities ("ครั้งที่ N"), `daily_k` = among the
   * rep's done activities that day ("วันนี้ #K") — the same numbering as `/team-activity-feed`. Null for
   * activities not done yet.
   */
  private async sequences(rows: WinbackActivity[]) {
    const done = rows.filter((r) => r.status === 'done');
    if (!done.length) return { account: new Map<string, number>(), daily: new Map<string, number>() };
    const times = done.map((r) => new Date(r.activity_at).getTime());
    const dayFrom = new Date(Math.min(...times));
    dayFrom.setHours(0, 0, 0, 0);
    const dayTo = new Date(Math.max(...times));
    dayTo.setHours(23, 59, 59, 999);
    const select: (keyof WinbackActivity)[] = ['id', 'account_id', 'sales_user_id', 'activity_at'];
    const [accountHistory, dayHistory] = await Promise.all([
      this.activities.find({ where: { account_id: In([...new Set(done.map((r) => r.account_id))]), status: 'done' }, select }),
      this.activities.find({
        where: { sales_user_id: In([...new Set(done.map((r) => r.sales_user_id))]), status: 'done', activity_at: Between(dayFrom, dayTo) },
        select,
      }),
    ]);
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { account: assignAccountSequences(accountHistory), daily: assignDailySequences(dayHistory, dayKey) };
  }

  /**
   * Planned appointments for a date range (calendar view).
   * Filters by scheduled_at — diary uses activity_at which is "created/done" time.
   */
  async getCalendar(salesUserId: string, fromISO?: string, toISO?: string) {
    if (!salesUserId) return [];
    const now = new Date();
    const from = fromISO
      ? new Date(fromISO)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = toISO
      ? new Date(toISO)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const rows = await this.activities
      .createQueryBuilder('act')
      .where('act.sales_user_id = :uid', { uid: salesUserId })
      .andWhere("act.status = 'planned'")
      .andWhere('act.scheduled_at IS NOT NULL')
      .andWhere('act.scheduled_at BETWEEN :from AND :to', { from, to })
      .orderBy('act.scheduled_at', 'ASC')
      .take(500)
      .getMany();

    return this.withAccounts(rows);
  }

  private async withAccounts(rows: WinbackActivity[]) {
    const ids = [...new Set(rows.map((r) => r.account_id))];
    const accs = ids.length ? await this.accounts.find({ where: ids.map((id) => ({ id })) }) : [];
    const byId = new Map(accs.map((a) => [a.id, a]));

    return rows.map((r) => {
      const acc = byId.get(r.account_id);
      return {
        ...r,
        account: acc
          ? { id: acc.id, display_name: acc.display_name, customer_code: acc.customer_code }
          : null,
      };
    });
  }
}
