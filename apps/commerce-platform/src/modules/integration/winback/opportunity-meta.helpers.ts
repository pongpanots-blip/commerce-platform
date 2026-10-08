// Pure rules behind §4.11.8 — opportunity filter metadata (stage / purpose / recommendation / owner) and
// collaboration (handoff / coordinate requests + internal messages). No Nest/TypeORM, so each is unit-testable.
// Everything here is a record-only coordination fact: nothing reassigns a winback account or sends anything.
import { needsEnrich, Opportunity, OpportunityPlaceRow } from './app-gaps.helpers';
import {
  WINBACK_OPPORTUNITY_PURPOSES,
  WINBACK_RECOMMENDATION_REASONS,
  WINBACK_STAGES,
  WinbackCollabLogEvent,
  WinbackCollabRequestKind,
  WinbackCollabRequestStatus,
  WinbackOpportunityPurpose,
  WinbackRecommendationReason,
  WinbackRecommendationUrgency,
  WinbackStage,
} from './winback.enums';

export const OPPORTUNITY_DEFAULT_STAGE = WinbackStage.PROSPECT;
export const OPPORTUNITY_DEFAULT_PURPOSE = WinbackOpportunityPurpose.NEW_PRODUCT;

/** A rule broken: the service turns it into the matching HTTP error. */
export interface RuleError {
  status: 400 | 403 | 409;
  message: string;
}

/** Who is calling (same shape as AppRecordsService's WinbackActor). */
interface Actor {
  id: string;
  isManager: boolean;
}

// --- Ids ---

/**
 * THE one id normaliser for §4.11.8 (opportunity / account / user / request UUIDs): trimmed + lowercase.
 * Postgres prints a uuid lowercase (`CAST(p.id AS text)`, uuid columns) but jsonb payload values,
 * `record_key` (varchar, case-sensitive unique index) and in-memory compares are plain text — so every id
 * is normalised before it is written, looked up or compared. `null` / non-strings → null.
 */
export function normalizeId(id: string): string;
export function normalizeId(id: string | null | undefined): string | null;
export function normalizeId(id: string | null | undefined): string | null {
  return typeof id === 'string' ? id.trim().toLowerCase() : null;
}

/** Two ids are the same once normalised (null never equals anything). */
export function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeId(a);
  return !!x && x === normalizeId(b);
}

/** The caller with a normalised id (`''` when the token has no `sub`). */
export function normalizeActor<T extends Actor>(actor: T): T {
  return { ...actor, id: normalizeId(actor.id) ?? '' };
}

// --- Opportunity meta ---

/** The place + converted-account columns the meta is derived from (OpportunityService selects them). */
export interface OpportunityMetaPlaceRow extends OpportunityPlaceRow {
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  /** `winback_account.stage` / `assigned_sales_user_id` / `cuisine_id` once the place was converted. */
  account_stage?: string | null;
  account_owner_id?: string | null;
  account_cuisine_id?: string | null;
  /** `winback_account.display_name` of the converted account (the audit log's `account_name`). */
  account_name?: string | null;
}

/** What is stored (kind `opportunity_meta`): only the fields someone set; the rest stay derived. */
export interface StoredOpportunityMeta {
  stage: string | null;
  purpose: string | null;
  /** The coordination owner, set by an approved handoff (`winback_app_record.sales_user_id`). */
  owner_sales_user_id: string | null;
  version: number;
  updated_at: Date | string | null;
}

export interface OpportunityRecommendation {
  reason: WinbackRecommendationReason;
  reason_detail: string;
  suggestion: string;
  urgency: WinbackRecommendationUrgency;
  source: string;
  source_date: string | null;
  historical_monthly_purchase_baht: number | null;
  purchase_evidence: string | null;
  proposal_monthly_estimate_baht: number | null;
  product_summary: string | null;
}

