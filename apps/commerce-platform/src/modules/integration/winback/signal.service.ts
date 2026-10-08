import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackAppRecord } from './entities/winback-app-record.entity';
import { buildWorklist } from './worklist.helpers';
import { CompleteSignalDto, DismissSignalDto, SignalQueryDto, SnoozeSignalDto } from './dto/app-gaps.dto';
import {
  bangkokDay,
  bangkokToday,
  revenueContext,
  SignalAction,
  signalActionApplies,
  signalVisible,
  toRevenueSignal,
} from './app-gaps.helpers';
import { WinbackActor } from './app-records.service';
import { WinbackAppRecordKind as Kind, WinbackHealth, WinbackSignalStatus } from './winback.enums';

/** Accounts scored per list call (the same over-fetch my-day's worklist uses). */
const SIGNAL_CANDIDATES = 300;

/**
 * Revenue signals = the reorder-baseline worklist (`reactivate` / `prevent`, same ranking and reasons as
 * my-day), with what the rep did about each one. A signal's id is its account id.
 */
@Injectable()
export class SignalService {
  constructor(
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackAppRecord) private readonly records: Repository<WinbackAppRecord>,
  ) {}

  private own(salesUserId: string) {
    return [{ assigned_sales_user_id: salesUserId }, { created_by_sales_user_id: salesUserId }];
  }

  private async actions(accountIds: string[]): Promise<Map<string, SignalAction>> {
    if (!accountIds.length) return new Map();
    const rows = await this.records.find({ where: { kind: Kind.SIGNAL_ACTION, record_key: In(accountIds) } });
    return new Map(rows.map((r) => [r.record_key!, r.payload as unknown as SignalAction]));
  }

  async list(actor: WinbackActor, q: SignalQueryDto) {
    const salesUserId = actor.isManager ? q.sales_user_id : actor.id;
    // A revenue signal is about order history: a new lead that never ordered is pipeline work, not a signal.
    const base = { health: In([WinbackHealth.WATCH, WinbackHealth.DORMANT]), last_order_at: Not(IsNull()) };
    const where = salesUserId ? this.own(salesUserId).map((o) => ({ ...o, ...base })) : base;
    const candidates = await this.accounts.find({ where, take: SIGNAL_CANDIDATES, order: { delay_ratio: 'DESC' } });
    const items = buildWorklist(candidates, candidates.length);
    const actions = await this.actions(items.map((i) => i.id));
    const lastOrder = new Map(candidates.map((a) => [a.id, a.last_order_at]));
    const today = bangkokToday();
    return items
      .map((item) => {
        const action = actions.get(item.id);
        return toRevenueSignal(item, signalActionApplies(action, lastOrder.get(item.id) ?? null) ? action : null);
      })
      .filter((s) => signalVisible(s, q.status, today))
      .slice(0, q.limit);
  }

  private async signalFor(actor: WinbackActor, accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Signal not found');
    if (
      !actor.isManager &&
      account.assigned_sales_user_id !== actor.id &&
      account.created_by_sales_user_id !== actor.id
    ) {
      throw new ForbiddenException('จัดการได้เฉพาะงานของลูกค้าที่ตัวเองดูแล');
    }
    const [item] = account.last_order_at ? buildWorklist([account], 1) : [];
    if (!item) throw new NotFoundException('Signal not found');
    return { account, item };
  }

  private async act(actor: WinbackActor, accountId: string, action: Omit<SignalAction, 'acted_at'>) {
    const { account, item } = await this.signalFor(actor, accountId);
    const payload: SignalAction = { ...action, acted_at: new Date().toISOString() };
    const existing = await this.records.findOne({ where: { kind: Kind.SIGNAL_ACTION, record_key: accountId } });
    const row = existing ?? this.records.create({ kind: Kind.SIGNAL_ACTION, record_key: accountId, version: 0 });
    Object.assign(row, {
      account_id: account.id,
      sales_user_id: actor.id,
      created_by: actor.id,
      status: payload.status,
      payload: payload as unknown as Record<string, unknown>,
      version: (row.version ?? 0) + 1,
    });
    await this.records.save(row);
    return toRevenueSignal(item, payload);
  }

  /** Record only: completing a signal logs no activity and creates no order. */
  complete(actor: WinbackActor, accountId: string, dto: CompleteSignalDto) {
    return this.act(actor, accountId, {
      status: WinbackSignalStatus.COMPLETED,
      outcome: dto.outcome,
      note: dto.note?.trim() || null,
    });
  }

  snooze(actor: WinbackActor, accountId: string, dto: SnoozeSignalDto) {
    const until = bangkokDay(dto.until);
    if (until <= bangkokToday()) throw new BadRequestException('until ต้องเป็นวันในอนาคต');
    return this.act(actor, accountId, { status: WinbackSignalStatus.OPEN, snoozed_until: until });
  }

  dismiss(actor: WinbackActor, accountId: string, dto: DismissSignalDto) {
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('reason ต้องไม่ว่าง');
    return this.act(actor, accountId, { status: WinbackSignalStatus.DISMISSED, reason });
  }

  /** Lead detail "revenue context". `{}` = no order history (the app hides the section). */
  async revenueContext(accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException('winback account not found');
    const [item] = buildWorklist([account], 1);
    return revenueContext(account, item?.recommended_action ?? null);
  }
}
