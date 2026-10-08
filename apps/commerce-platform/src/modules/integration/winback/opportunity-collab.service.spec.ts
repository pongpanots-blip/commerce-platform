import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WinbackActor } from './app-records.service';
import { OpportunityService } from './opportunity.service';
import { OpportunityCollabService } from './opportunity-collab.service';

const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000b2';
const PC = '00000000-0000-4000-8000-0000000000c3';
const MGR: WinbackActor = { id: 'mgr-1', isManager: true };
const REP: WinbackActor = { id: 'rep-1', isManager: false };
const OTHER: WinbackActor = { id: 'rep-2', isManager: false };
const THIRD: WinbackActor = { id: 'rep-3', isManager: false };

type Row = Record<string, any>;

/** In-memory winback_app_record / winback_account: findOne / create / save, plus a transaction manager. */
class FakeRepo {
  rows: Row[];
  private seq = 0;
  saves = 0;
  constructor(seed: Row[] = []) {
    this.rows = seed.map((r) => ({ ...r }));
  }
  private match(row: Row, where: Row) {
    return Object.entries(where).every(([k, v]) => row[k] === v);
  }
  findOne = jest.fn(async (opts: { where: Row }) => {
    const row = this.rows.find((r) => this.match(r, opts.where));
    return row ? { ...row, payload: row.payload && JSON.parse(JSON.stringify(row.payload)) } : null;
  });
  create = jest.fn((v: Row) => ({ ...v }));
  save = jest.fn(async (v: Row) => {
    this.saves += 1;
    const row: Row = { ...v, update_date: new Date() };
    if (!row.id) row.id = `rec-${++this.seq}`;
    const i = this.rows.findIndex((r) => r.id === row.id);
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
    return { ...row };
  });
  manager = { transaction: jest.fn(async (work: (em: unknown) => unknown) => work({ getRepository: () => this })) };
}

