import { placeToOpportunity } from './app-gaps.helpers';
import {
  buildOpportunityMeta,
  collabPayload,
  CollabRequest,
  collabRequestError,
  collabResolveError,
  deriveRecommendation,
  metaEditError,
  NEEDS_RESEARCH_TEXT,
  OpportunityMetaPlaceRow,
  ownerFilterError,
  recipientError,
  storedMeta,
  summarizeOpportunityMeta,
  versionError,
} from './opportunity-meta.helpers';
import { WINBACK_STAGES } from './winback.enums';

const MGR = { id: 'mgr-1', isManager: true };
const REP = { id: 'rep-1', isManager: false };
const OTHER = { id: 'rep-2', isManager: false };
const NAMES = new Map([['rep-1', 'Rep One'], ['rep-2', 'Rep Two']]);
const ROSTER = new Set(['rep-1', 'rep-2', 'rep-3']);

function place(over: Partial<OpportunityMetaPlaceRow> = {}): OpportunityMetaPlaceRow {
  return {
    id: 'p1', name_th: 'ร้าน', name_en: null, district: 'วัฒนา', raw_category: 'Japanese', rating: 4.5, review_count: 200,
    price_range: '฿400–800', enriched_at: '2026-09-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z',
    winback_account_id: null, account_stage: null, account_owner_id: null, account_cuisine_id: null,
    ...over,
  };
}

function meta(row: OpportunityMetaPlaceRow, stored: ReturnType<typeof storedMeta> | null = null) {
  return buildOpportunityMeta(row, placeToOpportunity(row), stored, NAMES);
}

describe('opportunity meta', () => {
  it('defaults when nothing is stored: prospect / new_product / unassigned / derived v0, no district code', () => {
    expect(meta(place())).toEqual({
      opportunity_id: 'p1', stage: 'prospect', purpose: 'new_product', recommendation: null,
      owner_sales_user_id: null, owner_name: null, cuisine_id: null, district_code: null,
      source: 'derived', version: 0, updated_at: null,
    });
  });

  it('a converted place follows its account: stage, rep (owner + name) and cuisine', () => {
    const row = place({ winback_account_id: 'acc-1', account_stage: 'contacted', account_owner_id: 'rep-2', account_cuisine_id: 'cui-1' });
    expect(meta(row)).toMatchObject({ stage: 'contacted', owner_sales_user_id: 'rep-2', owner_name: 'Rep Two', cuisine_id: 'cui-1', source: 'derived' });
  });

  it('stored fields win; unset stored fields keep deriving; stored owner beats the account rep', () => {
    const row = place({ winback_account_id: 'acc-1', account_stage: 'contacted', account_owner_id: 'rep-2' });
    const at = new Date('2026-10-08T01:00:00Z');
    expect(meta(row, storedMeta({ purpose: 'winback' }, null, 3, at))).toMatchObject({
      stage: 'contacted', purpose: 'winback', owner_sales_user_id: 'rep-2', source: 'stored', version: 3, updated_at: at,
    });
    expect(meta(row, storedMeta({ stage: 'negotiate' }, 'rep-1', '2', at))).toMatchObject({
      stage: 'negotiate', purpose: 'new_product', owner_sales_user_id: 'rep-1', owner_name: 'Rep One', version: 2,
    });
    // an owner who left the roster keeps the id, name unknown
    expect(meta(row, storedMeta({}, 'gone', 1, at))).toMatchObject({ owner_sales_user_id: 'gone', owner_name: null });
  });

  it('recommendation: needs_research only when the place needs enrichment, dated from the place', () => {
    const notEnriched = place({ enriched_at: null });
    expect(deriveRecommendation(notEnriched, placeToOpportunity(notEnriched))).toEqual({
      reason: 'needs_research', reason_detail: NEEDS_RESEARCH_TEXT.notEnriched, suggestion: NEEDS_RESEARCH_TEXT.suggestion,
      urgency: 'research', source: 'restaurant_place', source_date: '2026-09-02T00:00:00.000Z',
      historical_monthly_purchase_baht: null, purchase_evidence: null, proposal_monthly_estimate_baht: null, product_summary: null,
    });
    const tierOnly = place({ price_range: '฿฿', updated_at: null });
    expect(meta(tierOnly).recommendation).toMatchObject({ reason_detail: NEEDS_RESEARCH_TEXT.noSpend, source_date: '2026-08-01T00:00:00.000Z' });
    expect(meta(place()).recommendation).toBeNull();
  });
});

