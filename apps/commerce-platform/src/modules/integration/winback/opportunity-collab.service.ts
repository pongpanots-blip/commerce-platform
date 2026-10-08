import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { WinbackAccount } from './entities/winback-account.entity';
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
  normalizeActor,
  normalizeId,
  OpportunityAccess,
  opportunityAccessError,
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
import { isWinbackManager, WINBACK_ASSIGNABLE_ROLES, WINBACK_NAMED_ROLES } from './winback-roles';

/** What `/collaboration/directory` exposes per person — nothing else (no email / phone / role field). */
export interface CollabDirectoryEntry {
  id: string;
  /** Display name; an id-based staff placeholder when first / last name are missing. */
  name: string;
}

const PG_UNIQUE_VIOLATION = '23505';

/** Ties inside one write share `create_date` (Postgres `now()` is per transaction): `seq` keeps their order. */
const LOG_SEQ_SQL = "CAST(l.payload->>'seq' AS integer)";

const RESOLVED_EVENT: Record<string, LogEvent> = {
  [WinbackCollabRequestStatus.APPROVED]: LogEvent.REQUEST_APPROVED,
  [WinbackCollabRequestStatus.REJECTED]: LogEvent.REQUEST_REJECTED,
  [WinbackCollabRequestStatus.CANCELLED]: LogEvent.REQUEST_CANCELLED,
};

