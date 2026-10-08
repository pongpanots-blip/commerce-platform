import { listStaffRoster } from './shared/winback-staff-roster';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackMeetingAck } from './entities/winback-meeting-ack.entity';
import { WinbackStageHistory } from './entities/winback-stage-history.entity';
import { JoshUser as User } from './josh-copies.entity';
import {
  CLOSED_WINBACK_STAGES,
  STAGE_HISTORY_LOOKBACK_DAYS,
  STAGE_MEDIAN_WINDOW_DAYS,
  medianStageDays,
  medianStageDaysByActor,
  requiresSubjectId,
  stageEnteredAt,
  truncateNote,
} from './meeting-prep.helpers';
import { CreateMeetingAckDto } from './dto/meeting-ack.dto';
import { WinbackMeetingSignal, WinbackStage } from './winback.enums';
import { WINBACK_ASSIGNABLE_ROLES } from './winback-roles';

const DAY_MS = 86_400_000;
const DEFAULT_LEAD_LIMIT = 500;
const ACK_DEFAULT_WINDOW_DAYS = 56; // 8 weeks — all the meeting screen reads.

/** Who is asking, and for whom. */
export interface MeetingPrepScope {
  salesUserId: string;
  isManager: boolean;
  requestedSalesUserId?: string;
}

/**
 * Facts behind the Monday meeting-prep screen, and the record of which points
 * were already raised.
 *
 * Deliberately returns facts, not talking points: the Thai wording and the
 * ranking are product judgment the app tunes without a backend deploy. What the
 * app cannot do itself is assemble stage timing and overdue appointments across
 * a whole team — none of it is exposed by any other endpoint.
 */
