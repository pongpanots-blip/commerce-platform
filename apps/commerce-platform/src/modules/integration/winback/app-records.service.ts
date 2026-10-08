import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackActivity } from './entities/winback-activity.entity';
import { WinbackAppRecord } from './entities/winback-app-record.entity';
import { LeadService } from './lead.service';
import {
  ActivityDraftDto,
  AppointmentPlanDto,
  CoachingTaskQueryDto,
  CreateCoachingTaskDto,
  DiscoveryQueryDto,
  JointVisitDto,
  TeamDto,
  UpdateCoachingTaskDto,
  VisitCompletionDto,
  VisitStartEvidenceDto,
  WorkPlanDto,
} from './dto/app-gaps.dto';
import { appointmentEndError } from './app-gaps.helpers';
import { WINBACK_WORK_PLAN_STEPS, WinbackAppRecordKind as Kind, WinbackNextAction } from './winback.enums';

/** Who is calling: the JWT `sub` and whether their role sees the team. */
export interface WinbackActor {
  id: string;
  isManager: boolean;
}

export const SYNC_SOURCES = [{ id: 'josh_dormant', label: 'ลูกค้า dormant จาก Josh' }];

type Payload = Record<string, unknown>;

/**
 * The app-owned records (winback_app_record) behind screens that had no API. Each kind keeps its body in
 * `payload` (snake_case), and every read flattens it next to the row's own columns.
 */
@Injectable()
export class AppRecordsService {
  constructor(
    @InjectRepository(WinbackAppRecord) private readonly records: Repository<WinbackAppRecord>,
    @InjectRepository(WinbackAccount) private readonly accounts: Repository<WinbackAccount>,
    @InjectRepository(WinbackActivity) private readonly activities: Repository<WinbackActivity>,
    private readonly leads: LeadService,
  ) {}

  // --- generic store ---

  view(r: WinbackAppRecord): Payload {
    return {
      id: r.id,
      ...r.payload,
      sales_user_id: r.sales_user_id,
      account_id: r.account_id,
      status: r.status,
      version: r.version,
      created_at: r.create_date,
      updated_at: r.update_date,
    };
  }

  byKey(kind: Kind, key: string) {
    return this.records.findOne({ where: { kind, record_key: key } });
  }

  async byId(kind: Kind, id: string) {
    const row = await this.records.findOne({ where: { kind, id } });
    if (!row) throw new NotFoundException('ไม่พบรายการนี้');
    return row;
  }

  /** Insert or replace the row for `kind + key` (latest write wins). */
  async put(
    kind: Kind,
    key: string | null,
    fields: Partial<Pick<WinbackAppRecord, 'sales_user_id' | 'account_id' | 'status' | 'created_by'>>,
    payload: Payload,
  ) {
    const existing = key ? await this.byKey(kind, key) : null;
    const row = existing ?? this.records.create({ kind, record_key: key, version: 0 });
    Object.assign(row, fields);
    row.payload = payload;
    row.version = (row.version ?? 0) + 1;
    return this.records.save(row);
  }

  private async account(id: string) {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('winback account not found');
    return account;
  }

  private async activity(id: string) {
    const activity = await this.activities.findOne({ where: { id } });
    if (!activity) throw new NotFoundException('activity not found');
    return activity;
  }

  /** Activity extras are written by the activity's rep or a manager. */
  private assertActivityWriter(activity: WinbackActivity, actor: WinbackActor) {
    if (!actor.isManager && activity.sales_user_id !== actor.id) {
      throw new ForbiddenException('บันทึกได้เฉพาะกิจกรรมของตัวเอง');
    }
  }

  // --- activity drafts (one per user + key; key = account id or `standalone`) ---

  async getDraft(actor: WinbackActor, key: string) {
    const row = await this.byKey(Kind.ACTIVITY_DRAFT, `${actor.id}|${key}`);
    return row ? { key, ...this.view(row) } : null;
  }

  async saveDraft(actor: WinbackActor, key: string, dto: ActivityDraftDto) {
    const row = await this.put(
      Kind.ACTIVITY_DRAFT,
      `${actor.id}|${key}`,
      { sales_user_id: actor.id, account_id: dto.account_id ?? null, created_by: actor.id },
      {
        account_name: dto.account_name ?? null,
        type: dto.type,
        outcome: dto.outcome || null,
        note: dto.note ?? '',
        activity_at: dto.activity_at ?? new Date().toISOString(),
        next_follow_up_at: dto.next_follow_up_at ?? null,
        follow_up_action: dto.follow_up_action ?? null,
        photo_urls: dto.photo_urls ?? [],
      },
    );
    return { key, ...this.view(row) };
  }