describe('opportunity meta rules', () => {
  it('edit: manager, the owner, or anyone while unowned', () => {
    expect(metaEditError(MGR, 'rep-2')).toBeNull();
    expect(metaEditError(REP, 'rep-1')).toBeNull();
    expect(metaEditError(REP, null)).toBeNull();
    expect(metaEditError(REP, 'rep-2')).toEqual({ status: 403, message: 'เฉพาะผู้ดูแลโอกาสหรือ manager ที่แก้ได้' });
  });

  it('version: skipped when not sent, 409 with the current version when stale', () => {
    expect(versionError(2, undefined)).toBeNull();
    expect(versionError(2, 2)).toBeNull();
    expect(versionError(0, 0)).toBeNull();
    expect(versionError(3, 2)).toMatchObject({ status: 409, message: expect.stringContaining('ข้อมูลเปลี่ยนไปแล้ว (version 3)') });
  });

  it('list owner filter: a sale only for self (403), owner + unassigned_only is 400', () => {
    expect(ownerFilterError(REP, { owner_sales_user_id: 'rep-1' })).toBeNull();
    expect(ownerFilterError(MGR, { owner_sales_user_id: 'rep-2' })).toBeNull();
    expect(ownerFilterError(REP, { unassigned_only: true })).toBeNull();
    expect(ownerFilterError(REP, { owner_sales_user_id: 'rep-2' })?.status).toBe(403);
    expect(ownerFilterError(MGR, { owner_sales_user_id: 'rep-2', unassigned_only: true })?.status).toBe(400);
  });

  it('filter-meta summary lists every enum value, owners most first, unassigned apart', () => {
    const out = summarizeOpportunityMeta([
      { stage: 'prospect', purpose: 'new_product', owner: null, research: true, count: '5' },
      { stage: 'prospect', purpose: 'new_product', owner: null, research: false, count: '2' },
      { stage: 'contacted', purpose: 'winback', owner: 'rep-1', research: 't', count: '1' },
      { stage: 'negotiate', purpose: 'expansion', owner: 'rep-2', research: false, count: 3 },
    ], NAMES);
    expect(out.stages).toHaveLength(WINBACK_STAGES.length);
    expect(out.stages.find((s) => s.value === 'prospect')).toEqual({ value: 'prospect', count: 7 });
    expect(out.stages.find((s) => s.value === 'lost')).toEqual({ value: 'lost', count: 0 });
    expect(out.purposes).toEqual([{ value: 'winback', count: 1 }, { value: 'new_product', count: 7 }, { value: 'expansion', count: 3 }]);
    expect(out.recommendation_reasons).toEqual([
      { value: 'late_order', count: 0 }, { value: 'price_review', count: 0 }, { value: 'branch_expansion', count: 0 },
      { value: 'product_fit', count: 0 }, { value: 'needs_research', count: 6 },
    ]);
    expect(out.owners).toEqual([{ sales_user_id: 'rep-2', name: 'Rep Two', count: 3 }, { sales_user_id: 'rep-1', name: 'Rep One', count: 1 }]);
    expect(out.unassigned_count).toBe(7);
    expect(summarizeOpportunityMeta([], NAMES)).toMatchObject({ owners: [], unassigned_count: 0 });
  });
});

describe('collaboration rules', () => {
  const pending = (over: Partial<CollabRequest> = {}): CollabRequest => ({
    id: 'r1', kind: 'handoff' as never, requester_id: 'rep-1', requester_name: 'Rep One', recipient_id: 'rep-2', recipient_name: 'Rep Two',
    reason: 'x', created_at: '2026-10-08T00:00:00Z', status: 'pending' as never, resolution_note: null, resolved_by_id: null,
    resolved_by_name: null, resolved_at: null, ...over,
  });

  it('payload: empty lists when nothing is stored', () => {
    expect(collabPayload(null)).toEqual({ requests: [], messages: [] });
    expect(collabPayload({ requests: 'bad' })).toEqual({ requests: [], messages: [] });
  });

  it('recipient: not self, must be in the roster', () => {
    expect(recipientError(REP, 'rep-1', ROSTER)?.status).toBe(400);
    expect(recipientError(REP, 'ghost', ROSTER)).toEqual({ status: 400, message: 'ผู้รับไม่ใช่เซลล์ในระบบ' });
    expect(recipientError(REP, 'rep-2', ROSTER)).toBeNull();
  });

  it('request: no handoff to the current owner, 409 on the same pending requester+recipient+kind', () => {
    const state = { requests: [pending()], messages: [] };
    expect(collabRequestError(REP, { requests: [], messages: [] }, 'handoff', 'rep-2', 'rep-2', ROSTER)?.status).toBe(400);
    expect(collabRequestError(REP, { requests: [], messages: [] }, 'coordinate', 'rep-2', 'rep-2', ROSTER)).toBeNull();
    expect(collabRequestError(REP, state, 'handoff', 'rep-2', null, ROSTER)).toEqual({ status: 409, message: 'มีคำขอแบบนี้รออยู่แล้ว' });
    expect(collabRequestError(REP, state, 'coordinate', 'rep-2', null, ROSTER)).toBeNull();
    expect(collabRequestError(REP, state, 'handoff', 'rep-3', null, ROSTER)).toBeNull();
    expect(collabRequestError(OTHER, state, 'handoff', 'rep-3', null, ROSTER)).toBeNull();
    const resolved = { requests: [pending({ status: 'rejected' as never })], messages: [] };
    expect(collabRequestError(REP, resolved, 'handoff', 'rep-2', null, ROSTER)).toBeNull();
  });

  it('resolve: recipient/manager approve or reject, requester/manager cancel, only while pending', () => {
    const r = pending();
    expect(collabResolveError(OTHER, r, 'approved')).toBeNull();
    expect(collabResolveError(MGR, r, 'rejected')).toBeNull();
    expect(collabResolveError(REP, r, 'approved')?.status).toBe(403);
    expect(collabResolveError(REP, r, 'cancelled')).toBeNull();
    expect(collabResolveError(OTHER, r, 'cancelled')?.status).toBe(403);
    expect(collabResolveError(MGR, r, 'cancelled')).toBeNull();
    expect(collabResolveError(OTHER, pending({ status: 'approved' as never }), 'rejected')).toEqual({ status: 409, message: 'คำขอนี้ไม่ได้รออยู่แล้ว' });
    // a stranger gets 403 even on a resolved request
    expect(collabResolveError({ id: 'rep-9', isManager: false }, pending({ status: 'approved' as never }), 'rejected')?.status).toBe(403);
  });
});
