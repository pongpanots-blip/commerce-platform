import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { NotificationService } from './shared/notification.service';
import { WinbackService } from './winback.service';
import { appConfig } from './shared/winback.config';

/** Remind the rep this long before a planned activity's `scheduled_at`. — WINBACK_APPOINTMENT_REMINDER_MINUTES */
export const APPOINTMENT_REMINDER_MINUTES = appConfig.winback.appointmentReminderMinutes;
/** A lead with no activity for this many days is "aging"; the owner is told again every period. — WINBACK_LEAD_AGING_DAYS */
export const LEAD_AGING_DAYS = appConfig.winback.leadAgingDays;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function bangkokTime(date: Date): string {
  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function bangkokDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(date);
}

const BANGKOK_OFFSET_MS = 7 * 60 * MINUTE;

/** [start, end) of the Bangkok calendar day containing `date`, shifted by `dayOffset` days. */
function bangkokDayRange(date: Date, dayOffset = 0): { start: Date; end: Date } {
  const local = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset);
  const start = new Date(startLocal - BANGKOK_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY) };
}

/**
 * Time-triggered win-back notifications. Both are driven by a cron, so each
 * remembers what it sent in a column (`reminded_at`, `aging_notified_at`) —
 * `dedupeKey` alone only stops the in-app row from duplicating, push and email
 * would go out again on every tick.
 */
@Injectable()
export class WinbackNotifyService {
  private readonly logger = new Logger(WinbackNotifyService.name);

  constructor(
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackActivity) private readonly activities: Repository<WinbackActivity>,
    private readonly winback: WinbackService,
    private readonly notifications: NotificationService,
  ) {}

  /** Planned activities starting within the reminder window that have not been announced. */
  async notifyAppointmentsDue(now = new Date()): Promise<number> {
    const windowEnd = new Date(now.getTime() + APPOINTMENT_REMINDER_MINUTES * MINUTE);
    const due = await this.activities.find({
      where: { status: 'planned', reminded_at: IsNull(), scheduled_at: Between(now, windowEnd) },
      order: { scheduled_at: 'ASC' },
      take: 200,
    });
    if (due.length === 0) return 0;

    const accounts = await this.accounts.find({
      where: { id: In([...new Set(due.map((a) => a.account_id))]) },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));

    let sent = 0;
    for (const activity of due) {
      const account = byId.get(activity.account_id);
      const scheduledAt = activity.scheduled_at as Date;
      try {
        await this.notifications.dispatch({
          userId: activity.sales_user_id,
          type: 'winback_appointment_due',
          category: 'winback',
          dedupeKey: `winback_appointment_due:${activity.id}`,
          data: {
            activity_id: activity.id,
            activity_type: activity.type,
            account_id: activity.account_id,
            customer_code: account?.customer_code ?? null,
            restaurant_name: account?.restaurant_name ?? account?.display_name ?? null,
            scheduled_at: scheduledAt.toISOString(),
            scheduled_time: bangkokTime(scheduledAt),
          },
        });
        await this.activities.update(activity.id, { reminded_at: now });
        sent += 1;
      } catch (error) {
        this.logger.warn(
          `winback_appointment_due dispatch failed for activity ${activity.id}: ${String(error)}`,
        );
      }
    }
    return sent;
  }

  /**
   * Owned leads with no activity for `LEAD_AGING_DAYS`, not told in the last
   * period. Unassigned leads have nobody to remind — they show up in the
   * manager aging view instead.
   */
  async notifyAgingLeads(now = new Date()): Promise<number> {
    const repeatCutoff = new Date(now.getTime() - LEAD_AGING_DAYS * DAY);
    const aging = await this.winback
      .unworkedLeadsQuery(LEAD_AGING_DAYS, now)
      .andWhere('a.assigned_sales_user_id IS NOT NULL')
      .andWhere('(a.aging_notified_at IS NULL OR a.aging_notified_at < :repeatCutoff)', { repeatCutoff })
      .take(500)
      .getMany();
    if (aging.length === 0) return 0;

    let sent = 0;
    for (const account of aging) {
      const owner = account.assigned_sales_user_id as string;
      const daysAsLead = Math.floor((now.getTime() - new Date(account.create_date).getTime()) / DAY);
      try {
        await this.notifications.dispatch({
          userId: owner,
          type: 'winback_lead_aging',
          category: 'winback',
          dedupeKey: `winback_lead_aging:${account.id}:${bangkokDate(now)}`,
          data: {
            account_id: account.id,
            customer_code: account.customer_code,
            restaurant_name: account.restaurant_name ?? account.display_name,
            days_as_lead: daysAsLead,
          },
        });
        await this.accounts.update(account.id, { aging_notified_at: now });
        sent += 1;
      } catch (error) {
        this.logger.warn(`winback_lead_aging dispatch failed for lead ${account.id}: ${String(error)}`);
      }
    }
    return sent;
  }

  /**
   * 18:00 digest per rep: planned activities from today still not logged, and
   * tomorrow's appointments. Silent when both are 0 — that is what keeps days
   * off quiet without hardcoding a working week.
   */
  async notifyDailyDigest(now = new Date()): Promise<number> {
    const today = bangkokDayRange(now);
    const tomorrow = bangkokDayRange(now, 1);
    const [unloggedRows, tomorrowRows] = await Promise.all([
      this.activities.find({
        where: { status: 'planned', scheduled_at: Between(today.start, now) },
        select: ['sales_user_id'],
      }),
      this.activities.find({
        where: { scheduled_at: Between(tomorrow.start, tomorrow.end) },
        select: ['sales_user_id', 'status'],
      }),
    ]);

    const perUser = new Map<string, { unlogged: number; tomorrow: number }>();
    const bump = (userId: string, key: 'unlogged' | 'tomorrow') => {
      const row = perUser.get(userId) ?? { unlogged: 0, tomorrow: 0 };
      row[key] += 1;
      perUser.set(userId, row);
    };
    for (const a of unloggedRows) bump(a.sales_user_id, 'unlogged');
    for (const a of tomorrowRows) if (a.status !== 'cancelled') bump(a.sales_user_id, 'tomorrow');

    const date = bangkokDate(now);
    let sent = 0;
    for (const [userId, counts] of perUser) {
      if (counts.unlogged === 0 && counts.tomorrow === 0) continue;
      try {
        await this.notifications.dispatch({
          userId,
          type: 'winback_daily_digest',
          category: 'winback',
          dedupeKey: `winback_daily_digest:${userId}:${date}`,
          data: { unlogged_count: counts.unlogged, tomorrow_count: counts.tomorrow, date },
        });
        sent += 1;
      } catch (error) {
        this.logger.warn(`winback_daily_digest dispatch failed for ${userId}: ${String(error)}`);
      }
    }
    return sent;
  }
}