export const NO_STAFF_ID = 'ต้องเข้าสู่ระบบด้วยบัญชีพนักงาน (ไม่มี sales user id)';

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
 *
 * Every opportunity / user / request id is normalised (normalizeId) before it is written, looked up or
 * compared. Access per opportunity = opportunityAccessError: a manager anything; anyone else their own or
 * unassigned opportunities, plus — on that opportunity's thread — what a request addressed to them allows.
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
    const staff = (await this.leads.listStaffNames(WINBACK_NAMED_ROLES)).map((u) => ({ id: normalizeId(u.id), name: u.name, role: u.role }));
    const assignable = new Set<string>(WINBACK_ASSIGNABLE_ROLES);
    const recipients = staff.filter((u) => assignable.has(u.role));
    return {
      recipients,
      names: new Map(staff.map((u) => [u.id, u.name])),
      ids: new Set(recipients.map((u) => u.id)),
    };
  }

  /** Every collaboration write needs a caller id (the JWT `sub`): it is the requester / author / actor. */
  private staff(actor: WinbackActor): string {
    if (!actor.id) throw new ForbiddenException(NO_STAFF_ID);
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
  private async inLock<T>(work: (repo: Repository<WinbackAppRecord>, em: EntityManager) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.records.manager.transaction((em) => work(em.getRepository(WinbackAppRecord), em));
      } catch (error) {
        const e = error as { code?: string; driverError?: { code?: string } };
        if (attempt === 0 && (e?.code ?? e?.driverError?.code) === PG_UNIQUE_VIOLATION) continue;
        throw error;
      }
    }
  }

  private locked(repo: Repository<WinbackAppRecord>, kind: Kind, key: string) {
    return repo.findOne({ where: { kind, record_key: normalizeId(key) }, lock: { mode: 'pessimistic_write' } });
  }

  private plain(repo: Repository<WinbackAppRecord>, kind: Kind, key: string) {
    return repo.findOne({ where: { kind, record_key: normalizeId(key) } });
  }

  private fresh(repo: Repository<WinbackAppRecord>, kind: Kind, key: string, actor: WinbackActor) {
    return repo.create({ kind, record_key: normalizeId(key), version: 0, sales_user_id: null, created_by: actor.id || null, payload: {} });
  }

  /** 403 OPPORTUNITY_NOT_YOURS unless the caller may do `access` on this opportunity (see the helper). */
  private allow(actor: WinbackActor, ownerId: string | null, state: CollabPayload | null, access: OpportunityAccess) {
    raiseRule(opportunityAccessError(actor, ownerId, state, access));
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
      const target = normalizeId(e.target_user_id ?? null);
      const payload: CollabLogPayload = {
        opportunity_id: normalizeId(row.id),
        opportunity_name: row.name_th || row.name_en || null,
        account_name: row.account_name ?? null,
        actor_name: (actor.id && names.get(actor.id)) || null,
        target_user_id: target,
        target_user_name: target ? names.get(target) ?? null : null,
        request_id: normalizeId(e.request?.id ?? null),
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
        account_id: normalizeId(row.winback_account_id ?? null),
        status: e.event,
        payload: payload as unknown as Record<string, unknown>,
      }));
    }
  }

  // --- reads (thread access: visibility, or a recipient of a request on the opportunity) ---

  /** The place row + its thread, after the `thread` access check (404 unknown place first). */
  private async readable(caller: WinbackActor, rawId: string) {
    const actor = normalizeActor(caller);
    const row = await this.opportunities.placeRow(rawId);
    const record = await this.plain(this.records, Kind.OPPORTUNITY_COLLAB, row.id);
    const state = collabPayload(record?.payload);
    const owner = this.opportunities.metaOf(row, undefined, new Map()).owner_sales_user_id;
    this.allow(actor, owner, state, 'thread');
    return { row, record, state };
  }

  /** GET /opportunities/:id — same access as the thread (its owner's data is not for other reps). */
  async detail(actor: WinbackActor, id: string) {
    const { row } = await this.readable(actor, id);
    return this.opportunities.detailOf(row);
  }

  async meta(actor: WinbackActor, id: string) {
    const { row } = await this.readable(actor, id);
    return this.opportunities.metaView(row);
  }

  async collaboration(actor: WinbackActor, id: string) {
    const { row, record, state } = await this.readable(actor, id);
    const { names } = await this.roster();
    return this.view(row, record, state, undefined, names);
  }

  // --- meta (stage / purpose) ---

  async updateMeta(caller: WinbackActor, rawId: string, dto: UpdateOpportunityMetaDto) {
    const actor = normalizeActor(caller);
    this.staff(actor);
    if (dto.stage === undefined && dto.purpose === undefined) throw new BadRequestException('ส่ง stage หรือ purpose อย่างน้อยหนึ่งค่า');
    const row = await this.opportunities.placeRow(rawId);
    const id = row.id;
    const { names } = await this.roster();
    return this.inLock(async (repo) => {
      const record = await this.locked(repo, Kind.OPPORTUNITY_META, id);
      const current = this.opportunities.metaOf(row, record, names);
      // The owner only: a request's recipient may read the meta but not edit it.
      this.allow(actor, current.owner_sales_user_id, null, 'owner');
      raiseRule(versionError(current.version, dto.expected_version));
      const next = record ?? this.fresh(repo, Kind.OPPORTUNITY_META, id, actor);
      // Only what was sent is stored; an unset stage keeps following the converted account.
      next.payload = {
        ...next.payload,
        ...(dto.stage !== undefined ? { stage: dto.stage } : {}),
        ...(dto.purpose !== undefined ? { purpose: dto.purpose } : {}),
      };
      next.account_id = normalizeId(row.winback_account_id ?? null);
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
      opportunity_id: normalizeId(row.id),
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
    next.account_id = normalizeId(row.winback_account_id ?? null);
    next.version = (next.version ?? 0) + 1;
    return repo.save(next);
  }

  /** A sale starts a request only on an opportunity they own or that is unassigned; a manager anywhere. */
  async createRequest(caller: WinbackActor, rawId: string, dto: CreateCollabRequestDto) {
    const actor = normalizeActor(caller);
    const actorId = this.staff(actor);
    const reason = OpportunityCollabService.trimmed(dto.reason, 'reason');
    const recipientId = normalizeId(dto.recipient_id);
    const row = await this.opportunities.placeRow(rawId);
    const id = row.id;
    const { names, ids } = await this.roster();
    return this.inLock(async (repo) => {
      const record = await this.locked(repo, Kind.OPPORTUNITY_COLLAB, id);
      const state = collabPayload(record?.payload);
      // The coordination owner (meta) only changes under this collab lock (approving a handoff).
      // An account rep read before the transaction may be slightly stale.
      const meta = await this.plain(repo, Kind.OPPORTUNITY_META, id);
      const owner = this.opportunities.metaOf(row, meta, names);
      this.allow(actor, owner.owner_sales_user_id, null, 'owner');
      raiseRule(collabRequestError(actor, state, dto.kind, recipientId, owner.owner_sales_user_id, ids));
      const handoff = dto.kind === WinbackCollabRequestKind.HANDOFF;
      const request: CollabRequest = {
        id: randomUUID(),
        kind: dto.kind as WinbackCollabRequestKind,
        requester_id: actorId,
        requester_name: names.get(actorId) ?? null,
        recipient_id: recipientId,
        recipient_name: names.get(recipientId) ?? null,
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
   * longer the one the handoff was asked from (nothing changes then). A rep who cannot see the opportunity
   * still resolves what is theirs: approve / reject a request addressed to them, cancel one they sent.
   */
  async resolveRequest(caller: WinbackActor, rawId: string, rawRequestId: string, dto: ResolveCollabRequestDto) {
    const actor = normalizeActor(caller);
    this.staff(actor);
    const note = OpportunityCollabService.trimmed(dto.note, 'note');
    const requestId = normalizeId(rawRequestId);
    const place = await this.opportunities.placeRow(rawId);
    const id = place.id;
    const { names } = await this.roster();
    const result = await this.inLock(async (repo, em) => {
      const record = await this.locked(repo, Kind.OPPORTUNITY_COLLAB, id);
      const state = collabPayload(record?.payload);
      // Lock order is always collab row → meta row → converted account row.
      let meta = await this.locked(repo, Kind.OPPORTUNITY_META, id);
      // Re-read the account rep under the lock, including an account converted since the place join.
      const account = await em.getRepository(WinbackAccount).findOne({
        where: { restaurant_place_id: id }, lock: { mode: 'pessimistic_write' },
      });
      const row: OpportunityMetaRow = {
        ...place,
        winback_account_id: account?.id ?? null,
        account_owner_id: account?.assigned_sales_user_id ?? null,
        account_stage: account?.stage ?? null,
        account_cuisine_id: account?.cuisine_id ?? null,
        account_name: account?.display_name ?? null,
      };
      const before = this.opportunities.metaOf(row, meta, names);
      this.allow(actor, before.owner_sales_user_id, state, 'resolve');
      const request: CollabRequest | undefined = state.requests.find((r) => normalizeId(r.id) === requestId);
      if (!request) throw new NotFoundException('request not found');
      raiseRule(collabResolveError(actor, request, dto.status));
      const handoff = dto.status === WinbackCollabRequestStatus.APPROVED && request.kind === WinbackCollabRequestKind.HANDOFF;
      if (handoff) raiseRule(staleHandoffError(request, before.owner_sales_user_id));
      const resolved = {
        resolved_by_id: actor.id,
        resolved_by_name: names.get(actor.id) ?? null,
        resolved_at: new Date().toISOString(),
      };
      Object.assign(request, { status: dto.status, resolution_note: note, ...resolved });
      const events: CollabLogEvent[] = [{ event: RESOLVED_EVENT[dto.status], target_user_id: request.recipient_id, request, note }];
      if (handoff) {
        const toId = normalizeId(request.recipient_id);
        const next = meta ?? this.fresh(repo, Kind.OPPORTUNITY_META, id, actor);
        next.sales_user_id = toId;
        next.account_id = normalizeId(row.winback_account_id ?? null);
        next.version = (next.version ?? 0) + 1;
        meta = await repo.save(next);
        const toName = names.get(toId) ?? request.recipient_name ?? null;
        if (before.owner_sales_user_id !== toId) {
          events.push({
            event: LogEvent.OWNER_CHANGED,
            target_user_id: toId,
            request,
            changes: { owner: { from: before.owner_sales_user_id, to: toId, from_name: before.owner_name, to_name: toName } },
          });
        }
        const closing = supersededNote(toName, toId);
        for (const other of state.requests) {
          if (other === request || other.status !== WinbackCollabRequestStatus.PENDING || other.kind !== WinbackCollabRequestKind.HANDOFF) continue;
          Object.assign(other, { status: WinbackCollabRequestStatus.SUPERSEDED, resolution_note: closing, ...resolved });
          events.push({ event: LogEvent.REQUEST_SUPERSEDED, target_user_id: other.recipient_id, request: other, note: closing });
        }
      }
      const saved = await this.saveCollab(repo, record, row, actor, state);
      await this.log(repo, row, actor, names, events);
      return { row, saved, state, meta, request };
    });
    const { row, saved, state, meta, request } = result;
    const owner = this.opportunities.metaOf(row, meta, names).owner_sales_user_id;
    // After commit, a requester who lost thread access receives only their request and redacted owners.
    if (opportunityAccessError(actor, owner, state, 'thread')) {
      return {
        opportunity_id: id, owner_sales_user_id: null, owner_name: null,
        requests: [requestView(request)], messages: [], revision: saved.version,
      };
    }
    return this.view(row, saved, state, meta, names);
  }

  /** The owner / unassigned / a manager — or the recipient of a request on this opportunity (its thread). */
  async postMessage(caller: WinbackActor, rawId: string, dto: CollabMessageDto) {
    const actor = normalizeActor(caller);
    const actorId = this.staff(actor);
    const body = OpportunityCollabService.trimmed(dto.text, 'text');
    const recipientId = normalizeId(dto.recipient_id);
    const row = await this.opportunities.placeRow(rawId);
    const id = row.id;
    const { names, ids, recipients } = await this.roster();
    return this.inLock(async (repo) => {
      const record = await this.locked(repo, Kind.OPPORTUNITY_COLLAB, id);
      const state = collabPayload(record?.payload);
      const meta = await this.plain(repo, Kind.OPPORTUNITY_META, id);
      const owner = this.opportunities.metaOf(row, meta, names).owner_sales_user_id;
      this.allow(actor, owner, state, 'thread');
      raiseRule(recipientError(actor, recipientId, ids));
      const recipient = recipients.find((u) => u.id === recipientId)!;
      // Reject rather than silently drop the addressee: otherwise a successful message would be
      // invisible to its intended recipient. Requests themselves grant thread access when created.
      if (opportunityAccessError({ id: recipient.id, isManager: isWinbackManager(recipient.role) }, owner, state, 'thread')) {
        throw new ForbiddenException('ผู้รับต้องเป็นผู้ที่เห็นโอกาสนี้ได้');
      }
      state.messages.push({
        id: randomUUID(),
        author_id: actorId,
        author_name: names.get(actorId) ?? null,
        recipient_id: recipientId,
        recipient_name: names.get(recipientId) ?? null,
        text: body,
        is_call_note: dto.is_call_note ?? false,
        created_at: new Date().toISOString(),
      });
      const saved = await this.saveCollab(repo, record, row, actor, state);
      await this.log(repo, row, actor, names, [{ event: LogEvent.MESSAGE_POSTED, target_user_id: recipientId, note: body }]);
      return this.view(row, saved, state, meta, names);
    });
  }

  /**
   * Active sales users for the recipient picker — sales get 403 on `/sales-users`. Exactly `{ id, name }`
   * per person, mapped field by field (never the row): no email / phone / role field.
   */
  async directory(): Promise<CollabDirectoryEntry[]> {
    const { recipients } = await this.roster();
    return recipients.map((u): CollabDirectoryEntry => ({ id: u.id, name: u.name }));
  }

  // --- audit log (manager only — the controller checks the role) ---

  /** `{ data, meta: { page, limit, total } }`, newest first (the interceptor passes the envelope through). */
  async logs(q: CollabLogQueryDto) {
    const range = collabLogRange(q.from, q.to);
    if ('status' in range) throw new BadRequestException(range.message);
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const opportunityId = normalizeId(q.opportunity_id ?? null);
    const actorId = normalizeId(q.actor_id ?? null);
    const targetId = normalizeId(q.target_user_id ?? null);
    const userId = normalizeId(q.user_id ?? null);
    const qb = this.records.createQueryBuilder('l').where('l.kind = :logKind', { logKind: Kind.OPPORTUNITY_COLLAB_LOG });
    if (opportunityId) qb.andWhere("l.payload->>'opportunity_id' = :logOpportunity", { logOpportunity: opportunityId });
    if (actorId) qb.andWhere('l.sales_user_id = :logActor', { logActor: actorId });
    if (targetId) qb.andWhere("l.payload->>'target_user_id' = :logTarget", { logTarget: targetId });
    if (userId) {
      // Two names: one parameter used as both uuid and text would not type-check in Postgres.
      qb.andWhere("(l.sales_user_id = :logUser OR l.payload->>'target_user_id' = :logUserText)", { logUser: userId, logUserText: userId });
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
    const row = await this.opportunities.placeRow(id);
    return this.logs({ page: q.page, limit: q.limit, opportunity_id: row.id });
  }
}