export interface OpportunityMeta {
  opportunity_id: string;
  stage: string;
  purpose: string;
  recommendation: OpportunityRecommendation | null;
  owner_sales_user_id: string | null;
  owner_name: string | null;
  cuisine_id: string | null;
  district_code: number | null;
  source: 'stored' | 'derived';
  version: number;
  updated_at: Date | string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function storedMeta(
  payload: Record<string, unknown> | null | undefined,
  ownerId: string | null | undefined,
  version: number | string | null | undefined,
  updatedAt: Date | string | null | undefined,
): StoredOpportunityMeta {
  return {
    stage: text(payload?.stage),
    purpose: text(payload?.purpose),
    owner_sales_user_id: ownerId ?? null,
    version: Number(version ?? 0),
    updated_at: updatedAt ?? null,
  };
}

/** The server-owned wording of the one recommendation derived today. */
export const NEEDS_RESEARCH_TEXT = {
  notEnriched: 'ข้อมูลร้านยังไม่ครบ (ยังไม่ได้ดึงรีวิว/ราคาจาก Google)',
  noSpend: 'ข้อมูลร้านยังไม่ครบ (ยังไม่มีช่วงราคาต่อหัว)',
  suggestion: 'เก็บข้อมูลร้านก่อนประเมินการเสนอขาย',
};

/**
 * Derived only, never invented. The one reason the data supports today is `needs_research`: the place is not
 * enriched or has no spend range (= the list's `needs_enrich` tab). Every other reason (late order, price
 * review, branch expansion, product fit) has no source for an open opportunity → null.
 */
export function deriveRecommendation(row: OpportunityMetaPlaceRow, opportunity: Opportunity): OpportunityRecommendation | null {
  if (!needsEnrich(opportunity)) return null;
  return {
    reason: WinbackRecommendationReason.NEEDS_RESEARCH,
    reason_detail: opportunity.enrichment_status === 'enriching' ? NEEDS_RESEARCH_TEXT.notEnriched : NEEDS_RESEARCH_TEXT.noSpend,
    suggestion: NEEDS_RESEARCH_TEXT.suggestion,
    urgency: WinbackRecommendationUrgency.RESEARCH,
    source: 'restaurant_place',
    source_date: iso(row.updated_at) ?? iso(row.created_at),
    historical_monthly_purchase_baht: null,
    purchase_evidence: null,
    proposal_monthly_estimate_baht: null,
    product_summary: null,
  };
}

/**
 * stage: stored → the converted account's stage → `prospect` · purpose: stored → `new_product` ·
 * owner: stored coordination owner → the converted account's rep → null · cuisine: the converted account's
 * (restaurant_place has no cuisine) · district code: always null (places carry free-text district only).
 */
export function buildOpportunityMeta(
  row: OpportunityMetaPlaceRow,
  opportunity: Opportunity,
  stored: StoredOpportunityMeta | null,
  names: ReadonlyMap<string, string>,
): OpportunityMeta {
  // In-memory twin of OPPORTUNITY_OWNER_SQL: stored coordination owner, else the converted account's rep.
  const owner = normalizeId(stored?.owner_sales_user_id ?? row.account_owner_id ?? null);
  return {
    opportunity_id: normalizeId(row.id),
    stage: stored?.stage ?? row.account_stage ?? OPPORTUNITY_DEFAULT_STAGE,
    purpose: stored?.purpose ?? OPPORTUNITY_DEFAULT_PURPOSE,
    recommendation: deriveRecommendation(row, opportunity),
    owner_sales_user_id: owner,
    owner_name: owner ? names.get(owner) ?? null : null,
    cuisine_id: row.account_cuisine_id ?? null,
    district_code: null,
    source: stored ? 'stored' : 'derived',
    version: stored?.version ?? 0,
    updated_at: stored?.updated_at ?? null,
  };
}

// --- Visibility (who may see / act on an opportunity) ---

/** The coordination owner as SQL over `m` (stored opportunity_meta) and `a` (converted account). */
export const OPPORTUNITY_OWNER_SQL = 'COALESCE(m.sales_user_id, a.assigned_sales_user_id)';

export const OPPORTUNITY_NOT_YOURS = 'โอกาสนี้มีผู้ดูแลคนอื่น — เฉพาะผู้ดูแลหรือ manager';

export interface OpportunityVisibility {
  /** AND clause over OPPORTUNITY_OWNER_SQL; null = no restriction (a manager). */
  sql: string | null;
  params: Record<string, string>;
  /** The same rule in memory, for one opportunity's owner id. */
  allows(ownerId: string | null | undefined): boolean;
}

/**
 * The one visibility rule: a manager sees every opportunity; anyone else only their own (coordination owner
 * = self) or unassigned ones (no owner). A caller without an id sees only unassigned ones. The list,
 * filter-meta, account opportunities and every per-opportunity route use this.
 */
export function opportunityVisibility(actor: Actor): OpportunityVisibility {
  if (actor.isManager) return { sql: null, params: {}, allows: () => true };
  const self = normalizeId(actor.id) || null;
  return {
    sql: self ? `(${OPPORTUNITY_OWNER_SQL} IS NULL OR ${OPPORTUNITY_OWNER_SQL} = :visibleOwner)` : `${OPPORTUNITY_OWNER_SQL} IS NULL`,
    params: self ? { visibleOwner: self } : {},
    allows: (ownerId) => {
      const owner = normalizeId(ownerId ?? null);
      return !owner || owner === self;
    },
  };
}

/**
 * What a route needs beyond visibility:
 * - `owner` — PATCH meta, starting a request: visibility only.
 * - `thread` — read the opportunity / meta / thread, post a message: visibility, or the recipient of any
 *   request (pending or past) on it.
 * - `resolve` — approve / reject / cancel: visibility, or the recipient or requester of a request on it
 *   (collabResolveError then decides which of them may do what).
 */
export type OpportunityAccess = 'owner' | 'thread' | 'resolve';

export function opportunityAccessError(
  actor: Actor,
  ownerId: string | null | undefined,
  state: CollabPayload | null,
  access: OpportunityAccess,
): RuleError | null {
  if (opportunityVisibility(actor).allows(ownerId)) return null;
  if (access !== 'owner' && state?.requests.some((r) => sameId(r.recipient_id, actor.id) || (access === 'resolve' && sameId(r.requester_id, actor.id)))) {
    return null;
  }
  return { status: 403, message: OPPORTUNITY_NOT_YOURS };
}

export function versionError(current: number, expected: number | undefined): RuleError | null {
  if (expected === undefined || expected === current) return null;
  return { status: 409, message: `ข้อมูลเปลี่ยนไปแล้ว (version ${current}) — โหลดใหม่แล้วลองอีกครั้ง` };
}

/** List filter rules: a sale may only filter by their own owner id; owner + unassigned_only contradict. */
export function ownerFilterError(actor: Actor, q: { owner_sales_user_id?: string; unassigned_only?: boolean }): RuleError | null {
  if (q.owner_sales_user_id && q.unassigned_only) {
    return { status: 400, message: 'ใช้ owner_sales_user_id กับ unassigned_only พร้อมกันไม่ได้' };
  }
  if (q.owner_sales_user_id && !actor.isManager && !sameId(q.owner_sales_user_id, actor.id)) {
    return { status: 403, message: 'เซลล์กรองได้เฉพาะโอกาสของตัวเอง' };
  }
  return null;
}

/** One `GROUP BY` row of the filter-meta query. */
export interface OpportunityMetaGroup {
  stage: string | null;
  purpose: string | null;
  owner: string | null;
  research: boolean | string | null;
  count: number | string;
}

export interface OpportunityFilterMeta {
  stages: Array<{ value: string; count: number }>;
  purposes: Array<{ value: string; count: number }>;
  recommendation_reasons: Array<{ value: string; count: number }>;
  owners: Array<{ sales_user_id: string; name: string | null; count: number }>;
  unassigned_count: number;
}

function truthy(v: boolean | string | null): boolean {
  return v === true || v === 't' || v === 'true';
}

/**
 * Every enum value is listed (0 included); owners only when they own at least one, most first.
 * `onlyOwner` (a sale's filter-meta): the owner chips are just that caller, with their count (0 included) —
 * the only owner value a sale may filter by; `null` = no chip at all (a sale without a caller id).
 */
export function summarizeOpportunityMeta(
  groups: OpportunityMetaGroup[],
  names: ReadonlyMap<string, string>,
  onlyOwner?: string | null,
): OpportunityFilterMeta {
  const stages = new Map<string, number>(WINBACK_STAGES.map((s) => [s, 0]));
  const purposes = new Map<string, number>(WINBACK_OPPORTUNITY_PURPOSES.map((p) => [p, 0]));
  const reasons = new Map<string, number>(WINBACK_RECOMMENDATION_REASONS.map((r) => [r, 0]));
  const owners = new Map<string, number>();
  let unassigned = 0;
  for (const g of groups) {
    const n = Number(g.count) || 0;
    if (g.stage && stages.has(g.stage)) stages.set(g.stage, stages.get(g.stage)! + n);
    if (g.purpose && purposes.has(g.purpose)) purposes.set(g.purpose, purposes.get(g.purpose)! + n);
    if (truthy(g.research)) reasons.set(WinbackRecommendationReason.NEEDS_RESEARCH, reasons.get(WinbackRecommendationReason.NEEDS_RESEARCH)! + n);
    if (g.owner) owners.set(g.owner, (owners.get(g.owner) ?? 0) + n);
    else unassigned += n;
  }
  const list = (m: Map<string, number>) => [...m].map(([value, count]) => ({ value, count }));
  const chip = (id: string, count: number) => ({ sales_user_id: id, name: names.get(id) ?? null, count });
  return {
    stages: list(stages),
    purposes: list(purposes),
    recommendation_reasons: list(reasons),
    owners: onlyOwner !== undefined
      ? (onlyOwner ? [chip(onlyOwner, owners.get(onlyOwner) ?? 0)] : [])
      : [...owners]
        .map(([id, count]) => chip(id, count))
        .sort((a, b) => b.count - a.count || String(a.name ?? a.sales_user_id).localeCompare(String(b.name ?? b.sales_user_id))),
    unassigned_count: unassigned,
  };
}

// --- Collaboration (kind `opportunity_collab`, one record per opportunity) ---

export interface CollabRequest {
  id: string;
  kind: WinbackCollabRequestKind;
  requester_id: string;
  requester_name: string | null;
  recipient_id: string;
  recipient_name: string | null;
  reason: string;
  created_at: string;
  status: WinbackCollabRequestStatus;
  resolution_note: string | null;
  resolved_by_id: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  /**
   * The coordination owner when the request was created (handoff only; null = unowned or a coordinate
   * request). Absent on requests stored before this field existed — those are never treated as stale.
   */
  from_owner_id?: string | null;
  from_owner_name?: string | null;
}

export interface CollabMessage {
  id: string;
  author_id: string;
  author_name: string | null;
  recipient_id: string;
  recipient_name: string | null;
  text: string;
  is_call_note: boolean;
  created_at: string;
}

export interface CollabPayload {
  requests: CollabRequest[];
  messages: CollabMessage[];
}

export function collabPayload(raw: Record<string, unknown> | null | undefined): CollabPayload {
  return {
    requests: Array.isArray(raw?.requests) ? (raw!.requests as CollabRequest[]) : [],
    messages: Array.isArray(raw?.messages) ? (raw!.messages as CollabMessage[]) : [],
  };
}

/** Recipient checks shared by requests and messages. */
export function recipientError(actor: Actor, recipientId: string, rosterIds: ReadonlySet<string>): RuleError | null {
  if (sameId(recipientId, actor.id)) return { status: 400, message: 'ผู้รับต้องไม่ใช่ตัวเอง' };
  if (!rosterIds.has(normalizeId(recipientId))) return { status: 400, message: 'ผู้รับไม่ใช่เซลล์ในระบบ' };
  return null;
}

export function collabRequestError(
  actor: Actor,
  state: CollabPayload,
  kind: string,
  recipientId: string,
  ownerId: string | null,
  rosterIds: ReadonlySet<string>,
): RuleError | null {
  const recipient = recipientError(actor, recipientId, rosterIds);
  if (recipient) return recipient;
  if (kind === WinbackCollabRequestKind.HANDOFF && sameId(ownerId, recipientId)) {
    return { status: 400, message: 'โอกาสนี้อยู่กับผู้รับอยู่แล้ว — ส่งต่อให้เจ้าของเดิมไม่ได้' };
  }
  const duplicate = state.requests.some(
    (r) => r.status === WinbackCollabRequestStatus.PENDING && r.kind === kind && sameId(r.requester_id, actor.id) && sameId(r.recipient_id, recipientId),
  );
  if (duplicate) return { status: 409, message: 'มีคำขอแบบนี้รออยู่แล้ว' };
  return null;
}

/** approve / reject: the recipient or a manager · cancel: the requester or a manager · only while pending. */
export function collabResolveError(actor: Actor, request: CollabRequest, status: string): RuleError | null {
  if (status === WinbackCollabRequestStatus.CANCELLED) {
    if (!actor.isManager && !sameId(request.requester_id, actor.id)) {
      return { status: 403, message: 'เฉพาะผู้ส่งคำขอหรือ manager ที่ยกเลิกได้' };
    }
  } else if (!actor.isManager && !sameId(request.recipient_id, actor.id)) {
    return { status: 403, message: 'เฉพาะผู้รับคำขอหรือ manager ที่อนุมัติหรือปฏิเสธได้' };
  }
  if (request.status !== WinbackCollabRequestStatus.PENDING) return { status: 409, message: 'คำขอนี้ไม่ได้รออยู่แล้ว' };
  return null;
}

export const STALE_HANDOFF_MESSAGE = 'คำขอนี้ล้าสมัยแล้ว ผู้ดูแลโอกาสเปลี่ยนไปแล้ว';

/**
 * Approving a handoff whose owner moved on since it was asked (e.g. a manager approved another handoff):
 * 409, nothing changes, the request stays pending (its requester or a manager can cancel it). A request
 * stored before `from_owner_id` existed has no baseline → valid.
 */
export function staleHandoffError(request: CollabRequest, currentOwnerId: string | null): RuleError | null {
  if (request.kind !== WinbackCollabRequestKind.HANDOFF || !('from_owner_id' in request)) return null;
  if (normalizeId(request.from_owner_id ?? null) === normalizeId(currentOwnerId ?? null)) return null;
  return { status: 409, message: STALE_HANDOFF_MESSAGE };
}

/** The resolution note the server writes on a handoff it auto-closes. */
export function supersededNote(recipientName: string | null, recipientId: string): string {
  return `ปิดอัตโนมัติ: อนุมัติส่งต่อให้ ${recipientName ?? recipientId} แล้ว`;
}

/** A request as the API shows it: `from_owner_*` always present (null on requests stored before them). */
export function requestView(request: CollabRequest): CollabRequest {
  return { ...request, from_owner_id: request.from_owner_id ?? null, from_owner_name: request.from_owner_name ?? null };
}

// --- Collaboration audit log (kind `opp_collab_log`, one append-only row per event) ---

export interface CollabLogChanges {
  stage?: { from: string | null; to: string | null };
  purpose?: { from: string | null; to: string | null };
  owner?: { from: string | null; to: string | null; from_name: string | null; to_name: string | null };
}

/** `winback_app_record.payload` of a log row (snake_case like every kind; the interceptor camelCases it). */
export interface CollabLogPayload {
  opportunity_id: string;
  opportunity_name: string | null;
  account_name: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  target_user_name: string | null;
  request_id: string | null;
  request_kind: WinbackCollabRequestKind | null;
  note: string | null;
  changes: CollabLogChanges | null;
  /** Order inside one write: rows of one transaction share `create_date` (Postgres `now()`). */
  seq: number;
}

/** The log row columns the entry is read from (WinbackAppRecord). */
export interface CollabLogRecord {
  id: string;
  status: string | null;
  sales_user_id: string | null;
  account_id: string | null;
  created_by: string | null;
  payload: Record<string, unknown> | null;
  create_date: Date | string | null;
}

export interface CollabLogEntry {
  id: string;
  event: WinbackCollabLogEvent;
  opportunity_id: string;
  opportunity_name: string | null;
  account_id: string | null;
  account_name: string | null;
  actor_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  target_user_name: string | null;
  request_id: string | null;
  request_kind: WinbackCollabRequestKind | null;
  note: string | null;
  changes: CollabLogChanges | null;
  created_at: string | null;
}

export function collabLogEntry(r: CollabLogRecord): CollabLogEntry {
  const p = (r.payload ?? {}) as Partial<CollabLogPayload>;
  return {
    id: r.id,
    event: r.status as WinbackCollabLogEvent,
    opportunity_id: normalizeId(String(p.opportunity_id ?? '')),
    opportunity_name: p.opportunity_name ?? null,
    account_id: normalizeId(r.account_id ?? null),
    account_name: p.account_name ?? null,
    actor_id: normalizeId(r.sales_user_id ?? r.created_by ?? null),
    actor_name: p.actor_name ?? null,
    target_user_id: normalizeId(p.target_user_id ?? null),
    target_user_name: p.target_user_name ?? null,
    request_id: p.request_id ?? null,
    request_kind: p.request_kind ?? null,
    note: p.note ?? null,
    changes: p.changes ?? null,
    created_at: iso(r.create_date),
  };
}

/** stage / purpose before → after; only what actually changed (null = nothing to log). */
export function metaChanges(
  before: { stage: string; purpose: string },
  after: { stage: string; purpose: string },
): CollabLogChanges | null {
  const changes: CollabLogChanges = {};
  if (before.stage !== after.stage) changes.stage = { from: before.stage, to: after.stage };
  if (before.purpose !== after.purpose) changes.purpose = { from: before.purpose, to: after.purpose };
  return Object.keys(changes).length ? changes : null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** `YYYY-MM-DD` (a Bangkok calendar day) or an ISO date-time with a zone → that instant; null when invalid. */
function instant(value: string, endOfDay: boolean): Date | null {
  if (DAY.test(value)) {
    const utc = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) return null; // 2026-02-30 rolls over
    const start = new Date(utc.getTime() - BANGKOK_OFFSET_MS);
    return endOfDay ? new Date(start.getTime() + MS_PER_DAY) : start;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The log's created-at window: `from` inclusive; `to` inclusive — a day means up to the end of that Bangkok
 * day (`< next day 00:00 +07:00`), an ISO instant means `<=` it. 400 on an invalid date or from > to.
 */
export function collabLogRange(from?: string, to?: string): { gte: Date | null; lt: Date | null; lte: Date | null } | RuleError {
  const gte = from ? instant(from, false) : null;
  if (from && !gte) return { status: 400, message: 'from ต้องเป็น YYYY-MM-DD หรือ ISO date-time' };
  const end = to ? instant(to, DAY.test(to)) : null;
  if (to && !end) return { status: 400, message: 'to ต้องเป็น YYYY-MM-DD หรือ ISO date-time' };
  const dayEnd = !!to && DAY.test(to);
  const lt = dayEnd ? end : null;
  const lte = dayEnd ? null : end;
  if (gte && ((lt && gte >= lt) || (lte && gte > lte))) return { status: 400, message: 'from ต้องไม่เกิน to' };
  return { gte, lt, lte };
}
