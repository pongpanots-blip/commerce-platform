import { placeToOpportunity } from './app-gaps.helpers';
import {
  buildOpportunityMeta,
  collabLogEntry,
  collabLogRange,
  collabPayload,
  CollabRequest,
  collabRequestError,
  collabResolveError,
  deriveRecommendation,
  metaChanges,
  NEEDS_RESEARCH_TEXT,
  normalizeActor,
  normalizeId,
  OPPORTUNITY_NOT_YOURS,
  OPPORTUNITY_OWNER_SQL,
  opportunityAccessError,
  opportunityVisibility,
  OpportunityMetaPlaceRow,
  ownerFilterError,
  recipientError,
  requestView,
  sameId,
  staleHandoffError,
  storedMeta,
  summarizeOpportunityMeta,
  supersededNote,
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

describe('ids (§4.11.8 UUID normalisation)', () => {
  const UP = 'ABCDEF00-0000-4000-8000-0000000000A1';
  it('one normaliser: trimmed lowercase, null for missing', () => {
    expect(normalizeId(` ${UP} `)).toBe(UP.toLowerCase());
    expect(normalizeId(null)).toBeNull();
    expect(normalizeId(undefined)).toBeNull();
    expect(sameId(UP, UP.toLowerCase())).toBe(true);
    expect(sameId(null, null)).toBe(false);
    expect(sameId('', '')).toBe(false);
    expect(normalizeActor({ id: UP, isManager: false })).toEqual({ id: UP.toLowerCase(), isManager: false });
    expect(normalizeActor({ id: '', isManager: true })).toEqual({ id: '', isManager: true });
  });

  it('meta ids are lowercase whatever the row carries; rule compares ignore case', () => {
    expect(meta(place({ id: UP, account_owner_id: 'REP-2' }))).toMatchObject({ opportunity_id: UP.toLowerCase(), owner_sales_user_id: 'rep-2', owner_name: 'Rep Two' });
    expect(ownerFilterError({ id: 'rep-1', isManager: false }, { owner_sales_user_id: 'REP-1' })).toBeNull();
    expect(recipientError({ id: 'rep-1', isManager: false }, 'REP-1', ROSTER)?.message).toBe('ผู้รับต้องไม่ใช่ตัวเอง');
    expect(recipientError(REP, 'REP-2', ROSTER)).toBeNull();
  });
});

describe('opportunity visibility (§4.11.8)', () => {
  it('manager: no clause, sees everything', () => {
    const v = opportunityVisibility(MGR);
    expect(v.sql).toBeNull();
    expect([v.allows('rep-2'), v.allows(null)]).toEqual([true, true]);
  });

  it('a sale: own + unassigned — SQL and in-memory from the same definition', () => {
    const v = opportunityVisibility({ id: 'REP-1', isManager: false });
    expect(v.sql).toBe(`(${OPPORTUNITY_OWNER_SQL} IS NULL OR ${OPPORTUNITY_OWNER_SQL} = :visibleOwner)`);
    expect(v.params).toEqual({ visibleOwner: 'rep-1' });
    expect([v.allows('rep-1'), v.allows('REP-1'), v.allows(null), v.allows(undefined), v.allows('rep-2')]).toEqual([true, true, true, true, false]);
    expect(OPPORTUNITY_OWNER_SQL).toBe('COALESCE(m.sales_user_id, a.assigned_sales_user_id)');
  });

  it('no caller id: unassigned only', () => {
    const v = opportunityVisibility({ id: '', isManager: false });
    expect(v.sql).toBe(`${OPPORTUNITY_OWNER_SQL} IS NULL`);
    expect(v.params).toEqual({});
    expect([v.allows(null), v.allows('rep-1')]).toEqual([true, false]);
  });

  it('access: owner-only routes ignore requests; the thread admits recipients; resolve admits recipients and requesters', () => {
    const forbidden = { status: 403, message: OPPORTUNITY_NOT_YOURS };
    const req = (requester: string, recipient: string, status = 'pending') => ({ id: 'r', requester_id: requester, recipient_id: recipient, status }) as unknown as CollabRequest;
    const state = { requests: [req('rep-2', 'rep-1', 'rejected')], messages: [] };
    expect(opportunityAccessError(MGR, 'rep-2', null, 'owner')).toBeNull();
    expect(opportunityAccessError(REP, 'rep-1', null, 'owner')).toBeNull();
    expect(opportunityAccessError(REP, null, null, 'owner')).toBeNull();
    expect(opportunityAccessError(REP, 'rep-2', state, 'owner')).toEqual(forbidden);
    // rep-1 was the recipient of a (past) request: may read / message / resolve, never edit
    expect(opportunityAccessError(REP, 'rep-2', state, 'thread')).toBeNull();
    expect(opportunityAccessError({ id: 'REP-1', isManager: false }, 'rep-2', state, 'resolve')).toBeNull();
    // rep-3 only sent a request: may resolve (cancel — collabResolveError decides) but not read the thread
    const sent = { requests: [req('rep-3', 'rep-2')], messages: [] };
    expect(opportunityAccessError({ id: 'rep-3', isManager: false }, 'rep-2', sent, 'thread')).toEqual(forbidden);
    expect(opportunityAccessError({ id: 'rep-3', isManager: false }, 'rep-2', sent, 'resolve')).toBeNull();
    // a stranger, and a caller without an id
    expect(opportunityAccessError({ id: 'rep-9', isManager: false }, 'rep-2', state, 'thread')).toEqual(forbidden);
    expect(opportunityAccessError({ id: '', isManager: false }, 'rep-2', { requests: [req('', '')], messages: [] }, 'thread')).toEqual(forbidden);
  });
});

describe('opportunity meta rules', () => {
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

  it('filter-meta summary for a sale: same counts, owner chips are only the caller (0 included)', () => {
    const groups = [
      { stage: 'prospect', purpose: 'new_product', owner: null, research: true, count: '5' },
      { stage: 'negotiate', purpose: 'expansion', owner: 'rep-2', research: false, count: 3 },
      { stage: 'contacted', purpose: 'winback', owner: 'rep-1', research: false, count: 1 },
    ];
    const all = summarizeOpportunityMeta(groups, NAMES);
    const mine = summarizeOpportunityMeta(groups, NAMES, 'rep-1');
    expect({ ...mine, owners: [] }).toEqual({ ...all, owners: [] });
    expect(mine.owners).toEqual([{ sales_user_id: 'rep-1', name: 'Rep One', count: 1 }]);
    expect(summarizeOpportunityMeta(groups, NAMES, 'rep-3').owners).toEqual([{ sales_user_id: 'rep-3', name: null, count: 0 }]);
    expect(summarizeOpportunityMeta(groups, NAMES, null).owners).toEqual([]);
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

  it('stale handoff: 409 when the owner moved on since the request; legacy requests and coordinate are never stale', () => {
    const asked = pending({ from_owner_id: 'rep-1', from_owner_name: 'Rep One' });
    expect(staleHandoffError(asked, 'rep-1')).toBeNull();
    expect(staleHandoffError(asked, 'rep-9')).toEqual({ status: 409, message: 'คำขอนี้ล้าสมัยแล้ว ผู้ดูแลโอกาสเปลี่ยนไปแล้ว' });
    expect(staleHandoffError(asked, null)?.status).toBe(409);
    expect(staleHandoffError(pending({ from_owner_id: null }), null)).toBeNull();
    expect(staleHandoffError(pending({ from_owner_id: null }), 'rep-1')?.status).toBe(409);
    expect(staleHandoffError(pending(), 'rep-9')).toBeNull(); // stored before from_owner_id existed
    expect(staleHandoffError(pending({ kind: 'coordinate' as never, from_owner_id: 'rep-1' }), 'rep-9')).toBeNull();
  });

  it('superseded note + request view (from_owner_* always present)', () => {
    expect(supersededNote('Rep Three', 'rep-3')).toBe('ปิดอัตโนมัติ: อนุมัติส่งต่อให้ Rep Three แล้ว');
    expect(supersededNote(null, 'rep-3')).toBe('ปิดอัตโนมัติ: อนุมัติส่งต่อให้ rep-3 แล้ว');
    expect(requestView(pending())).toMatchObject({ from_owner_id: null, from_owner_name: null });
    expect(requestView(pending({ from_owner_id: 'rep-1', from_owner_name: 'Rep One' }))).toMatchObject({ from_owner_id: 'rep-1', from_owner_name: 'Rep One' });
  });
});

describe('collaboration audit log rules', () => {
  it('meta changes: only what changed, null when nothing did', () => {
    expect(metaChanges({ stage: 'prospect', purpose: 'new_product' }, { stage: 'contacted', purpose: 'new_product' })).toEqual({ stage: { from: 'prospect', to: 'contacted' } });
    expect(metaChanges({ stage: 'prospect', purpose: 'new_product' }, { stage: 'prospect', purpose: 'winback' })).toEqual({ purpose: { from: 'new_product', to: 'winback' } });
    expect(metaChanges({ stage: 'prospect', purpose: 'winback' }, { stage: 'prospect', purpose: 'winback' })).toBeNull();
  });

  it('entry: row columns + payload snapshot, nulls when absent', () => {
    const created = new Date('2026-10-08T03:00:00Z');
    expect(collabLogEntry({
      id: 'l1', status: 'owner_changed', sales_user_id: 'rep-3', account_id: 'acc-1', created_by: 'rep-3', create_date: created,
      payload: { opportunity_id: 'p1', opportunity_name: 'ร้าน', account_name: 'ร้าน (TMP)', actor_name: 'Rep Three', target_user_id: 'rep-3',
        target_user_name: 'Rep Three', request_id: 'r1', request_kind: 'handoff', note: null, seq: 1,
        changes: { owner: { from: 'rep-1', to: 'rep-3', from_name: 'Rep One', to_name: 'Rep Three' } } },
    })).toEqual({
      id: 'l1', event: 'owner_changed', opportunity_id: 'p1', opportunity_name: 'ร้าน', account_id: 'acc-1', account_name: 'ร้าน (TMP)',
      actor_id: 'rep-3', actor_name: 'Rep Three', target_user_id: 'rep-3', target_user_name: 'Rep Three', request_id: 'r1', request_kind: 'handoff',
      note: null, changes: { owner: { from: 'rep-1', to: 'rep-3', from_name: 'Rep One', to_name: 'Rep Three' } }, created_at: '2026-10-08T03:00:00.000Z',
    });
    expect(collabLogEntry({ id: 'l2', status: 'message_posted', sales_user_id: null, account_id: null, created_by: null, create_date: null, payload: { opportunity_id: 'p2' } }))
      .toMatchObject({ actor_id: null, actor_name: null, account_name: null, target_user_id: null, changes: null, created_at: null });
  });

  it('range: a day is a Bangkok day (from inclusive, to through its end), ISO instants are exact', () => {
    expect(collabLogRange()).toEqual({ gte: null, lt: null, lte: null });
    expect(collabLogRange('2026-10-08', '2026-10-08')).toEqual({
      gte: new Date('2026-10-07T17:00:00.000Z'), lt: new Date('2026-10-08T17:00:00.000Z'), lte: null,
    });
    expect(collabLogRange(undefined, '2026-12-31')).toEqual({ gte: null, lt: new Date('2026-12-31T17:00:00.000Z'), lte: null });
    expect(collabLogRange('2026-10-08T09:00:00+07:00', '2026-10-08T10:00:00Z')).toEqual({
      gte: new Date('2026-10-08T02:00:00.000Z'), lt: null, lte: new Date('2026-10-08T10:00:00.000Z'),
    });
    expect(collabLogRange('2026-10-08T10:00:00Z', '2026-10-08T10:00:00Z')).toMatchObject({ lte: new Date('2026-10-08T10:00:00Z') });
  });

  it('range errors: invalid day, from after to', () => {
    expect(collabLogRange('2026-02-30')).toMatchObject({ status: 400 });
    expect(collabLogRange(undefined, '2026-13-01')).toMatchObject({ status: 400 });
    expect(collabLogRange('2026-10-09', '2026-10-08')).toEqual({ status: 400, message: 'from ต้องไม่เกิน to' });
    expect(collabLogRange('2026-10-08T17:00:00Z', '2026-10-08')).toMatchObject({ status: 400 }); // 9 Oct 00:00 Bangkok
    expect(collabLogRange('2026-10-08T10:00:01Z', '2026-10-08T10:00:00Z')).toMatchObject({ status: 400 });
  });
});