@Injectable()
export class MeetingPrepService {
  constructor(
    @InjectRepository(WinbackAccount)
    private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackActivity)
    private readonly activities: Repository<WinbackActivity>,
    @InjectRepository(WinbackStageHistory)
    private readonly stageHistory: Repository<WinbackStageHistory>,
    @InjectRepository(WinbackMeetingAck)
    private readonly acks: Repository<WinbackMeetingAck>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /**
   * Restrict a `winback_account` query to what the caller may see. Mirrors
   * `GET /winback/aging`: a manager sees the whole team (there is no
   * manager→rep hierarchy in this system), a sales user sees their own leads
   * plus unassigned ones.
   */
  private applyScope<T>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    scope: MeetingPrepScope,
  ): SelectQueryBuilder<T> {
    const requested = scope.requestedSalesUserId;
    if (requested) {
      if (!scope.isManager && requested !== scope.salesUserId) {
        throw new ForbiddenException(
          'A sales user can only read their own lead signals',
        );
      }
      return qb.andWhere(`${alias}.assigned_sales_user_id = :requested`, {
        requested,
      });
    }
    if (scope.isManager) return qb;
    if (!scope.salesUserId) {
      // Locally, AdminWriteGuard short-circuits without a token, so there is no
      // caller id to match. Binding '' would blow up the uuid cast; unassigned
      // leads only is what `/aging` effectively shows in the same situation.
      return qb.andWhere(`${alias}.assigned_sales_user_id IS NULL`);
    }
    return qb.andWhere(
      `(${alias}.assigned_sales_user_id = :me OR ${alias}.assigned_sales_user_id IS NULL)`,
      { me: scope.salesUserId },
    );
  }

  /** Open leads only — a closed lead is not discussed at the meeting. */
  private openLeadsQuery(scope: MeetingPrepScope): SelectQueryBuilder<WinbackAccount> {
    const qb = this.accounts
      .createQueryBuilder('a')
      .where('a.stage NOT IN (:...closed)', { closed: [...CLOSED_WINBACK_STAGES] });
    return this.applyScope(qb, 'a', scope);
  }

  async getLeadSignals(scope: MeetingPrepScope, limit = DEFAULT_LEAD_LIMIT, now = new Date()) {
    const accounts = await this.openLeadsQuery(scope)
      // Never-touched leads sort first: they are the most urgent, and the ones
      // that must survive truncation when a big team hits the cap.
      .orderBy('a.last_activity_at', 'ASC', 'NULLS FIRST')
      .addOrderBy('a.create_date', 'ASC')
      .take(limit)
      .getMany();

    const accountIds = accounts.map((a) => a.id);
    const [historyByAccount, lastActivityByAccount, unloggedByAccount, namesById] =
      await Promise.all([
        this.loadStageHistory(accountIds),
        this.loadLastActivities(accountIds),
        this.loadUnloggedAppointments(accountIds, now),
        this.loadSalesUserNames(accounts),
      ]);

    const leads = accounts.map((a) => {
      const lastActivity = lastActivityByAccount.get(a.id) ?? null;
      return {
        account_id: a.id,
        display_name: a.display_name ?? a.restaurant_name ?? a.company_name,
        assigned_sales_user_id: a.assigned_sales_user_id,
        assigned_sales_user_name: a.assigned_sales_user_id
          ? namesById.get(a.assigned_sales_user_id) ?? null
          : null,
        // No fallback on purpose. NULL means "we do not know when this rep got
        // it", which the app renders as ไม่ทราบวันที่รับ; substituting
        // create_date here would look like a real assignment date and cannot be
        // told apart from one downstream.
        assigned_at: a.assigned_at,
        stage: a.stage,
        stage_entered_at:
          stageEnteredAt(historyByAccount.get(a.id) ?? [], a.stage) ??
          a.promoted_to_lead_at ??
          a.create_date,
        last_activity_at: lastActivity?.activity_at ?? null,
        last_activity_type: lastActivity?.type ?? null,
        last_note: truncateNote(lastActivity?.note),
        unlogged_appointments: unloggedByAccount.get(a.id) ?? [],
      };
    });

    return { leads, ...(await this.getStageTiming(scope, now)) };
  }

  /**
   * Median days per stage, from transitions completed in the last 90 days —
   * once for the team, once per rep. A single fixed threshold cannot work here:
   * negotiate legitimately runs longer than contacted, so one number would flag
   * every negotiation and no first contact.
   *
   * Both are measured over **every** account, including ones that have since
   * closed or been rejected. Restricting to open leads would drop exactly the
   * deals that moved fast enough to close, leaving a median built only from the
   * slow ones — which is also why a client holding only live leads cannot
   * compute this for itself.
   *
   * The team line is not scoped at all, so a lead is measured against the same
   * benchmark whether a manager or its owner is looking at it. Only the per-rep
   * map is scoped, by `repIdsInScope`.
   */
  private async getStageTiming(scope: MeetingPrepScope, now: Date) {
    const windowEnd = now;
    const windowStart = new Date(now.getTime() - STAGE_MEDIAN_WINDOW_DAYS * DAY_MS);
    const lookbackStart = new Date(now.getTime() - STAGE_HISTORY_LOOKBACK_DAYS * DAY_MS);

    const rows = await this.stageHistory
      .createQueryBuilder('h')
      .select([
        'h.id',
        'h.account_id',
        'h.from_stage',
        'h.to_stage',
        'h.changed_at',
        'h.changed_by',
      ])
      .where('h.changed_at >= :lookbackStart', { lookbackStart })
      .andWhere('h.changed_at <= :windowEnd', { windowEnd })
      .orderBy('h.account_id', 'ASC')
      .addOrderBy('h.changed_at', 'ASC')
      .addOrderBy('h.id', 'ASC')
      .getMany();

    const stageMedianDays = medianStageDays(rows, windowStart, windowEnd);

    return {
      stage_median_days: stageMedianDays,
      stage_median_days_by_rep: medianStageDaysByActor(
        rows,
        windowStart,
        windowEnd,
        Object.keys(stageMedianDays),
        { allowedActorIds: await this.repIdsInScope(scope) },
      ),
    };
  }

  /**
   * Whose per-rep timing the caller may see: a sales user gets only their own
   * entry, a manager gets every active rep. Restricting to assignable roles
   * also keeps a stale or non-rep `changed_by` from surfacing as a "rep".
   */
  private async repIdsInScope(scope: MeetingPrepScope): Promise<Set<string>> {
    const requested = scope.requestedSalesUserId;
    if (!scope.isManager) return new Set([scope.salesUserId]);
    if (requested) return new Set([requested]);

    const reps = await listStaffRoster(this.users, WINBACK_ASSIGNABLE_ROLES);
    return new Set(reps.map((u) => u.id));
  }

  /** Stage history per account, newest first (what `stageEnteredAt` expects). */
  private async loadStageHistory(accountIds: string[]) {
    const byAccount = new Map<string, WinbackStageHistory[]>();
    if (!accountIds.length) return byAccount;

    const rows = await this.stageHistory.find({
      where: { account_id: In(accountIds) },
      order: { account_id: 'ASC', changed_at: 'DESC', id: 'DESC' },
    });
    for (const row of rows) {
      const list = byAccount.get(row.account_id) ?? [];
      list.push(row);
      byAccount.set(row.account_id, list);
    }
    return byAccount;
  }

  /**
   * The most recent *logged* activity per account. `activity_at`, `type` and
   * `note` all come from this one row so the three cannot disagree — which is
   * why this is preferred over the denormalized `winback_account.last_activity_at`.
   */
  private async loadLastActivities(accountIds: string[]) {
    const byAccount = new Map<string, WinbackActivity>();
    if (!accountIds.length) return byAccount;

    const rows = await this.activities
      .createQueryBuilder('act')
      .where('act.account_id IN (:...ids)', { ids: accountIds })
      .andWhere("act.status = 'done'")
      .orderBy('act.account_id', 'ASC')
      .addOrderBy('act.activity_at', 'DESC')
      .addOrderBy('act.id', 'DESC')
      .getMany();

    for (const row of rows) {
      if (!byAccount.has(row.account_id)) byAccount.set(row.account_id, row);
    }
    return byAccount;
  }

  /**
   * Appointments whose scheduled time has passed while still `planned` — the
   * rep either did not go or did not log it. Same rule as the 18:00 digest
   * (`WinbackNotifyService.notifyDailyDigest`), per lead and with no date bound.
   */
  private async loadUnloggedAppointments(accountIds: string[], now: Date) {
    const byAccount = new Map<string, { activity_id: string; scheduled_at: Date }[]>();
    if (!accountIds.length) return byAccount;

    const rows = await this.activities
      .createQueryBuilder('act')
      .select(['act.id', 'act.account_id', 'act.scheduled_at'])
      .where('act.account_id IN (:...ids)', { ids: accountIds })
      .andWhere("act.status = 'planned'")
      .andWhere('act.scheduled_at IS NOT NULL')
      .andWhere('act.scheduled_at < :now', { now })
      .orderBy('act.scheduled_at', 'ASC')
      .getMany();

    for (const row of rows) {
      const list = byAccount.get(row.account_id) ?? [];
      list.push({ activity_id: row.id, scheduled_at: row.scheduled_at as Date });
      byAccount.set(row.account_id, list);
    }
    return byAccount;
  }

  private async loadSalesUserNames(accounts: WinbackAccount[]) {
    const ids = [
      ...new Set(
        accounts
          .map((a) => a.assigned_sales_user_id)
          .filter((id): id is string => !!id),
      ),
    ];
    const byId = new Map<string, string | null>();
    if (!ids.length) return byId;

    const rows = await listStaffRoster(this.users, WINBACK_ASSIGNABLE_ROLES);
    for (const user of rows) if (ids.includes(user.id)) byId.set(user.id, user.name);
    return byId;
  }

  // --- Acknowledgements ---------------------------------------------------

  /**
   * A point is "the same point as last week" when account + signal + subject
   * all match. Rejecting a wrong subject here is the whole value of the store:
   * an unexpected subject makes a resolved point look unresolved forever, a
   * missing one makes a new appointment look like last week's.
   */
  private assertSubjectId(dto: CreateMeetingAckDto): string | null {
    const subject = dto.subject_id?.trim() || null;
    const required = requiresSubjectId(dto.signal);

    if (required && !subject) {
      throw new BadRequestException(
        `subject_id is required for signal "${dto.signal}"`,
      );
    }
    if (!required && subject) {
      throw new BadRequestException(
        `subject_id must be omitted for signal "${dto.signal}" — the lead itself is the subject`,
      );
    }
    if (
      dto.signal === WinbackMeetingSignal.STAGE_STALLED &&
      subject &&
      !(Object.values(WinbackStage) as string[]).includes(subject)
    ) {
      throw new BadRequestException(
        `subject_id for "stage_stalled" must be a winback stage, got "${subject}"`,
      );
    }
    return subject;
  }

  /**
   * Upsert on the identity triple; the later `discussed_at` wins.
   *
   * One statement, not read-then-write: two managers covering the same meeting
   * acknowledging the same point at the same moment is the expected case, and a
   * find-then-insert would lose that race on the unique index.
   */
  async acknowledge(dto: CreateMeetingAckDto, discussedBy: string | null) {
    const subjectId = this.assertSubjectId(dto);
    const discussedAt = new Date(dto.discussed_at);

    const [row] = await this.acks.query(
      `INSERT INTO winback_meeting_ack
         (account_id, signal, subject_id, discussed_at, discussed_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id, signal, COALESCE(subject_id, ''))
       DO UPDATE SET
         discussed_at = GREATEST(winback_meeting_ack.discussed_at, EXCLUDED.discussed_at),
         discussed_by = CASE
           WHEN EXCLUDED.discussed_at >= winback_meeting_ack.discussed_at
           THEN EXCLUDED.discussed_by ELSE winback_meeting_ack.discussed_by END,
         update_date = now()
       RETURNING account_id, signal, subject_id, discussed_at`,
      [dto.account_id, dto.signal, subjectId, discussedAt, discussedBy || null],
    );

    return this.toAckResponse(row);
  }

  /** Points discussed since `since` (default 8 weeks), within the caller's scope. */
  async listAcknowledgements(
    scope: MeetingPrepScope,
    sinceISO?: string,
    now = new Date(),
  ) {
    const since = sinceISO
      ? new Date(sinceISO)
      : new Date(now.getTime() - ACK_DEFAULT_WINDOW_DAYS * DAY_MS);

    const rows = await this.acks
      .createQueryBuilder('ack')
      .where('ack.discussed_at >= :since', { since })
      .andWhere((sub) => {
        const inner = this.applyScope(
          sub.subQuery().select('scoped.id').from(WinbackAccount, 'scoped'),
          'scoped',
          scope,
        );
        return `ack.account_id IN ${inner.getQuery()}`;
      })
      .orderBy('ack.discussed_at', 'DESC')
      .getMany();

    return rows.map((row) => this.toAckResponse(row));
  }

  /** `discussed_by` is stored for audit but has no client consumer. */
  private toAckResponse(row: WinbackMeetingAck) {
    return {
      account_id: row.account_id,
      signal: row.signal,
      subject_id: row.subject_id,
      discussed_at: row.discussed_at,
    };
  }
}
