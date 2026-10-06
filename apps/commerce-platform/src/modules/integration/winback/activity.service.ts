import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackStageHistory } from './entities/winback-stage-history.entity';
import {
  CancelActivityDto,
  CheckinDto,
  CheckoutDto,
  CompleteActivityDto,
  CreateActivityDto,
  RescheduleActivityDto,
} from './dto/create-activity.dto';
import { isVisit, nextStageAfterActivity } from './activity.helpers';
import { partitionCheckoutTypes } from './checkout.helpers';
import { WinbackStage } from './winback.enums';

@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(WinbackActivity) private readonly activities: Repository<WinbackActivity>,
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackStageHistory)
    private readonly stageHistory: Repository<WinbackStageHistory>,
  ) {}

  async log(accountId: string, salesUserId: string, dto: CreateActivityDto) {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('winback account not found');

    const planned = dto.status === 'planned';
    const activityAt = dto.activity_at ? new Date(dto.activity_at) : new Date();
    const activity = await this.activities.save(
      this.activities.create({
        account_id: accountId,
        sales_user_id: salesUserId,
        type: dto.type as WinbackActivity['type'],
        outcome: (dto.outcome ?? null) as WinbackActivity['outcome'],
        note: dto.note ?? null,
        activity_at: activityAt,
        next_follow_up_at: dto.next_follow_up_at ? new Date(dto.next_follow_up_at) : null,
        stage_after: dto.stage_after ?? null,
        status: planned ? 'planned' : 'done',
        scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
        photo_urls: dto.photo_urls ?? [],
        checkin_at: dto.checkin_at ? new Date(dto.checkin_at) : null,
        checkout_at: dto.checkout_at ? new Date(dto.checkout_at) : null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        contact_id: dto.contact_id ?? null,
      }),
    );

    if (planned) {
      // an appointment: set the follow-up marker; do not count as a done activity
      if (dto.scheduled_at) account.next_follow_up_at = new Date(dto.scheduled_at);
      const fromStage = account.stage;
      if (dto.stage_after) account.stage = dto.stage_after as WinbackStage;
      await this.accounts.save(account);
      await this.recordStageChange(
        accountId,
        fromStage,
        account.stage,
        salesUserId,
        activityAt,
        dto.note,
      );
      return activity;
    }

    const fromStage = account.stage;
    account.activity_count = (account.activity_count ?? 0) + 1;
    if (isVisit(dto.type)) account.visit_count = (account.visit_count ?? 0) + 1;
    account.last_activity_at = activityAt;
    account.stage = nextStageAfterActivity(account.stage, dto.stage_after) as WinbackStage;
    if (dto.next_follow_up_at) account.next_follow_up_at = new Date(dto.next_follow_up_at);
    await this.accounts.save(account);
    await this.recordStageChange(
      accountId,
      fromStage,
      account.stage,
      salesUserId,
      activityAt,
      dto.note,
    );
    return activity;
  }

  /** Turn a planned appointment into a done activity (applies account side-effects). */
  async complete(activityId: string, salesUserId: string, dto: CompleteActivityDto) {
    const activity = await this.activities.findOne({ where: { id: activityId } });
    if (!activity) throw new NotFoundException('activity not found');
    const account = await this.accounts.findOne({ where: { id: activity.account_id } });
    if (!account) throw new NotFoundException('winback account not found');

    const now = dto.activity_at ? new Date(dto.activity_at) : new Date();
    activity.status = 'done';
    activity.activity_at = now;
    activity.sales_user_id = salesUserId || activity.sales_user_id;
    if (dto.outcome !== undefined) activity.outcome = dto.outcome as WinbackActivity['outcome'];
    if (dto.note !== undefined) activity.note = dto.note ?? null;
    if (dto.stage_after !== undefined) activity.stage_after = dto.stage_after ?? null;
    if (dto.photo_urls !== undefined) activity.photo_urls = dto.photo_urls ?? [];
    await this.activities.save(activity);

    const fromStage = account.stage;
    account.activity_count = (account.activity_count ?? 0) + 1;
    if (isVisit(activity.type)) account.visit_count = (account.visit_count ?? 0) + 1;
    account.last_activity_at = now;
    account.stage = nextStageAfterActivity(account.stage, dto.stage_after) as WinbackStage;
    await this.accounts.save(account);
    await this.recordStageChange(
      account.id,
      fromStage,
      account.stage,
      activity.sales_user_id,
      now,
      activity.note,
    );
    return activity;
  }

  /**
   * Clock in to a visit: stamp planned appointment or create a new activity + GPS.
   * Status becomes `in_progress` — `activity_count`/`visit_count` are NOT bumped
   * here; they only increment on checkout, once the visit is actually confirmed
   * done. This is what previously caused a double-counted follow-up ("ติดตามครั้งที่ 3
   * on first check-in"): stage auto-advance (prospect/inactive_pool -> contacted)
   * still runs once on check-in since that reflects "we made contact", not a
   * completed activity.
   */
  async checkin(accountId: string, salesUserId: string, dto: CheckinDto) {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('winback account not found');

    const open = await this.activities.findOne({
      where: { account_id: accountId, status: 'in_progress' },
      order: { checkin_at: 'DESC' },
    });
    if (open) {
      if (dto.lat !== undefined) open.lat = dto.lat;
      if (dto.lng !== undefined) open.lng = dto.lng;
      return this.activities.save(open);
    }

    const now = new Date();

    if (dto.planned_activity_id) {
      const planned = await this.activities.findOne({
        where: { id: dto.planned_activity_id, account_id: accountId },
      });
      if (planned && planned.status === 'planned') {
        planned.status = 'in_progress';
        planned.checkin_at = now;
        planned.activity_at = now;
        planned.sales_user_id = salesUserId || planned.sales_user_id;
        planned.lat = dto.lat ?? planned.lat;
        planned.lng = dto.lng ?? planned.lng;
        if (dto.note) {
          planned.note = planned.note ? `${planned.note}\n${dto.note}` : dto.note;
        }
        if (dto.type) planned.type = dto.type as WinbackActivity['type'];
        await this.activities.save(planned);

        const fromStage = account.stage;
        account.stage = nextStageAfterActivity(account.stage) as WinbackStage;
        await this.accounts.save(account);
        await this.recordStageChange(
          accountId,
          fromStage,
          account.stage,
          planned.sales_user_id,
          now,
          planned.note,
        );
        return planned;
      }
    }

    const activity = await this.activities.save(
      this.activities.create({
        account_id: accountId,
        sales_user_id: salesUserId,
        type: dto.type as WinbackActivity['type'],
        note: dto.note ?? null,
        activity_at: now,
        checkin_at: now,
        status: 'in_progress',
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        contact_id: dto.contact_id ?? null,
      }),
    );
    const fromStage = account.stage;
    account.stage = nextStageAfterActivity(account.stage) as WinbackStage;
    await this.accounts.save(account);
    await this.recordStageChange(
      accountId,
      fromStage,
      account.stage,
      salesUserId,
      now,
      dto.note,
    );
    return activity;
  }

  /**
   * Clock out: requires an open (`in_progress`) check-in. Sets outcome + status
   * `done` on the existing row for the type that reuses it (visit/store_visit
   * wins so the checked-in row stays the visit record); every other selected
   * type becomes a new sibling `done` contact activity. Counters increment once
   * per resulting `done` activity (the reused row + each sibling).
   */
  async checkout(activityId: string, dto: CheckoutDto) {
    const activity = await this.activities.findOne({ where: { id: activityId } });
    if (!activity) throw new NotFoundException('activity not found');
    if (!activity.checkin_at) throw new BadRequestException('activity has no check-in');
    if (activity.status !== 'in_progress') {
      throw new BadRequestException('activity is not in progress');
    }
    if (activity.checkout_at) throw new BadRequestException('already checked out');

    const { primaryType, extraTypes } = partitionCheckoutTypes(dto.types, activity.type);
    const now = new Date();
    activity.type = primaryType as WinbackActivity['type'];
    activity.outcome = dto.outcome as WinbackActivity['outcome'];
    activity.checkout_at = now;
    activity.status = 'done';
    if (dto.photo_urls?.length) {
      activity.photo_urls = [...(activity.photo_urls ?? []), ...dto.photo_urls];
    }
    if (dto.note?.trim()) {
      activity.note = activity.note ? `${activity.note}\n${dto.note.trim()}` : dto.note.trim();
    }
    await this.activities.save(activity);

    const account = await this.accounts.findOne({ where: { id: activity.account_id } });
    if (!account) throw new NotFoundException('winback account not found');

    let contactDone = 1;
    account.activity_count = (account.activity_count ?? 0) + 1;
    if (isVisit(activity.type)) account.visit_count = (account.visit_count ?? 0) + 1;
    account.last_activity_at = now;

    for (const t of extraTypes) {
      await this.activities.save(
        this.activities.create({
          account_id: activity.account_id,
          sales_user_id: activity.sales_user_id,
          type: t as WinbackActivity['type'],
          outcome: activity.outcome,
          note: dto.note ?? null,
          activity_at: now,
          checkin_at: activity.checkin_at,
          checkout_at: now,
          status: 'done',
          lat: activity.lat,
          lng: activity.lng,
          photo_urls: [],
        }),
      );
      contactDone += 1;
      account.activity_count = (account.activity_count ?? 0) + 1;
      if (isVisit(t)) account.visit_count = (account.visit_count ?? 0) + 1;
    }
    await this.accounts.save(account);
    return { activity, contact_done: contactDone };
  }

  /** Move a planned appointment to a new date/time; does not touch status/outcome/stage. */
  async reschedule(activityId: string, dto: RescheduleActivityDto) {
    const activity = await this.activities.findOne({ where: { id: activityId } });
    if (!activity) throw new NotFoundException('activity not found');
    if (activity.status !== 'planned') {
      throw new BadRequestException('only a planned activity can be rescheduled');
    }
    activity.scheduled_at = new Date(dto.scheduled_at);
    await this.activities.save(activity);
    return activity;
  }

  /** Cancel a planned appointment that hasn't happened yet. */
  async cancel(activityId: string, dto: CancelActivityDto) {
    const activity = await this.activities.findOne({ where: { id: activityId } });
    if (!activity) throw new NotFoundException('activity not found');
    if (activity.status !== 'planned') {
      throw new BadRequestException('only a planned activity can be cancelled');
    }
    activity.status = 'cancelled';
    if (dto.reason?.trim()) {
      activity.note = activity.note
        ? `${activity.note}\nยกเลิก: ${dto.reason.trim()}`
        : `ยกเลิก: ${dto.reason.trim()}`;
    }
    await this.activities.save(activity);
    return activity;
  }

  async list(accountId: string) {
    return this.activities.find({
      where: { account_id: accountId },
      order: { activity_at: 'DESC' },
    });
  }

  /**
   * Move a lead to a new stage and record WHY in its diary.
   * `note` is the reason for the move; rejection also carries a structured reason.
   */
  async moveStage(
    accountId: string,
    salesUserId: string,
    stage: string,
    opts: { note?: string; rejectReason?: string; rejectNote?: string } = {},
  ) {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('winback account not found');
    const fromStage = account.stage;
    const changed = account.stage !== stage;
    account.stage = stage as typeof account.stage;
    if (stage === 'rejected') {
      account.reject_reason = opts.rejectReason ?? account.reject_reason ?? null;
      account.reject_note = opts.rejectNote ?? account.reject_note ?? null;
    }
    if (changed) {
      const now = new Date();
      account.activity_count = (account.activity_count ?? 0) + 1;
      account.last_activity_at = now;
      await this.accounts.save(account);
      const label = stage === 'rejected' ? `ปฏิเสธ: ${opts.rejectReason ?? '-'}` : 'เลื่อนขั้น';
      const note = opts.note ? `${label} — ${opts.note}` : label;
      await this.activities.save(
        this.activities.create({
          account_id: accountId,
          sales_user_id: salesUserId,
          type: 'note' as WinbackActivity['type'],
          note,
          stage_after: stage,
          activity_at: now,
        }),
      );
      await this.recordStageChange(
        accountId,
        fromStage,
        account.stage,
        salesUserId,
        now,
        opts.note,
      );
    } else {
      await this.accounts.save(account);
    }
    return account;
  }

  private async recordStageChange(
    accountId: string,
    fromStage: string,
    toStage: string,
    changedBy: string,
    changedAt: Date,
    note?: string | null,
  ): Promise<void> {
    if (fromStage === toStage) return;
    await this.stageHistory.save(
      this.stageHistory.create({
        account_id: accountId,
        from_stage: fromStage,
        to_stage: toStage,
        changed_by: changedBy,
        changed_at: changedAt,
        note: note ?? null,
      }),
    );
  }
}
