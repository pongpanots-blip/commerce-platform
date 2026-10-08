import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WinbackAppRecord } from './entities/winback-app-record.entity';
import { LeadService } from './lead.service';
import { WinbackActor } from './app-records.service';
import { OpportunityMetaRow, OpportunityService, raiseRule } from './opportunity.service';
import {
  CollabLogPageDto,
  CollabLogQueryDto,
  CollabMessageDto,
  CreateCollabRequestDto,
  ResolveCollabRequestDto,
  UpdateOpportunityMetaDto,
} from './dto/app-gaps.dto';
import {
  CollabLogChanges,
  collabLogEntry,
  CollabLogPayload,
  collabLogRange,
  CollabPayload,
  collabPayload,
  CollabRequest,
  collabRequestError,
  collabResolveError,
  metaChanges,
  metaEditError,
  recipientError,
  requestView,
  staleHandoffError,
  supersededNote,
  versionError,
} from './opportunity-meta.helpers';
import {
  WinbackAppRecordKind as Kind,
  WinbackCollabLogEvent as LogEvent,
  WinbackCollabRequestKind,
  WinbackCollabRequestStatus,
} from './winback.enums';
import { WINBACK_ASSIGNABLE_ROLES, WINBACK_NAMED_ROLES } from './winback-roles';

const PG_UNIQUE_VIOLATION = '23505';

/** Ties inside one write share `create_date` (Postgres `now()` is per transaction): `seq` keeps their order. */
const LOG_SEQ_SQL = "CAST(l.payload->>'seq' AS integer)";

const RESOLVED_EVENT: Record<string, LogEvent> = {
  [WinbackCollabRequestStatus.APPROVED]: LogEvent.REQUEST_APPROVED,
  [WinbackCollabRequestStatus.REJECTED]: LogEvent.REQUEST_REJECTED,
  [WinbackCollabRequestStatus.CANCELLED]: LogEvent.REQUEST_CANCELLED,
};

/** One audit-log event of a write (who did it and which opportunity come from the write itself). */
interface CollabLogEvent {
  event: LogEvent;
  target_user_id?: string | null;
  request?: CollabRequest | null;
  note?: string | null;
  changes?: CollabLogChanges | null;
}

/**
 * §4.11.8 writes: an opportunity's stage / purpose, and the team's collaboration on it (handoff / coordinate
 * requests + internal messages and call notes). Record-only coordination facts in `winback_app_record`
 * (`opportunity_meta`, `opportunity_collab`; key = restaurant place id): nothing reassigns a winback account,
 * changes its stage, or sends a push / LINE / email. Writes take a row lock per opportunity, so concurrent
 * requests never lose an update. Every change also appends `opp_collab_log` rows (one per event) in the same
 * transaction — a rolled-back change leaves no log row.
 */
@Injectable()
export class OpportunityCollabService {
  constructor(
    @InjectRepository(WinbackAppRecord) private readonly records: Repository<WinbackAppRecord>,
    private readonly opportunities: OpportunityService,
    private readonly leads: LeadService,
  ) {}

  /**
   * Unbounded (not the 100-row `/sales-users` picker): recipients = active sale / sales / manager;
   * names = those plus admin / platform_admin (they resolve requests as managers).
   */
  private async roster() {
    const staff = await this.leads.listStaffNames(WINBACK_NAMED_ROLES);
    const assignable = new Set<string>(WINBACK_ASSIGNABLE_ROLES);
    const recipients = staff.filter((u) => assignable.has(u.role));
    return {
      recipients,
      names: new Map(staff.map((u) => [u.id, u.name])),
      ids: new Set(recipients.map((u) => u.id)),
    };
  }

  /** Requests and messages need a caller id (the JWT `sub`). */
  private staff(actor: WinbackActor): string {
    if (!actor.id) throw new ForbiddenException('ต้องเข้าสู่ระบบด้วยบัญชีพนักงาน (ไม่มี sales user id)');
    return actor.id;
  }

  private static trimmed(value: string, field: string): string {
    const v = value.trim();
    if (!v) throw new BadRequestException(`${field} ต้องไม่ว่าง`);
    return v;
  }

