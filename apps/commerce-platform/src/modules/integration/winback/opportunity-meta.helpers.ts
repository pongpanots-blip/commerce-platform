// Pure rules behind §4.11.8 — opportunity filter metadata (stage / purpose / recommendation / owner) and
// collaboration (handoff / coordinate requests + internal messages). No Nest/TypeORM, so each is unit-testable.
// Everything here is a record-only coordination fact: nothing reassigns a winback account or sends anything.
import { needsEnrich, Opportunity, OpportunityPlaceRow } from './app-gaps.helpers';
import {
  WINBACK_OPPORTUNITY_PURPOSES,
  WINBACK_RECOMMENDATION_REASONS,
  WINBACK_STAGES,
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

// --- Opportunity meta ---

/** The place + converted-account columns the meta is derived from (OpportunityService selects them). */
export interface OpportunityMetaPlaceRow extends OpportunityPlaceRow {
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  /** `winback_account.stage` / `assigned_sales_user_id` / `cuisine_id` once the place was converted. */
  account_stage?: string | null;
  account_owner_id?: string | null;
  account_cuisine_id?: string | null;
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
  const owner = stored?.owner_sales_user_id ?? row.account_owner_id ?? null;
  return {
    opportunity_id: row.id,
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

/** Who may PATCH the meta: a manager, the owner, or anyone while the opportunity has no owner. */
export function metaEditError(actor: Actor, ownerId: string | null): RuleError | null {
  if (actor.isManager || !ownerId || ownerId === actor.id) return null;
  return { status: 403, message: 'เฉพาะผู้ดูแลโอกาสหรือ manager ที่แก้ได้' };
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
  if (q.owner_sales_user_id && !actor.isManager && q.owner_sales_user_id !== actor.id) {
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

/** Every enum value is listed (0 included); owners only when they own at least one, most first. */
export function summarizeOpportunityMeta(groups: OpportunityMetaGroup[], names: ReadonlyMap<string, string>): OpportunityFilterMeta {
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
  return {
    stages: list(stages),
    purposes: list(purposes),
    recommendation_reasons: list(reasons),
    owners: [...owners]
      .map(([id, count]) => ({ sales_user_id: id, name: names.get(id) ?? null, count }))
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
  if (recipientId === actor.id) return { status: 400, message: 'ผู้รับต้องไม่ใช่ตัวเอง' };
  if (!rosterIds.has(recipientId)) return { status: 400, message: 'ผู้รับไม่ใช่เซลล์ในระบบ' };
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
  if (kind === WinbackCollabRequestKind.HANDOFF && ownerId === recipientId) {
    return { status: 400, message: 'โอกาสนี้อยู่กับผู้รับอยู่แล้ว — ส่งต่อให้เจ้าของเดิมไม่ได้' };
  }
  const duplicate = state.requests.some(
    (r) => r.status === WinbackCollabRequestStatus.PENDING && r.kind === kind && r.requester_id === actor.id && r.recipient_id === recipientId,
  );
  if (duplicate) return { status: 409, message: 'มีคำขอแบบนี้รออยู่แล้ว' };
  return null;
}

/** approve / reject: the recipient or a manager · cancel: the requester or a manager · only while pending. */
export function collabResolveError(actor: Actor, request: CollabRequest, status: string): RuleError | null {
  if (status === WinbackCollabRequestStatus.CANCELLED) {
    if (!actor.isManager && request.requester_id !== actor.id) {
      return { status: 403, message: 'เฉพาะผู้ส่งคำขอหรือ manager ที่ยกเลิกได้' };
    }
  } else if (!actor.isManager && request.recipient_id !== actor.id) {
    return { status: 403, message: 'เฉพาะผู้รับคำขอหรือ manager ที่อนุมัติหรือปฏิเสธได้' };
  }
  if (request.status !== WinbackCollabRequestStatus.PENDING) return { status: 409, message: 'คำขอนี้ไม่ได้รออยู่แล้ว' };
  return null;
}