  async deleteDraft(actor: WinbackActor, key: string) {
    await this.records.delete({ kind: Kind.ACTIVITY_DRAFT, record_key: `${actor.id}|${key}` });
    return { deleted: true };
  }

  // --- coaching tasks (manager → rep) ---

  private coachingView(r: WinbackAppRecord): Payload {
    const v = this.view(r);
    return { ...v, is_done: !!r.payload.completed_at };
  }

  async listCoachingTasks(actor: WinbackActor, q: CoachingTaskQueryDto) {
    const salesUserId = actor.isManager ? q.sales_user_id : actor.id;
    const where: Record<string, unknown> = { kind: Kind.COACHING_TASK };
    if (salesUserId) where.sales_user_id = salesUserId;
    if (q.account_id) where.account_id = q.account_id;
    if (q.open_only) where.status = 'open';
    const rows = await this.records.find({ where, take: 500 });
    return rows
      .map((r) => this.coachingView(r))
      .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  }

  async createCoachingTask(actor: WinbackActor, dto: CreateCoachingTaskDto) {
    if (!actor.isManager) throw new ForbiddenException('เฉพาะ manager ที่สร้างงานโค้ชได้');
    const account = await this.account(dto.account_id);
    const row = await this.put(
      Kind.COACHING_TASK,
      null,
      { sales_user_id: dto.sales_user_id, account_id: dto.account_id, status: 'open', created_by: actor.id },
      {
        account_name: account.display_name ?? account.customer_code,
        action: dto.action.trim(),
        due_at: dto.due_at,
        manager_note: dto.manager_note.trim(),
        result: null,
        completed_at: null,
      },
    );
    return this.coachingView(row);
  }

  async updateCoachingTask(actor: WinbackActor, id: string, dto: UpdateCoachingTaskDto) {
    const row = await this.byId(Kind.COACHING_TASK, id);
    const isRep = row.sales_user_id === actor.id;
    if (!actor.isManager && !isRep) throw new ForbiddenException('แก้ไขได้เฉพาะงานของตัวเอง');
    const managerFields = (['action', 'due_at', 'manager_note'] as const).filter((k) => dto[k] !== undefined);
    if (managerFields.length && !actor.isManager) {
      throw new ForbiddenException('เฉพาะ manager ที่แก้รายละเอียดงานโค้ชได้');
    }
    const payload = { ...row.payload };
    for (const k of managerFields) payload[k] = typeof dto[k] === 'string' ? (dto[k] as string).trim() : dto[k];
    if (dto.completed_at !== undefined || dto.result !== undefined) {
      const completedAt = dto.completed_at === undefined ? (payload.completed_at as string | null) : dto.completed_at;
      const result = dto.result === undefined ? (payload.result as string | null) : dto.result;
      if (completedAt && !result?.trim()) throw new BadRequestException('ปิดงานต้องใส่ผลลัพธ์ (result)');
      payload.completed_at = completedAt ?? null;
      payload.result = completedAt ? result!.trim() : (result?.trim() || null);
    }
    row.payload = payload;
    row.status = payload.completed_at ? 'done' : 'open';
    row.version += 1;
    return this.coachingView(await this.records.save(row));
  }

  // --- teams (manager-defined grouping of reps for the pipeline) ---

  private teamView(r: WinbackAppRecord) {
    return { id: r.id, name: r.payload.name, sales_user_ids: r.payload.sales_user_ids ?? [], updated_at: r.update_date };
  }

