import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WinbackAppRecord } from './entities/winback-app-record.entity';
import { LeadService } from './lead.service';
import { WinbackActor } from './app-records.service';
import { OpportunityMetaRow, OpportunityService, raiseRule } from './opportunity.service';
import { CollabMessageDto, CreateCollabRequestDto, ResolveCollabRequestDto, UpdateOpportunityMetaDto } from './dto/app-gaps.dto';
import {
  CollabPayload,
  collabPayload,
  CollabRequest,
  collabRequestError,
  collabResolveError,
  metaEditError,
  recipientError,
  versionError,
} from './opportunity-meta.helpers';
import {
  WinbackAppRecordKind as Kind,
  WinbackCollabRequestKind,
  WinbackCollabRequestStatus,
} from './winback.enums';

const PG_UNIQUE_VIOLATION = '23505';

/**
 * §4.11.8 writes: an opportunity's stage / purpose, and the team's collaboration on it (handoff / coordinate
 * requests + internal messages and call notes). Record-only coordination facts in `winback_app_record`
 * (`opportunity_meta`, `opportunity_collab`; key = restaurant place id): nothing reassigns a winback account,
 * changes its stage, or sends a push / LINE / email. Writes take a row lock per opportunity, so concurrent
 * requests never lose an update.
 */
@Injectable()
export class OpportunityCollabService {
  constructor(
    @InjectRepository(WinbackAppRecord) private readonly records: Repository<WinbackAppRecord>,
    private readonly opportunities: OpportunityService,
    private readonly leads: LeadService,
  ) {}

  private async roster() {
    const users = (await this.leads.listSalesUsers()) as Array<{ id: string; name: string }>;
    return { users, names: new Map(users.map((u) => [u.id, u.name])), ids: new Set(users.map((u) => u.id)) };
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
      return this.opportunities.metaOf(row, await repo.save(next), names);
    });
  }

  // --- collaboration ---

  private view(row: OpportunityMetaRow, collab: WinbackAppRecord | null, state: CollabPayload, meta: WinbackAppRecord | null | undefined, names: ReadonlyMap<string, string>) {
    const owner = this.opportunities.metaOf(row, meta, names);
    return {
      opportunity_id: row.id,
      owner_sales_user_id: owner.owner_sales_user_id,
      owner_name: owner.owner_name,
      requests: state.requests,
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
      const owner = this.opportunities.metaOf(row, meta, names).owner_sales_user_id;
      raiseRule(collabRequestError(actor, state, dto.kind, dto.recipient_id, owner, ids));
      state.requests.push({
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
      });
      const saved = await this.saveCollab(repo, record, row, actor, state);
      return this.view(row, saved, state, meta, names);
    });
  }

  /** Approving a handoff makes the recipient the coordination owner (opportunity_meta) — the account stays as is. */
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
      Object.assign(request, {
        status: dto.status,
        resolution_note: note,
        resolved_by_id: actor.id || null,
        resolved_by_name: names.get(actor.id) ?? null,
        resolved_at: new Date().toISOString(),
      });
      let meta: WinbackAppRecord | null;
      if (dto.status === WinbackCollabRequestStatus.APPROVED && request.kind === WinbackCollabRequestKind.HANDOFF) {
        const current = await this.locked(repo, Kind.OPPORTUNITY_META, id);
        const next = current ?? this.fresh(repo, Kind.OPPORTUNITY_META, id, actor);
        next.sales_user_id = request.recipient_id;
        next.account_id = row.winback_account_id ?? null;
        next.version = (next.version ?? 0) + 1;
        meta = await repo.save(next);
      } else {
        meta = await repo.findOne({ where: { kind: Kind.OPPORTUNITY_META, record_key: id } });
      }
      const saved = await this.saveCollab(repo, record, row, actor, state);
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
      return this.view(row, saved, state, undefined, names);
    });
  }

  /** Active sales users, names only — sales get 403 on `/sales-users` but must pick a recipient. */
  async directory() {
    const { users } = await this.roster();
    return users.map((u) => ({ id: u.id, name: u.name }));
  }
}