  /**
   * One transaction per write. The first write of an opportunity inserts its row; if two race, the loser hits
   * `uq_winback_app_record_key` and runs once more against the row the winner created (now locked).
   */
  private async inLock<T>(work: (repo: Repository<WinbackAppRecord>) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.records.manager.transaction((em) => work(em.getRepository(WinbackAppRecord)));
      } catch (error) {
        const e = error as { code?: string; driverError?: { code?: string } };
        if (attempt === 0 && (e?.code ?? e?.driverError?.code) === PG_UNIQUE_VIOLATION) continue;
        throw error;
      }
    }
  }

  private locked(repo: Repository<WinbackAppRecord>, kind: Kind, key: string) {
    return repo.findOne({ where: { kind, record_key: key }, lock: { mode: 'pessimistic_write' } });
  }

  private fresh(repo: Repository<WinbackAppRecord>, kind: Kind, key: string, actor: WinbackActor) {
    return repo.create({ kind, record_key: key, version: 0, sales_user_id: null, created_by: actor.id || null, payload: {} });
  }

  /**
   * Append one `opp_collab_log` row per event through the write's own transactional repository. `record_key`
   * stays NULL (never collides with the unique key index); actor → `sales_user_id` / `created_by`, event →
   * `status`, converted account → `account_id`; names are a snapshot taken now.
   */
  private async log(
    repo: Repository<WinbackAppRecord>,
    row: OpportunityMetaRow,
    actor: WinbackActor,
    names: ReadonlyMap<string, string>,
    events: CollabLogEvent[],
  ) {
    for (const [seq, e] of events.entries()) {
      const target = e.target_user_id ?? null;
      const payload: CollabLogPayload = {
        opportunity_id: row.id,
        opportunity_name: row.name_th || row.name_en || null,
        account_name: row.account_name ?? null,
        actor_name: (actor.id && names.get(actor.id)) || null,
        target_user_id: target,
        target_user_name: target ? names.get(target) ?? null : null,
        request_id: e.request?.id ?? null,
        request_kind: e.request?.kind ?? null,
        note: e.note ?? null,
        changes: e.changes ?? null,
        seq,
      };
      await repo.save(repo.create({
        kind: Kind.OPPORTUNITY_COLLAB_LOG,
        record_key: null,
        version: 1,
        sales_user_id: actor.id || null,
        created_by: actor.id || null,
        account_id: row.winback_account_id ?? null,
        status: e.event,
        payload: payload as unknown as Record<string, unknown>,
      }));
    }
  }

  // --- meta (stage / purpose) ---

  async updateMeta(actor: WinbackActor, id: string, dto: UpdateOpportunityMetaDto) {
    if (dto.stage === undefined && dto.purpose === undefined) throw new BadRequestException('ส่ง stage หรือ purpose อย่างน้อยหนึ่งค่า');
    const row = await this.opportunities.placeRow(id);
    const { names } = await this.roster();
    return this.inLock(async (repo) => {
      const record = await this.locked(repo, Kind.OPPORTUNITY_META, id);
      const current = this.opportunities.metaOf(row, record, names);
      raiseRule(metaEditError(actor, current.owner_sales_user_id));
      raiseRule(versionError(current.version, dto.expected_version));
      const next = record ?? this.fresh(repo, Kind.OPPORTUNITY_META, id, actor);
      // Only what was sent is stored; an unset stage keeps following the converted account.
      next.payload = {
        ...next.payload,
        ...(dto.stage !== undefined ? { stage: dto.stage } : {}),
        ...(dto.purpose !== undefined ? { purpose: dto.purpose } : {}),
      };
      next.account_id = row.winback_account_id ?? null;
      next.version = (next.version ?? 0) + 1;
      const updated = this.opportunities.metaOf(row, await repo.save(next), names);
      const changes = metaChanges(current, updated);
      if (changes) await this.log(repo, row, actor, names, [{ event: LogEvent.META_CHANGED, changes }]);
      return updated;
    });
  }

  // --- collaboration ---

  private view(row: OpportunityMetaRow, collab: WinbackAppRecord | null, state: CollabPayload, meta: WinbackAppRecord | null | undefined, names: ReadonlyMap<string, string>) {
    const owner = this.opportunities.metaOf(row, meta, names);
    return {
      opportunity_id: row.id,
      owner_sales_user_id: owner.owner_sales_user_id,
      owner_name: owner.owner_name,
      requests: state.requests.map(requestView),
      messages: state.messages,
      revision: collab?.version ?? 0,
    };
  }

  private saveCollab(repo: Repository<WinbackAppRecord>, record: WinbackAppRecord | null, row: OpportunityMetaRow, actor: WinbackActor, state: CollabPayload) {
    const next = record ?? this.fresh(repo, Kind.OPPORTUNITY_COLLAB, row.id, actor);
    next.payload = { requests: state.requests, messages: state.messages };
    next.account_id = row.winback_account_id ?? null;
    next.version = (next.version ?? 0) + 1;
    return repo.save(next);
  }

  async collaboration(id: string) {
    const row = await this.opportunities.placeRow(id);
    const [record, { names }] = await Promise.all([
      this.records.findOne({ where: { kind: Kind.OPPORTUNITY_COLLAB, record_key: id } }),
      this.roster(),
    ]);
    return this.view(row, record, collabPayload(record?.payload), undefined, names);
  }

  async createRequest(actor: WinbackActor, id: string, dto: CreateCollabRequestDto) {
    const actorId = this.staff(actor);
    const reason = OpportunityCollabService.trimmed(dto.reason, 'reason');
    const row = await this.opportunities.placeRow(id);
    const { names, ids } = await this.roster();
    return this.inLock(async (repo) => {
      const record = await this.locked(repo, Kind.OPPORTUNITY_COLLAB, id);
      const state = collabPayload(record?.payload);
      // The owner only changes under this collab lock (approving a handoff), so a plain read is current.
      const meta = await repo.findOne({ where: { kind: Kind.OPPORTUNITY_META, record_key: id } });
      const owner = this.opportunities.metaOf(row, meta, names);
      raiseRule(collabRequestError(actor, state, dto.kind, dto.recipient_id, owner.owner_sales_user_id, ids));
      const handoff = dto.kind === WinbackCollabRequestKind.HANDOFF;
      const request: CollabRequest = {
        id: randomUUID(),
        kind: dto.kind as WinbackCollabRequestKind,
        requester_id: actorId,
        requester_name: names.get(actorId) ?? null,
        recipient_id: dto.recipient_id,
        recipient_name: names.get(dto.recipient_id) ?? null,
        reason,
        created_at: new Date().toISOString(),
        status: WinbackCollabRequestStatus.PENDING,
        resolution_note: null,
        resolved_by_id: null,
        resolved_by_name: null,
        resolved_at: null,
        // The approval is checked against this baseline (a handoff whose owner moved on is stale → 409).
        from_owner_id: handoff ? owner.owner_sales_user_id : null,
        from_owner_name: handoff ? owner.owner_name : null,
      };
      state.requests.push(request);
      const saved = await this.saveCollab(repo, record, row, actor, state);
      await this.log(repo, row, actor, names, [
        { event: LogEvent.REQUEST_CREATED, target_user_id: request.recipient_id, request, note: reason },
      ]);
      return this.view(row, saved, state, meta, names);
    });
  }

  /**
   * Approving a handoff makes the recipient the coordination owner (opportunity_meta) — the account stays as
   * is — and closes every other pending handoff on the opportunity as `superseded`. 409 when the owner is no
   * longer the one the handoff was asked from (nothing changes then).
   */
  async resolveRequest(actor: WinbackActor, id: string, requestId: string, dto: ResolveCollabRequestDto) {
    const note = OpportunityCollabService.trimmed(dto.note, 'note');
    const row = await this.opportunities.placeRow(id);
    const { names } = await this.roster();
    return this.inLock(async (repo) => {
      const record = await this.locked(repo, Kind.OPPORTUNITY_COLLAB, id);
      const state = collabPayload(record?.payload);
      const request: CollabRequest | undefined = state.requests.find((r) => r.id === requestId);
      if (!request) throw new NotFoundException('request not found');
      raiseRule(collabResolveError(actor, request, dto.status));
      const handoff = dto.status === WinbackCollabRequestStatus.APPROVED && request.kind === WinbackCollabRequestKind.HANDOFF;
      // Lock order is always collab row → meta row.
      let meta = handoff
        ? await this.locked(repo, Kind.OPPORTUNITY_META, id)
        : await repo.findOne({ where: { kind: Kind.OPPORTUNITY_META, record_key: id } });
      const before = this.opportunities.metaOf(row, meta, names);
      if (handoff) raiseRule(staleHandoffError(request, before.owner_sales_user_id));
      const resolved = {
        resolved_by_id: actor.id || null,
        resolved_by_name: (actor.id && names.get(actor.id)) || null,
        resolved_at: new Date().toISOString(),
      };
      Object.assign(request, { status: dto.status, resolution_note: note, ...resolved });
      const events: CollabLogEvent[] = [{ event: RESOLVED_EVENT[dto.status], target_user_id: request.recipient_id, request, note }];
      if (handoff) {
        const next = meta ?? this.fresh(repo, Kind.OPPORTUNITY_META, id, actor);
        next.sales_user_id = request.recipient_id;
        next.account_id = row.winback_account_id ?? null;
        next.version = (next.version ?? 0) + 1;
        meta = await repo.save(next);
        const toName = names.get(request.recipient_id) ?? request.recipient_name ?? null;
        if (before.owner_sales_user_id !== request.recipient_id) {
          events.push({
            event: LogEvent.OWNER_CHANGED,
            target_user_id: request.recipient_id,
            request,
            changes: { owner: { from: before.owner_sales_user_id, to: request.recipient_id, from_name: before.owner_name, to_name: toName } },
          });
        }
        const closing = supersededNote(toName, request.recipient_id);
        for (const other of state.requests) {
          if (other === request || other.status !== WinbackCollabRequestStatus.PENDING || other.kind !== WinbackCollabRequestKind.HANDOFF) continue;
          Object.assign(other, { status: WinbackCollabRequestStatus.SUPERSEDED, resolution_note: closing, ...resolved });
          events.push({ event: LogEvent.REQUEST_SUPERSEDED, target_user_id: other.recipient_id, request: other, note: closing });
        }
      }
      const saved = await this.saveCollab(repo, record, row, actor, state);
      await this.log(repo, row, actor, names, events);
      return this.view(row, saved, state, meta, names);
    });
  }

  async postMessage(actor: WinbackActor, id: string, dto: CollabMessageDto) {
    const actorId = this.staff(actor);
    const body = OpportunityCollabService.trimmed(dto.text, 'text');
    const row = await this.opportunities.placeRow(id);
    const { names, ids } = await this.roster();
    raiseRule(recipientError(actor, dto.recipient_id, ids));
    return this.inLock(async (repo) => {
      const record = await this.locked(repo, Kind.OPPORTUNITY_COLLAB, id);
      const state = collabPayload(record?.payload);
      state.messages.push({
        id: randomUUID(),
        author_id: actorId,
        author_name: names.get(actorId) ?? null,
        recipient_id: dto.recipient_id,
        recipient_name: names.get(dto.recipient_id) ?? null,
        text: body,
        is_call_note: dto.is_call_note ?? false,
        created_at: new Date().toISOString(),
      });
      const saved = await this.saveCollab(repo, record, row, actor, state);
      await this.log(repo, row, actor, names, [{ event: LogEvent.MESSAGE_POSTED, target_user_id: dto.recipient_id, note: body }]);
      return this.view(row, saved, state, undefined, names);
    });
  }

  /** Active sales users, names only — sales get 403 on `/sales-users` but must pick a recipient. */
  async directory() {
    const { recipients } = await this.roster();
    return recipients.map((u) => ({ id: u.id, name: u.name }));
  }

  // --- audit log (manager only — the controller checks the role) ---

  /** `{ data, meta: { page, limit, total } }`, newest first (the interceptor passes the envelope through). */
  async logs(q: CollabLogQueryDto) {
    const range = collabLogRange(q.from, q.to);
    if ('status' in range) throw new BadRequestException(range.message);
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const qb = this.records.createQueryBuilder('l').where('l.kind = :logKind', { logKind: Kind.OPPORTUNITY_COLLAB_LOG });
    if (q.opportunity_id) qb.andWhere("l.payload->>'opportunity_id' = :logOpportunity", { logOpportunity: q.opportunity_id });
    if (q.actor_id) qb.andWhere('l.sales_user_id = :logActor', { logActor: q.actor_id });
    if (q.target_user_id) qb.andWhere("l.payload->>'target_user_id' = :logTarget", { logTarget: q.target_user_id });
    if (q.user_id) {
      // Two names: one parameter used as both uuid and text would not type-check in Postgres.
      qb.andWhere("(l.sales_user_id = :logUser OR l.payload->>'target_user_id' = :logUserText)", { logUser: q.user_id, logUserText: q.user_id });
    }
    if (q.event?.length) qb.andWhere('l.status IN (:...logEvents)', { logEvents: q.event });
    if (range.gte) qb.andWhere('l.create_date >= :logFrom', { logFrom: range.gte });
    if (range.lt) qb.andWhere('l.create_date < :logBefore', { logBefore: range.lt });
    if (range.lte) qb.andWhere('l.create_date <= :logUntil', { logUntil: range.lte });
    const [rows, total] = await qb
      .orderBy('l.create_date', 'DESC')
      .addOrderBy(LOG_SEQ_SQL, 'DESC')
      .addOrderBy('l.id', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();
    return { data: rows.map(collabLogEntry), meta: { page, limit, total } };
  }

  /** One opportunity's log; 404 when the place does not exist. */
  async opportunityLogs(id: string, q: CollabLogPageDto) {
    await this.opportunities.placeRow(id);
    return this.logs({ page: q.page, limit: q.limit, opportunity_id: id });
  }
}