const PLACES: Row[] = [
  { id: P1, name_th: 'ร้านหนึ่ง', name_en: null, district: 'วัฒนา', raw_category: 'Japanese', rating: 4.6, review_count: 300, price_range: '฿400–800', enriched_at: '2026-09-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
  { id: P2, name_th: 'ร้านสอง', name_en: null, district: 'วัฒนา', raw_category: 'Cafe', rating: null, review_count: null, price_range: null, enriched_at: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-05T00:00:00Z' },
  { id: PC, name_th: 'ร้านที่แปลงแล้ว', name_en: null, district: 'วัฒนา', raw_category: 'Steak', rating: 4.2, review_count: 50, price_range: '฿900', enriched_at: '2026-09-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
];

/** Query builder over PLACES that joins the account + stored meta like OpportunityService's SQL, and records the clauses. */
function placesRepo(accounts: FakeRepo, records: FakeRepo) {
  const calls: Array<{ wheres: string[]; params: Row }> = [];
  let groups: Row[] = [];
  const join = (p: Row): Row => {
    const a = accounts.rows.find((x) => x.restaurant_place_id === p.id);
    const m = records.rows.find((r) => r.kind === 'opportunity_meta' && r.record_key === p.id);
    return {
      ...p, winback_account_id: a?.id ?? null, account_stage: a?.stage ?? null, account_owner_id: a?.assigned_sales_user_id ?? null,
      account_cuisine_id: a?.cuisine_id ?? null, meta_id: m?.id ?? null, meta_payload: m?.payload ?? null,
      meta_owner_id: m?.sales_user_id ?? null, meta_version: m?.version ?? null, meta_updated_at: m?.update_date ?? null,
    };
  };
  const repo = {
    setGroups: (g: Row[]) => { groups = g; },
    calls,
    createQueryBuilder: jest.fn(() => {
      const st = { wheres: [] as string[], params: {} as Row };
      calls.push(st);
      const qb: Row = {};
      for (const k of ['select', 'addSelect', 'orderBy', 'addOrderBy', 'limit', 'groupBy', 'addGroupBy']) qb[k] = jest.fn(() => qb);
      qb.leftJoin = jest.fn((_e: unknown, _a: string, _c: string, params?: Row) => { Object.assign(st.params, params); return qb; });
      qb.where = qb.andWhere = jest.fn((sql: string, params?: Row) => { st.wheres.push(sql); Object.assign(st.params, params); return qb; });
      qb.getRawOne = jest.fn(async () => { const p = PLACES.find((x) => x.id === st.params.id); return p ? join(p) : undefined; });
      // select(expr, alias) = the filter-meta GROUP BY; select([...]) = the list.
      qb.getRawMany = jest.fn(async () => (qb.select.mock.calls[0]?.[1] ? groups : PLACES.map(join).filter((r) => !r.winback_account_id)));
      return qb;
    }),
  };
  return repo;
}

function setup() {
  const records = new FakeRepo();
  const accounts = new FakeRepo([
    { id: 'acc-c', customer_code: 'TMP-1', stage: 'contacted', assigned_sales_user_id: 'rep-2', cuisine_id: 'cui-1', restaurant_place_id: PC },
    { id: 'acc-x', customer_code: 'GNA1', stage: 'inactive_pool', assigned_sales_user_id: 'rep-1', cuisine_id: null, restaurant_place_id: null },
  ]);
  const places = placesRepo(accounts, records);
  const leads = {
    listSalesUsers: jest.fn(async () => [
      { id: 'rep-1', email: 'r1@x', name: 'Rep One', role: 'sale' },
      { id: 'rep-2', email: 'r2@x', name: 'Rep Two', role: 'sale' },
      { id: 'rep-3', email: 'r3@x', name: 'Rep Three', role: 'sale' },
    ]),
    createTmpFromRestaurantPlace: jest.fn(),
  };
  const opportunities = new OpportunityService(places as never, accounts as never, leads as never);
  const collab = new OpportunityCollabService(records as never, opportunities, leads as never);
  return { records, accounts, places, leads, opportunities, collab };
}

describe('OpportunityService — §4.11.8 list filters + meta', () => {
  it('every item carries meta; the existing fields and counts are unchanged', async () => {
    const { opportunities } = setup();
    const out = await opportunities.list(REP, { page: 1, limit: 20, tab: 'needs_enrich' } as never);
    expect(out.counts).toEqual({ recommended: 1, near_warehouse: 0, needs_enrich: 1 });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ id: P2, enrichment_status: 'enriching', converted_to_winback: false });
    expect(out.items[0].meta).toMatchObject({
      opportunity_id: P2, stage: 'prospect', purpose: 'new_product', owner_sales_user_id: null, source: 'derived', version: 0,
      recommendation: { reason: 'needs_research', urgency: 'research', source: 'restaurant_place', source_date: '2026-08-05T00:00:00.000Z' },
    });
  });

  it('stage / purpose / recommendation / owner / unassigned filters go into the SQL before the cap', async () => {
    const { opportunities, places } = setup();
    await opportunities.list(MGR, { stage: 'negotiate', purpose: 'winback', recommendation: 'needs_research', owner_sales_user_id: 'rep-2' } as never);
    const { wheres, params } = places.calls.at(-1)!;
    expect(wheres).toEqual(expect.arrayContaining([
      'a.id IS NULL',
      "COALESCE(m.payload->>'stage', a.stage, 'prospect') = :metaStage",
      "COALESCE(m.payload->>'purpose', 'new_product') = :metaPurpose",
      "(p.enriched_at IS NULL OR p.price_range IS NULL OR p.price_range !~ '[1-9]')",
      'COALESCE(m.sales_user_id, a.assigned_sales_user_id) = :metaOwner',
    ]));
    expect(params).toMatchObject({ metaKind: 'opportunity_meta', metaStage: 'negotiate', metaPurpose: 'winback', metaOwner: 'rep-2' });
    await opportunities.list(REP, { recommendation: 'late_order', unassigned_only: true } as never);
    expect(places.calls.at(-1)!.wheres).toEqual(expect.arrayContaining(['1 = 0', 'COALESCE(m.sales_user_id, a.assigned_sales_user_id) IS NULL']));
  });

  it('a sale may filter only by self (403); owner + unassigned_only is 400', async () => {
    const { opportunities } = setup();
    await expect(opportunities.list(REP, { owner_sales_user_id: 'rep-2' } as never)).rejects.toThrow(ForbiddenException);
    await expect(opportunities.list(MGR, { owner_sales_user_id: 'rep-2', unassigned_only: true } as never)).rejects.toThrow(BadRequestException);
    await expect(opportunities.list(REP, { owner_sales_user_id: 'rep-1' } as never)).resolves.toBeDefined();
  });

  it('meta: derived for an open place, follows the account for a converted one, 404 for an unknown id', async () => {
    const { opportunities } = setup();
    expect(await opportunities.meta(P1)).toMatchObject({ stage: 'prospect', recommendation: null, source: 'derived' });
    expect(await opportunities.meta(PC)).toMatchObject({ stage: 'contacted', owner_sales_user_id: 'rep-2', owner_name: 'Rep Two', cuisine_id: 'cui-1', district_code: null });
    await expect(opportunities.meta('00000000-0000-4000-8000-000000000999')).rejects.toThrow('Opportunity not found');
  });

  it('filter-meta: a sale counts own + unassigned, a manager everything', async () => {
    const { opportunities, places } = setup();
    places.setGroups([
      { stage: 'prospect', purpose: 'new_product', owner: null, research: true, count: '4' },
      { stage: 'contacted', purpose: 'winback', owner: 'rep-1', research: false, count: '1' },
    ]);
    const out = await opportunities.filterMeta(REP);
    expect(places.calls.at(-1)!.wheres).toEqual(expect.arrayContaining([
      'a.id IS NULL',
      '(COALESCE(m.sales_user_id, a.assigned_sales_user_id) IS NULL OR COALESCE(m.sales_user_id, a.assigned_sales_user_id) = :me)',
    ]));
    expect(places.calls.at(-1)!.params.me).toBe('rep-1');
    expect(out).toMatchObject({ unassigned_count: 4, owners: [{ sales_user_id: 'rep-1', name: 'Rep One', count: 1 }] });
    expect(out.recommendation_reasons.find((r) => r.value === 'needs_research')).toEqual({ value: 'needs_research', count: 4 });
    await opportunities.filterMeta(MGR);
    expect(places.calls.at(-1)!.wheres).toEqual(['a.id IS NULL']);
  });

  it('account → converted opportunity ids', async () => {
    const { opportunities } = setup();
    expect(await opportunities.accountOpportunities('acc-c')).toEqual([PC]);
    expect(await opportunities.accountOpportunities('acc-x')).toEqual([]);
    await expect(opportunities.accountOpportunities('acc-none')).rejects.toThrow('winback account not found');
  });
});

describe('OpportunityCollabService — meta PATCH', () => {
  it('stores only what was sent, bumps the version, never touches the account', async () => {
    const { collab, accounts, opportunities, records } = setup();
    await expect(collab.updateMeta(REP, P1, {})).rejects.toThrow(BadRequestException);
    const first = await collab.updateMeta(MGR, PC, { purpose: 'winback', expected_version: 0 });
    expect(first).toMatchObject({ stage: 'contacted', purpose: 'winback', owner_sales_user_id: 'rep-2', source: 'stored', version: 1 });
    expect(records.rows[0]).toMatchObject({ kind: 'opportunity_meta', record_key: PC, account_id: 'acc-c', sales_user_id: null, payload: { purpose: 'winback' } });
    const second = await collab.updateMeta(OTHER, PC, { stage: 'negotiate', expected_version: 1 });
    expect(second).toMatchObject({ stage: 'negotiate', purpose: 'winback', version: 2 });
    expect(accounts.rows.find((a) => a.id === 'acc-c')!.stage).toBe('contacted');
    expect(await opportunities.meta(PC)).toMatchObject({ stage: 'negotiate', version: 2, source: 'stored' });
  });

  it('403 for a sale on someone else\'s opportunity, any sale while unowned, 409 on a stale version, 404 unknown', async () => {
    const { collab } = setup();
    await expect(collab.updateMeta(REP, PC, { stage: 'won' })).rejects.toThrow('เฉพาะผู้ดูแลโอกาสหรือ manager ที่แก้ได้');
    await expect(collab.updateMeta(REP, P1, { stage: 'contacted' })).resolves.toMatchObject({ stage: 'contacted', version: 1 });
    await expect(collab.updateMeta(OTHER, P1, { stage: 'negotiate', expected_version: 0 })).rejects.toThrow('ข้อมูลเปลี่ยนไปแล้ว (version 1)');
    await expect(collab.updateMeta(OTHER, P1, { stage: 'negotiate', expected_version: 0 })).rejects.toThrow(ConflictException);
    await expect(collab.updateMeta(MGR, '00000000-0000-4000-8000-000000000999', { stage: 'won' })).rejects.toThrow(NotFoundException);
  });
});

describe('OpportunityCollabService — collaboration', () => {
  it('empty state when nothing is stored; directory is names only', async () => {
    const { collab } = setup();
    expect(await collab.collaboration(P1)).toEqual({ opportunity_id: P1, owner_sales_user_id: null, owner_name: null, requests: [], messages: [], revision: 0 });
    expect(await collab.directory()).toEqual([{ id: 'rep-1', name: 'Rep One' }, { id: 'rep-2', name: 'Rep Two' }, { id: 'rep-3', name: 'Rep Three' }]);
    await expect(collab.collaboration('00000000-0000-4000-8000-000000000999')).rejects.toThrow('Opportunity not found');
  });

  it('request: 400 self / not in roster / handoff to the owner, 409 duplicate pending, 403 without a caller id', async () => {
    const { collab } = setup();
    await expect(collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-1', reason: 'x' })).rejects.toThrow(BadRequestException);
    await expect(collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'ghost', reason: 'x' })).rejects.toThrow('ผู้รับไม่ใช่เซลล์ในระบบ');
    await expect(collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: '   ' })).rejects.toThrow(BadRequestException);
    await expect(collab.createRequest(REP, PC, { kind: 'handoff', recipient_id: 'rep-2', reason: 'x' })).rejects.toThrow('อยู่กับผู้รับอยู่แล้ว');
    await expect(collab.createRequest({ id: '', isManager: false }, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: 'x' })).rejects.toThrow(ForbiddenException);
    const state = await collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: ' ช่วยดูแลต่อ ' });
    expect(state).toMatchObject({ revision: 1, requests: [{
      kind: 'handoff', requester_id: 'rep-1', requester_name: 'Rep One', recipient_id: 'rep-2', recipient_name: 'Rep Two',
      reason: 'ช่วยดูแลต่อ', status: 'pending', resolution_note: null, resolved_by_id: null, resolved_at: null,
    }] });
    expect(state.requests[0].id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: 'again' })).rejects.toThrow('มีคำขอแบบนี้รออยู่แล้ว');
    await expect(collab.createRequest(REP, P1, { kind: 'coordinate', recipient_id: 'rep-2', reason: 'together' })).resolves.toMatchObject({ revision: 2 });
  });

  it('approve a handoff (recipient): the recipient becomes the coordination owner, the account is untouched', async () => {
    const { collab, accounts, opportunities } = setup();
    const { requests } = await collab.createRequest(REP, PC, { kind: 'handoff', recipient_id: 'rep-3', reason: 'x' });
    const id = requests[0].id;
    await expect(collab.resolveRequest(REP, PC, id, { status: 'approved', note: 'ok' })).rejects.toThrow(ForbiddenException);
    await expect(collab.resolveRequest(THIRD, PC, '00000000-0000-4000-8000-000000000999', { status: 'approved', note: 'ok' })).rejects.toThrow('request not found');
    const out = await collab.resolveRequest(THIRD, PC, id, { status: 'approved', note: ' รับเอง ' });
    expect(out).toMatchObject({ owner_sales_user_id: 'rep-3', owner_name: 'Rep Three', revision: 2, requests: [{
      status: 'approved', resolution_note: 'รับเอง', resolved_by_id: 'rep-3', resolved_by_name: 'Rep Three',
    }] });
    expect(out.requests[0].resolved_at).toEqual(expect.any(String));
    expect(await opportunities.meta(PC)).toMatchObject({ owner_sales_user_id: 'rep-3', source: 'stored', version: 1 });
    expect(accounts.rows.find((a) => a.id === 'acc-c')).toMatchObject({ assigned_sales_user_id: 'rep-2', stage: 'contacted' });
    await expect(collab.resolveRequest(MGR, PC, id, { status: 'rejected', note: 'no' })).rejects.toThrow('คำขอนี้ไม่ได้รออยู่แล้ว');
    // the new owner can now edit the meta; the account's rep no longer can
    await expect(collab.updateMeta(THIRD, PC, { stage: 'appointment' })).resolves.toMatchObject({ stage: 'appointment', version: 2 });
    await expect(collab.updateMeta(OTHER, PC, { stage: 'won' })).rejects.toThrow(ForbiddenException);
  });

  it('reject (manager) and cancel (requester) do not change the owner; coordinate approval keeps it too', async () => {
    const { collab, opportunities } = setup();
    let state = await collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: 'x' });
    state = await collab.createRequest(REP, P1, { kind: 'coordinate', recipient_id: 'rep-3', reason: 'y' });
    state = await collab.createRequest(OTHER, P1, { kind: 'handoff', recipient_id: 'rep-3', reason: 'z' });
    const [handoff, coordinate, other] = state.requests.map((r) => r.id);
    await expect(collab.resolveRequest(OTHER, P1, other, { status: 'cancelled', note: 'ไม่ต้องแล้ว' })).resolves.toBeDefined();
    await expect(collab.resolveRequest(OTHER, P1, handoff, { status: 'cancelled', note: 'x' })).rejects.toThrow('เฉพาะผู้ส่งคำขอหรือ manager ที่ยกเลิกได้');
    await collab.resolveRequest(MGR, P1, handoff, { status: 'rejected', note: 'ยังไม่ใช่ตอนนี้' });
    const out = await collab.resolveRequest(THIRD, P1, coordinate, { status: 'approved', note: 'ไปด้วยกัน' });
    expect(out.requests.map((r) => r.status)).toEqual(['rejected', 'approved', 'cancelled']);
    expect(out.owner_sales_user_id).toBeNull();
    expect(await opportunities.meta(P1)).toMatchObject({ owner_sales_user_id: null, source: 'derived' });
  });

  it('messages: recipient in roster and not self, trimmed text, call-note flag, oldest first', async () => {
    const { collab } = setup();
    await expect(collab.postMessage(REP, P1, { recipient_id: 'rep-1', text: 'x' })).rejects.toThrow(BadRequestException);
    await expect(collab.postMessage(REP, P1, { recipient_id: 'ghost', text: 'x' })).rejects.toThrow(BadRequestException);
    await expect(collab.postMessage(REP, P1, { recipient_id: 'rep-2', text: '  ' })).rejects.toThrow(BadRequestException);
    await collab.postMessage(REP, P1, { recipient_id: 'rep-2', text: ' โทรหาร้านแล้ว ', is_call_note: true });
    const out = await collab.postMessage(OTHER, P1, { recipient_id: 'rep-1', text: 'รับทราบ' });
    expect(out.messages).toMatchObject([
      { author_id: 'rep-1', author_name: 'Rep One', recipient_id: 'rep-2', recipient_name: 'Rep Two', text: 'โทรหาร้านแล้ว', is_call_note: true },
      { author_id: 'rep-2', recipient_id: 'rep-1', text: 'รับทราบ', is_call_note: false },
    ]);
    expect(out.revision).toBe(2);
  });

  it('every write runs in a transaction; a lost first-insert race is retried once', async () => {
    const { collab, records } = setup();
    let calls = 0;
    const real = records.manager.transaction.getMockImplementation()!;
    records.manager.transaction.mockImplementation(async (work: (em: unknown) => unknown) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      return real(work);
    });
    await expect(collab.postMessage(REP, P1, { recipient_id: 'rep-2', text: 'x' })).resolves.toMatchObject({ revision: 1 });
    expect(calls).toBe(2);
    records.manager.transaction.mockImplementation(async () => { throw Object.assign(new Error('duplicate key'), { code: '23505' }); });
    await expect(collab.postMessage(REP, P1, { recipient_id: 'rep-2', text: 'x' })).rejects.toThrow('duplicate key');
  });
});