  async listTeams() {
    const rows = await this.records.find({ where: { kind: Kind.TEAM }, take: 200 });
    return rows.map((r) => this.teamView(r)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  private async assertReps(ids: string[]) {
    if (!ids.length) return;
    const roster = new Set((await this.leads.listSalesUsers()).map((u: { id: string }) => u.id));
    const unknown = ids.filter((id) => !roster.has(id));
    if (unknown.length) throw new BadRequestException(`ไม่ใช่เซลล์ในระบบ: ${unknown.join(', ')}`);
  }

  async saveTeam(actor: WinbackActor, id: string | null, dto: TeamDto) {
    if (!actor.isManager) throw new ForbiddenException('เฉพาะ manager ที่จัดทีมได้');
    await this.assertReps(dto.sales_user_ids);
    const row = id ? await this.byId(Kind.TEAM, id) : this.records.create({ kind: Kind.TEAM, version: 0, created_by: actor.id });
    row.payload = { name: dto.name.trim(), sales_user_ids: dto.sales_user_ids };
    row.version = (row.version ?? 0) + 1;
    return this.teamView(await this.records.save(row));
  }

  async deleteTeam(actor: WinbackActor, id: string) {
    if (!actor.isManager) throw new ForbiddenException('เฉพาะ manager ที่จัดทีมได้');
    await this.records.delete({ kind: Kind.TEAM, id });
    return { deleted: true };
  }

  // --- work plan (one per account) ---

  static defaultWorkPlan(accountId: string) {
    return {
      account_id: accountId,
      completed: [] as string[],
      next_action: WinbackNextAction.PREPARE_VISIT as string,
      due_at: null as string | null,
      blocker: '',
      note: '',
      preparation_complete: false,
      updated_at: null as Date | null,
    };
  }

  private workPlanView(accountId: string, r: WinbackAppRecord | null) {
    if (!r) return AppRecordsService.defaultWorkPlan(accountId);
    return { ...AppRecordsService.defaultWorkPlan(accountId), ...r.payload, account_id: accountId, updated_at: r.update_date };
  }

  async getWorkPlan(accountId: string) {
    return this.workPlanView(accountId, await this.byKey(Kind.WORK_PLAN, accountId));
  }

  async listWorkPlans(accountIds: string[]) {
    const rows = accountIds.length
      ? await this.records.find({ where: { kind: Kind.WORK_PLAN, record_key: In(accountIds) } })
      : [];
    const byAccount = new Map(rows.map((r) => [r.record_key!, r]));
    return accountIds.map((id) => this.workPlanView(id, byAccount.get(id) ?? null));
  }

  /** Partial update: fields left out keep their value. */
  async saveWorkPlan(actor: WinbackActor, accountId: string, dto: WorkPlanDto) {
    await this.account(accountId);
    const current = await this.getWorkPlan(accountId);
    const next = {
      completed: dto.completed ?? current.completed,
      next_action: dto.next_action ?? current.next_action,
      due_at: dto.due_at === undefined ? current.due_at : dto.due_at,
      blocker: dto.blocker === undefined ? current.blocker : dto.blocker.trim(),
      note: dto.note === undefined ? current.note : dto.note.trim(),
      preparation_complete: dto.preparation_complete ?? current.preparation_complete,
    };
    const allSteps = WINBACK_WORK_PLAN_STEPS.every((s) => next.completed.includes(s));
    if (dto.preparation_complete && !allSteps) {
      throw new BadRequestException('ติ๊กเตรียมพร้อมได้เมื่อทำครบทุกขั้น (contact, objective, materials, follow_up)');
    }
    // Unticking a step un-readies the plan, as on the app.
    if (!allSteps) next.preparation_complete = false;
    const row = await this.put(Kind.WORK_PLAN, accountId, { account_id: accountId, sales_user_id: actor.id }, next);
    return this.workPlanView(accountId, row);
  }

  // --- saved places / discovery query (per user) ---

  async listSavedPlaces(actor: WinbackActor): Promise<string[]> {
    const rows = await this.records.find({
      where: { kind: Kind.SAVED_PLACE, sales_user_id: actor.id },
      order: { create_date: 'ASC' },
      take: 1000,
    });
    return rows.map((r) => String(r.payload.place_id));
  }

  async setSavedPlace(actor: WinbackActor, placeId: string, saved: boolean) {
    const key = `${actor.id}|${placeId}`;
    if (saved) {
      if (!(await this.byKey(Kind.SAVED_PLACE, key))) {
        await this.put(Kind.SAVED_PLACE, key, { sales_user_id: actor.id, created_by: actor.id }, { place_id: placeId });
      }
    } else {
      await this.records.delete({ kind: Kind.SAVED_PLACE, record_key: key });
    }
    return this.listSavedPlaces(actor);
  }

  private static readonly EMPTY_DISCOVERY = { province_code: null, radius_km: null, origin_lat: null, origin_lng: null };

  async getDiscoveryQuery(actor: WinbackActor) {
    const row = await this.byKey(Kind.DISCOVERY_QUERY, actor.id);
    return { ...AppRecordsService.EMPTY_DISCOVERY, ...(row?.payload ?? {}), updated_at: row?.update_date ?? null };
  }

  async saveDiscoveryQuery(actor: WinbackActor, dto: DiscoveryQueryDto) {
    const lat = dto.origin_lat ?? null;
    const lng = dto.origin_lng ?? null;
    if ((lat === null) !== (lng === null)) throw new BadRequestException('origin_lat และ origin_lng ต้องส่งคู่กัน');
    if (lat === 0 && lng === 0) throw new BadRequestException('origin (0,0) ไม่ใช่พิกัดจริง');
    if (dto.radius_km != null && lat === null) throw new BadRequestException('radius_km ต้องมี origin_lat/origin_lng');
    const payload = {
      province_code: dto.province_code ?? null,
      radius_km: dto.radius_km ?? null,
      origin_lat: lat,
      origin_lng: lng,
    };
    const row = await this.put(Kind.DISCOVERY_QUERY, actor.id, { sales_user_id: actor.id }, payload);
    return { ...payload, updated_at: row.update_date };
  }

  // --- appointment plan / visit completion / start evidence / joint visit (one per activity) ---

  private activityRecord(kind: Kind, activityId: string) {
    return this.byKey(kind, activityId).then((r) => (r ? { activity_id: activityId, ...this.view(r) } : null));
  }

  getAppointmentPlan(activityId: string) {
    return this.activityRecord(Kind.APPOINTMENT_PLAN, activityId);
  }

  async saveAppointmentPlan(actor: WinbackActor, activityId: string, dto: AppointmentPlanDto) {
    const activity = await this.activity(activityId);
    this.assertActivityWriter(activity, actor);
    const endError = appointmentEndError(activity.scheduled_at, dto.end_at);
    if (endError) throw new BadRequestException(endError);
    const products = dto.products ?? [];
    const seen = new Set<string>();
    for (const p of products) {
      const k = `${p.product_id}|${p.unit_id}`;
      if (seen.has(k)) throw new BadRequestException(`สินค้าซ้ำ: ${p.sku} (${p.unit_label})`);
      seen.add(k);
    }
    const ids = new Set(products.map((p) => p.product_id));
    const prepared = dto.prepared_product_ids ?? [];
    if (prepared.some((id) => !ids.has(id))) throw new BadRequestException('prepared_product_ids ต้องเป็นสินค้าในแผน');
    const row = await this.put(
      Kind.APPOINTMENT_PLAN,
      activityId,
      { account_id: activity.account_id, sales_user_id: activity.sales_user_id, created_by: actor.id },
      {
        place_code: dto.place_code,
        place_detail: dto.place_detail?.trim() ?? '',
        purpose_code: dto.purpose_code,
        objective: dto.objective.trim(),
        note: dto.note?.trim() ?? '',
        products,
        prepared_product_ids: prepared,
        documents_prepared: dto.documents_prepared ?? false,
        scheduled_at: activity.scheduled_at,
        end_at: dto.end_at ?? null,
      },
    );
    return { activity_id: activityId, ...this.view(row) };
  }

  getVisitCompletion(activityId: string) {
    return this.activityRecord(Kind.VISIT_COMPLETION, activityId);
  }

  /**
   * Products presented at the visit (+ reaction), the quote shown, and the agreed next step. A next step is
   * also written to the account's work plan (`next_action` / `due_at`), as the app does after checkout.
   */
  async saveVisitCompletion(actor: WinbackActor, activityId: string, dto: VisitCompletionDto) {
    const activity = await this.activity(activityId);
    this.assertActivityWriter(activity, actor);
    if (!!dto.next_action !== !!dto.follow_up_at) {
      throw new BadRequestException('next_action และ follow_up_at ต้องส่งคู่กัน');
    }
    const seen = new Set<string>();
    for (const p of dto.products) {
      const k = `${p.product_id}|${p.unit_id}`;
      if (seen.has(k)) throw new BadRequestException(`สินค้าซ้ำ: ${p.sku} (${p.unit_label})`);
      seen.add(k);
    }
    if (dto.quote_id) {
      const quote = await this.records.findOne({ where: { kind: Kind.QUOTE, id: dto.quote_id } });
      if (!quote || quote.account_id !== activity.account_id) {
        throw new BadRequestException('ใบเสนอราคานี้ไม่ใช่ของลูกค้ารายนี้');
      }
    }
    const row = await this.put(
      Kind.VISIT_COMPLETION,
      activityId,
      { account_id: activity.account_id, sales_user_id: activity.sales_user_id, created_by: actor.id },
      {
        products: dto.products,
        quote_id: dto.quote_id ?? null,
        quote_label: dto.quote_label ?? null,
        next_action: dto.next_action ?? null,
        follow_up_at: dto.follow_up_at ?? null,
      },
    );
    if (dto.next_action && dto.follow_up_at) {
      await this.saveWorkPlan(actor, activity.account_id, { next_action: dto.next_action, due_at: dto.follow_up_at });
    }
    return { activity_id: activityId, ...this.view(row) };
  }

  getStartEvidence(activityId: string) {
    return this.activityRecord(Kind.VISIT_START_EVIDENCE, activityId);
  }

  async saveStartEvidence(actor: WinbackActor, activityId: string, dto: VisitStartEvidenceDto) {
    const activity = await this.activity(activityId);
    this.assertActivityWriter(activity, actor);
    if (!activity.checkin_at) throw new BadRequestException('activity has no check-in');
    const row = await this.put(
      Kind.VISIT_START_EVIDENCE,
      activityId,
      { account_id: activity.account_id, sales_user_id: activity.sales_user_id, created_by: actor.id },
      { photo_urls: dto.photo_urls },
    );
    return { activity_id: activityId, ...this.view(row) };
  }

  async listJointVisits(accountId: string) {
    const rows = await this.records.find({ where: { kind: Kind.JOINT_VISIT, account_id: accountId }, take: 200 });
    const activities = rows.length
      ? await this.activities.find({ where: { id: In(rows.map((r) => r.record_key!)) } })
      : [];
    const status = new Map(activities.map((a) => [a.id, a.status]));
    return rows
      .map((r): Payload => ({ activity_id: r.record_key, ...this.view(r), current_activity_status: status.get(r.record_key!) ?? null }))
      .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  }

  /** A manager joins a rep on a planned visit (or brings a second rep). Record only — no notification. */
  async saveJointVisit(actor: WinbackActor, activityId: string, dto: JointVisitDto) {
    if (!actor.isManager) throw new ForbiddenException('เฉพาะ manager ที่นัดเยี่ยมร่วมได้');
    if (dto.participant_id === actor.id) throw new BadRequestException('ผู้ร่วมเยี่ยมต้องไม่ใช่ตัวเอง');
    const activity = await this.activity(activityId);
    if (activity.status !== 'planned') throw new BadRequestException('นัดเยี่ยมร่วมได้เฉพาะนัดหมายที่ยังไม่เกิดขึ้น (planned)');
    const roster = (await this.leads.listSalesUsers()) as Array<{ id: string; name?: string | null; email?: string | null }>;
    const participant = roster.find((u) => u.id === dto.participant_id);
    if (!participant) throw new BadRequestException('ผู้ร่วมเยี่ยมไม่ใช่เซลล์ในระบบ');
    const row = await this.put(
      Kind.JOINT_VISIT,
      activityId,
      { account_id: activity.account_id, sales_user_id: dto.participant_id, created_by: actor.id },
      {
        organizer_id: actor.id,
        participant_id: dto.participant_id,
        participant_name: participant.name || participant.email || null,
        scheduled_at: activity.scheduled_at,
        note: dto.note.trim(),
      },
    );
    return { activity_id: activityId, ...this.view(row), current_activity_status: activity.status };
  }

  // --- sync history ---

  async recordSyncRun(actor: WinbackActor, days: number | undefined, result: Record<string, unknown>, startedAt: Date) {
    const finishedAt = new Date();
    const span = days ?? 365;
    const row = await this.put(
      Kind.SYNC_RUN,
      null,
      { sales_user_id: actor.id || null, created_by: actor.id || null, status: 'done' },
      {
        source_id: SYNC_SOURCES[0].id,
        source_label: SYNC_SOURCES[0].label,
        days: span,
        from: new Date(finishedAt.getTime() - (span - 1) * 86_400_000).toISOString().slice(0, 10),
        to: finishedAt.toISOString().slice(0, 10),
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        created: Number(result.created ?? 0),
        updated: Number(result.updated ?? 0),
        reactivated: Number(result.reactivated ?? 0),
        scanned: result.scanned ?? null,
        // syncFromJosh does not count rows it left alone.
        skipped: null,
        data_as_of: result.data_as_of ?? null,
      },
    );
    return this.view(row);
  }

  async listSyncRuns(limit: number) {
    const rows = await this.records.find({ where: { kind: Kind.SYNC_RUN }, order: { create_date: 'DESC' }, take: limit });
    return rows.map((r) => this.view(r));
  }
}
