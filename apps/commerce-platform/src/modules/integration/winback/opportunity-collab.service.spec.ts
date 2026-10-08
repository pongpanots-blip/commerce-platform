import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WinbackActor } from './app-records.service';
import { OpportunityService } from './opportunity.service';
import { OpportunityCollabService } from './opportunity-collab.service';
import { LeadService } from './lead.service';
import { WINBACK_NAMED_ROLES } from './winback-roles';

const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000b2';
const PC = '00000000-0000-4000-8000-0000000000c3';
const MGR: WinbackActor = { id: 'mgr-1', isManager: true };
const REP: WinbackActor = { id: 'rep-1', isManager: false };
const OTHER: WinbackActor = { id: 'rep-2', isManager: false };
const THIRD: WinbackActor = { id: 'rep-3', isManager: false };
const ADMIN: WinbackActor = { id: 'adm-1', isManager: true };

type Row = Record<string, any>;

/**
 * In-memory winback_app_record / winback_account: findOne / create / save, a transaction manager whose
 * repository tags every write with its transaction (and rolls them all back when the work or the commit
 * fails), and the audit-log query builder (filters by the service's named parameters, sorts, pages).
 */
class FakeRepo {
  rows: Row[];
  private seq = 0;
  private txSeq = 0;
  saves = 0;
  /** Every save, in order: its kind / status and the transaction it went through (null = none). */
  writes: Array<{ kind: string; status: string | null; tx: number | null }> = [];
  /** `create_date` of rows inserted from now on (one per transaction, like Postgres `now()`). */
  clock: Date | null = null;
  /** Make the next commits fail after the work ran (everything written in them is rolled back). */
  failCommit = false;
  queries: Array<{ wheres: string[]; params: Row; order: string[]; offset: number; limit: number }> = [];
  constructor(seed: Row[] = []) {
    this.rows = seed.map((r) => ({ ...r }));
  }
  private match(row: Row, where: Row) {
    return Object.entries(where).every(([k, v]) => row[k] === v);
  }
  findOne = jest.fn(async (opts: { where: Row; lock?: unknown }) => {
    const row = this.rows.find((r) => this.match(r, opts.where));
    return row ? { ...row, payload: row.payload && JSON.parse(JSON.stringify(row.payload)) } : null;
  });
  create = jest.fn((v: Row) => ({ ...v }));
  private write(v: Row, tx: number | null, at: Date) {
    this.saves += 1;
    this.writes.push({ kind: v.kind, status: v.status ?? null, tx });
    const row: Row = { ...v, payload: v.payload && JSON.parse(JSON.stringify(v.payload)), update_date: at };
    if (!row.id) {
      row.id = `rec-${++this.seq}`;
      row.create_date = at;
    }
    const i = this.rows.findIndex((r) => r.id === row.id);
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
    return { ...row };
  }
  save = jest.fn(async (v: Row) => this.write(v, null, this.clock ?? new Date()));
  manager = {
    transaction: jest.fn(async (work: (em: unknown) => unknown) => {
      const tx = ++this.txSeq;
      const at = this.clock ?? new Date();
      const before = this.rows.map((r) => ({ ...r }));
      const repo = { findOne: this.findOne, create: this.create, save: jest.fn(async (v: Row) => this.write(v, tx, at)) };
      try {
        const out = await work({ getRepository: () => repo });
        if (this.failCommit) throw new Error('commit failed');
        return out;
      } catch (error) {
        this.rows = before;
        throw error;
      }
    }),
  };
  /** Rows of a kind, oldest first. */
  kind(kind: string) {
    return this.rows.filter((r) => r.kind === kind);
  }
  createQueryBuilder = jest.fn(() => {
    const st = { wheres: [] as string[], params: {} as Row, order: [] as string[], offset: 0, limit: Infinity };
    this.queries.push(st);
    const qb: Row = {};
    qb.where = qb.andWhere = jest.fn((sql: string, params?: Row) => { st.wheres.push(sql); Object.assign(st.params, params); return qb; });
    qb.orderBy = qb.addOrderBy = jest.fn((expr: string, dir: string) => { st.order.push(`${expr} ${dir}`); return qb; });
    qb.offset = jest.fn((n: number) => { st.offset = n; return qb; });
    qb.limit = jest.fn((n: number) => { st.limit = n; return qb; });
    qb.getManyAndCount = jest.fn(async () => {
      const p = st.params;
      const ms = (d: unknown) => new Date(d as string).getTime();
      const hits = this.rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.kind === p.logKind
          && (!p.logOpportunity || r.payload.opportunity_id === p.logOpportunity)
          && (!p.logActor || r.sales_user_id === p.logActor)
          && (!p.logTarget || r.payload.target_user_id === p.logTarget)
          && (!p.logUser || r.sales_user_id === p.logUser || r.payload.target_user_id === p.logUserText)
          && (!p.logEvents || p.logEvents.includes(r.status))
          && (!p.logFrom || ms(r.create_date) >= ms(p.logFrom))
          && (!p.logBefore || ms(r.create_date) < ms(p.logBefore))
          && (!p.logUntil || ms(r.create_date) <= ms(p.logUntil)))
        .sort((a, b) => ms(b.r.create_date) - ms(a.r.create_date) || b.r.payload.seq - a.r.payload.seq || b.i - a.i)
        .map((x) => x.r);
      return [hits.slice(st.offset, st.offset + st.limit), hits.length];
    });
    return qb;
  });
}

const LOG = 'opp_collab_log';
const at = (iso: string) => new Date(iso);

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
      account_cuisine_id: a?.cuisine_id ?? null, account_name: a?.display_name ?? null, meta_id: m?.id ?? null, meta_payload: m?.payload ?? null,
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

/** Active staff as `listStaffNames` returns them (sales team + admins). */
const STAFF = [
  { id: 'mgr-1', name: 'Mgr One', role: 'manager' },
  { id: 'rep-1', name: 'Rep One', role: 'sale' },
  { id: 'rep-3', name: 'Rep Three', role: 'sale' },
  { id: 'rep-2', name: 'Rep Two', role: 'sales' },
  { id: 'adm-1', name: 'Admin One', role: 'admin' },
];

function setup(staff: Array<{ id: string; name: string; role: string }> = STAFF) {
  const records = new FakeRepo();
  const accounts = new FakeRepo([
    { id: 'acc-c', customer_code: 'TMP-1', display_name: 'ร้านที่แปลงแล้ว (TMP)', stage: 'contacted', assigned_sales_user_id: 'rep-2', cuisine_id: 'cui-1', restaurant_place_id: PC },
    { id: 'acc-x', customer_code: 'GNA1', stage: 'inactive_pool', assigned_sales_user_id: 'rep-1', cuisine_id: null, restaurant_place_id: null },
  ]);
  const places = placesRepo(accounts, records);
  const leads = {
    // The 100-row `/sales-users` picker: §4.11.8 must not depend on it.
    listSalesUsers: jest.fn(async () => staff.filter((u) => u.role !== 'admin').slice(0, 100)),
    listStaffNames: jest.fn(async (roles: readonly string[]) => staff.filter((u) => roles.includes(u.role))),
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

  it('filter-meta counts the list\'s population for every caller; a sale\'s owner chips are only themself', async () => {
    const { opportunities, places } = setup();
    places.setGroups([
      { stage: 'prospect', purpose: 'new_product', owner: null, research: true, count: '4' },
      { stage: 'contacted', purpose: 'winback', owner: 'rep-1', research: false, count: '1' },
      { stage: 'negotiate', purpose: 'winback', owner: 'rep-2', research: false, count: '2' },
    ]);
    const sale = await opportunities.filterMeta(REP);
    // same WHERE as the (unscoped) list: no owner clause for a sale
    expect(places.calls.at(-1)!.wheres).toEqual(['a.id IS NULL']);
    expect(sale).toMatchObject({ unassigned_count: 4, owners: [{ sales_user_id: 'rep-1', name: 'Rep One', count: 1 }] });
    expect(sale.stages.find((x) => x.value === 'negotiate')).toEqual({ value: 'negotiate', count: 2 });
    expect(sale.purposes.find((x) => x.value === 'winback')).toEqual({ value: 'winback', count: 3 });
    expect(sale.recommendation_reasons.find((r) => r.value === 'needs_research')).toEqual({ value: 'needs_research', count: 4 });
    // the manager sees the same counts, plus every owner
    const mgr = await opportunities.filterMeta(MGR);
    expect(places.calls.at(-1)!.wheres).toEqual(['a.id IS NULL']);
    expect({ ...mgr, owners: [] }).toEqual({ ...sale, owners: [] });
    expect(mgr.owners).toEqual([{ sales_user_id: 'rep-2', name: 'Rep Two', count: 2 }, { sales_user_id: 'rep-1', name: 'Rep One', count: 1 }]);
    // a sale who owns nothing still gets their chip (0); no caller id → no chip
    expect((await opportunities.filterMeta(THIRD)).owners).toEqual([{ sales_user_id: 'rep-3', name: 'Rep Three', count: 0 }]);
    expect((await opportunities.filterMeta({ id: '', isManager: false })).owners).toEqual([]);
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
    // recipients only (sale / sales / manager) — admins resolve names but are not recipients
    expect(await collab.directory()).toEqual([
      { id: 'mgr-1', name: 'Mgr One' }, { id: 'rep-1', name: 'Rep One' }, { id: 'rep-3', name: 'Rep Three' }, { id: 'rep-2', name: 'Rep Two' },
    ]);
    await expect(collab.collaboration('00000000-0000-4000-8000-000000000999')).rejects.toThrow('Opportunity not found');
  });

  it('request: 400 self / not in roster / handoff to the owner, 409 duplicate pending, 403 without a caller id', async () => {
    const { collab } = setup();
    await expect(collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-1', reason: 'x' })).rejects.toThrow(BadRequestException);
    await expect(collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'ghost', reason: 'x' })).rejects.toThrow('ผู้รับไม่ใช่เซลล์ในระบบ');
    await expect(collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'adm-1', reason: 'x' })).rejects.toThrow('ผู้รับไม่ใช่เซลล์ในระบบ');
    await expect(collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: '   ' })).rejects.toThrow(BadRequestException);
    await expect(collab.createRequest(REP, PC, { kind: 'handoff', recipient_id: 'rep-2', reason: 'x' })).rejects.toThrow('อยู่กับผู้รับอยู่แล้ว');
    await expect(collab.createRequest({ id: '', isManager: false }, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: 'x' })).rejects.toThrow(ForbiddenException);
    const state = await collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: ' ช่วยดูแลต่อ ' });
    expect(state).toMatchObject({ revision: 1, requests: [{
      kind: 'handoff', requester_id: 'rep-1', requester_name: 'Rep One', recipient_id: 'rep-2', recipient_name: 'Rep Two',
      reason: 'ช่วยดูแลต่อ', status: 'pending', resolution_note: null, resolved_by_id: null, resolved_at: null,
      from_owner_id: null, from_owner_name: null,
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

describe('OpportunityCollabService — review follow-ups (§4.11.8)', () => {
  it('a manager approves a handoff and cancels someone else\'s request', async () => {
    const { collab, opportunities } = setup();
    let state = await collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: 'x' });
    state = await collab.createRequest(OTHER, P1, { kind: 'coordinate', recipient_id: 'rep-3', reason: 'y' });
    const [handoff, coordinate] = state.requests.map((r) => r.id);
    const approved = await collab.resolveRequest(MGR, P1, handoff, { status: 'approved', note: 'อนุมัติแทน' });
    expect(approved).toMatchObject({ owner_sales_user_id: 'rep-2', owner_name: 'Rep Two' });
    expect(approved.requests[0]).toMatchObject({ status: 'approved', resolved_by_id: 'mgr-1', resolved_by_name: 'Mgr One' });
    const cancelled = await collab.resolveRequest(MGR, P1, coordinate, { status: 'cancelled', note: 'ไม่ต้องแล้ว' });
    expect(cancelled.requests[1]).toMatchObject({ status: 'cancelled', resolution_note: 'ไม่ต้องแล้ว', resolved_by_id: 'mgr-1' });
    expect(await opportunities.meta(P1)).toMatchObject({ owner_sales_user_id: 'rep-2' });
  });

  it('400 on a blank resolve note, 403 on a message without a caller id — nothing is written', async () => {
    const { collab, records } = setup();
    const { requests } = await collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: 'x' });
    const saves = records.saves;
    await expect(collab.resolveRequest(OTHER, P1, requests[0].id, { status: 'approved', note: '   ' })).rejects.toThrow(BadRequestException);
    await expect(collab.postMessage({ id: '', isManager: true }, P1, { recipient_id: 'rep-2', text: 'x' })).rejects.toThrow(ForbiddenException);
    expect(records.saves).toBe(saves);
  });

  it('a coordinate request may go to the current owner (a handoff may not)', async () => {
    const { collab } = setup();
    await expect(collab.createRequest(REP, PC, { kind: 'handoff', recipient_id: 'rep-2', reason: 'x' })).rejects.toThrow('อยู่กับผู้รับอยู่แล้ว');
    const out = await collab.createRequest(REP, PC, { kind: 'coordinate', recipient_id: 'rep-2', reason: 'ช่วยกันดู' });
    expect(out.requests[0]).toMatchObject({ kind: 'coordinate', recipient_id: 'rep-2', status: 'pending', from_owner_id: null, from_owner_name: null });
  });

  it('a handoff stores who owned it; approving after the owner changed is 409 and writes nothing', async () => {
    const { collab, accounts, records, opportunities } = setup();
    const { requests } = await collab.createRequest(REP, PC, { kind: 'handoff', recipient_id: 'rep-3', reason: 'x' });
    expect(requests[0]).toMatchObject({ from_owner_id: 'rep-2', from_owner_name: 'Rep Two' });
    // the converted account moved to another rep after the request was made
    accounts.rows.find((a) => a.id === 'acc-c')!.assigned_sales_user_id = 'rep-1';
    const rows = JSON.stringify(records.rows);
    const saves = records.saves;
    const stale = collab.resolveRequest(THIRD, PC, requests[0].id, { status: 'approved', note: 'ok' });
    await expect(stale).rejects.toThrow(ConflictException);
    await expect(collab.resolveRequest(MGR, PC, requests[0].id, { status: 'approved', note: 'ok' })).rejects.toThrow('คำขอนี้ล้าสมัยแล้ว ผู้ดูแลโอกาสเปลี่ยนไปแล้ว');
    expect(records.saves).toBe(saves);
    expect(JSON.stringify(records.rows)).toBe(rows);
    expect(await opportunities.meta(PC)).toMatchObject({ owner_sales_user_id: 'rep-1', source: 'derived' });
    // it stays pending: rejecting / cancelling still work
    expect((await collab.collaboration(PC)).requests[0].status).toBe('pending');
    await expect(collab.resolveRequest(REP, PC, requests[0].id, { status: 'cancelled', note: 'ล้าสมัย' })).resolves.toMatchObject({ requests: [{ status: 'cancelled' }] });
  });

  it('a handoff stored before from_owner_id existed is never stale', async () => {
    const { collab, records, opportunities } = setup();
    records.rows.push({
      id: 'legacy', kind: 'opportunity_collab', record_key: PC, version: 1, payload: {
        messages: [],
        requests: [{
          id: '00000000-0000-4000-8000-00000000aaaa', kind: 'handoff', requester_id: 'rep-1', requester_name: 'Rep One', recipient_id: 'rep-3',
          recipient_name: 'Rep Three', reason: 'x', created_at: '2026-10-01T00:00:00.000Z', status: 'pending', resolution_note: null,
          resolved_by_id: null, resolved_by_name: null, resolved_at: null,
        }],
      },
    });
    const before = await collab.collaboration(PC);
    expect(before.requests[0]).toMatchObject({ from_owner_id: null, from_owner_name: null });
    await collab.resolveRequest(THIRD, PC, '00000000-0000-4000-8000-00000000aaaa', { status: 'approved', note: 'ok' });
    expect(await opportunities.meta(PC)).toMatchObject({ owner_sales_user_id: 'rep-3' });
    expect('from_owner_id' in records.rows.find((r) => r.id === 'legacy')!.payload.requests[0]).toBe(false);
  });

  it('approving a handoff supersedes every other pending handoff (logged); coordinate requests are untouched', async () => {
    const { collab, records } = setup();
    await collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: 'a' });
    await collab.createRequest(OTHER, P1, { kind: 'handoff', recipient_id: 'rep-3', reason: 'b' });
    await collab.createRequest(THIRD, P1, { kind: 'handoff', recipient_id: 'rep-1', reason: 'c' });
    const state = await collab.createRequest(REP, P1, { kind: 'coordinate', recipient_id: 'rep-3', reason: 'd' });
    const [first, second, third, coordinate] = state.requests.map((r) => r.id);
    await collab.resolveRequest(MGR, P1, third, { status: 'rejected', note: 'ไม่' });
    const out = await collab.resolveRequest(MGR, P1, second, { status: 'approved', note: 'ให้ Rep Three' });
    expect(out.owner_sales_user_id).toBe('rep-3');
    expect(out.requests.map((r) => [r.id, r.status])).toEqual([[first, 'superseded'], [second, 'approved'], [third, 'rejected'], [coordinate, 'pending']]);
    expect(out.requests[0]).toMatchObject({
      resolution_note: 'ปิดอัตโนมัติ: อนุมัติส่งต่อให้ Rep Three แล้ว', resolved_by_id: 'mgr-1', resolved_by_name: 'Mgr One', resolved_at: expect.any(String),
    });
    // a superseded request is no longer pending
    await expect(collab.resolveRequest(OTHER, P1, first, { status: 'approved', note: 'x' })).rejects.toThrow('คำขอนี้ไม่ได้รออยู่แล้ว');
    const lastTx = records.writes.at(-1)!.tx;
    const written = records.writes.filter((w) => w.tx === lastTx);
    expect(written.map((w) => [w.kind, w.status])).toEqual([
      ['opportunity_meta', null], ['opportunity_collab', null],
      [LOG, 'request_approved'], [LOG, 'owner_changed'], [LOG, 'request_superseded'],
    ]);
    const superseded = records.kind(LOG).find((r) => r.status === 'request_superseded')!;
    expect(superseded).toMatchObject({ sales_user_id: 'mgr-1', payload: {
      request_id: first, request_kind: 'handoff', target_user_id: 'rep-2', target_user_name: 'Rep Two',
      note: 'ปิดอัตโนมัติ: อนุมัติส่งต่อให้ Rep Three แล้ว', actor_name: 'Mgr One',
    } });
  });

  it('every event writes one log row in the change\'s own transaction, names snapshotted', async () => {
    const { collab, records } = setup();
    // meta change on a converted place: account id + name on the row
    await collab.updateMeta(OTHER, PC, { stage: 'negotiate', purpose: 'winback' });
    await collab.updateMeta(OTHER, PC, { stage: 'negotiate' }); // nothing changed → no row
    const created = await collab.createRequest(REP, PC, { kind: 'handoff', recipient_id: 'rep-3', reason: 'ช่วยดูแลต่อ' });
    await collab.postMessage(REP, PC, { recipient_id: 'rep-2', text: 'โทรหาร้านแล้ว', is_call_note: true });
    await collab.resolveRequest(THIRD, PC, created.requests[0].id, { status: 'approved', note: 'รับเอง' });
    const logs = records.kind(LOG);
    expect(logs.map((r) => r.status)).toEqual(['meta_changed', 'request_created', 'message_posted', 'request_approved', 'owner_changed']);
    for (const r of logs) {
      expect(r).toMatchObject({ record_key: null, account_id: 'acc-c', payload: { opportunity_id: PC, opportunity_name: 'ร้านที่แปลงแล้ว', account_name: 'ร้านที่แปลงแล้ว (TMP)' } });
      expect(r.created_by).toBe(r.sales_user_id);
    }
    expect(logs[0]).toMatchObject({ sales_user_id: 'rep-2', payload: {
      actor_name: 'Rep Two', target_user_id: null, request_id: null, note: null,
      changes: { stage: { from: 'contacted', to: 'negotiate' }, purpose: { from: 'new_product', to: 'winback' } },
    } });
    expect(logs[1]).toMatchObject({ sales_user_id: 'rep-1', payload: {
      target_user_id: 'rep-3', target_user_name: 'Rep Three', request_id: created.requests[0].id, request_kind: 'handoff', note: 'ช่วยดูแลต่อ', changes: null,
    } });
    expect(logs[2]).toMatchObject({ sales_user_id: 'rep-1', payload: { target_user_id: 'rep-2', note: 'โทรหาร้านแล้ว', request_id: null } });
    expect(logs[3]).toMatchObject({ sales_user_id: 'rep-3', payload: { target_user_id: 'rep-3', note: 'รับเอง', seq: 0 } });
    expect(logs[4]).toMatchObject({ sales_user_id: 'rep-3', payload: {
      target_user_id: 'rep-3', request_id: created.requests[0].id, seq: 1,
      changes: { owner: { from: 'rep-2', to: 'rep-3', from_name: 'Rep Two', to_name: 'Rep Three' } },
    } });
    // each log insert went through the same transaction as the change it records — never outside one
    const tx = (status: string) => records.writes.find((w) => w.status === status)!.tx;
    for (const w of records.writes) expect(w.tx).not.toBeNull();
    expect(records.writes.filter((w) => w.tx === tx('message_posted')).map((w) => w.kind)).toEqual(['opportunity_collab', LOG]);
    expect(records.writes.filter((w) => w.tx === tx('meta_changed')).map((w) => w.kind)).toEqual(['opportunity_meta', LOG]);
    expect(tx('request_approved')).toBe(tx('owner_changed'));
    // the entry the API returns (camelCased by the interceptor)
    const page = await collab.logs({ page: 1, limit: 1 } as never);
    expect(page).toEqual({ meta: { page: 1, limit: 1, total: 5 }, data: [{
      id: logs[4].id, event: 'owner_changed', opportunity_id: PC, opportunity_name: 'ร้านที่แปลงแล้ว', account_id: 'acc-c',
      account_name: 'ร้านที่แปลงแล้ว (TMP)', actor_id: 'rep-3', actor_name: 'Rep Three', target_user_id: 'rep-3', target_user_name: 'Rep Three',
      request_id: created.requests[0].id, request_kind: 'handoff', note: null,
      changes: { owner: { from: 'rep-2', to: 'rep-3', from_name: 'Rep Two', to_name: 'Rep Three' } }, created_at: expect.any(String),
    }] });
  });

  it('a change that rolls back leaves no log row', async () => {
    const { collab, records } = setup();
    records.failCommit = true;
    await expect(collab.postMessage(REP, P1, { recipient_id: 'rep-2', text: 'x' })).rejects.toThrow('commit failed');
    await expect(collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-2', reason: 'x' })).rejects.toThrow('commit failed');
    await expect(collab.updateMeta(REP, P1, { stage: 'contacted' })).rejects.toThrow('commit failed');
    expect(records.saves).toBeGreaterThan(0);
    expect(records.rows).toEqual([]);
    records.failCommit = false;
    await collab.postMessage(REP, P1, { recipient_id: 'rep-2', text: 'x' });
    expect(records.kind(LOG)).toHaveLength(1);
  });

  it('log filters: opportunity / actor / target / user / events / Bangkok-day range, newest first, paged with total', async () => {
    const { collab, records } = setup();
    records.clock = at('2026-10-07T16:59:59.000Z'); // 7 Oct 23:59:59 Bangkok
    await collab.postMessage(REP, P1, { recipient_id: 'rep-2', text: 'm1' });
    records.clock = at('2026-10-07T17:00:00.000Z'); // 8 Oct 00:00 Bangkok
    const { requests } = await collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'rep-3', reason: 'r1' });
    records.clock = at('2026-10-08T16:59:59.999Z'); // 8 Oct 23:59:59.999 Bangkok
    await collab.postMessage(OTHER, PC, { recipient_id: 'rep-1', text: 'm2' });
    records.clock = at('2026-10-08T17:00:00.000Z'); // 9 Oct 00:00 Bangkok
    await collab.resolveRequest(MGR, P1, requests[0].id, { status: 'approved', note: 'ok' });
    const events = async (q: Row) => (await collab.logs({ page: 1, limit: 50, ...q } as never)).data.map((e) => `${e.event}:${e.note ?? ''}`);

    expect(await events({})).toEqual(['owner_changed:', 'request_approved:ok', 'message_posted:m2', 'request_created:r1', 'message_posted:m1']);
    expect(await events({ opportunity_id: PC })).toEqual(['message_posted:m2']);
    expect(await events({ actor_id: 'rep-1' })).toEqual(['request_created:r1', 'message_posted:m1']);
    expect(await events({ target_user_id: 'rep-3' })).toEqual(['owner_changed:', 'request_approved:ok', 'request_created:r1']);
    expect(await events({ user_id: 'rep-2' })).toEqual(['message_posted:m2', 'message_posted:m1']);
    expect(await events({ event: ['message_posted', 'owner_changed'] })).toEqual(['owner_changed:', 'message_posted:m2', 'message_posted:m1']);
    // a day is a Bangkok day: 8 Oct = [7 Oct 17:00Z, 8 Oct 17:00Z)
    expect(await events({ from: '2026-10-08', to: '2026-10-08' })).toEqual(['message_posted:m2', 'request_created:r1']);
    expect(await events({ to: '2026-10-07' })).toEqual(['message_posted:m1']);
    expect(await events({ from: '2026-10-09' })).toEqual(['owner_changed:', 'request_approved:ok']);
    // ISO instants are exact (inclusive)
    expect(await events({ from: '2026-10-07T17:00:00Z', to: '2026-10-08T16:59:59.999Z' })).toEqual(['message_posted:m2', 'request_created:r1']);
    // paging + total
    const p2 = await collab.logs({ page: 2, limit: 2 } as never);
    expect(p2.meta).toEqual({ page: 2, limit: 2, total: 5 });
    expect(p2.data.map((e) => e.note)).toEqual(['m2', 'r1']);
    expect((await collab.logs({ page: 3, limit: 2, actor_id: 'mgr-1' } as never))).toEqual({ data: [], meta: { page: 3, limit: 2, total: 2 } });
    // the SQL the filters become
    await collab.logs({ page: 2, limit: 10, opportunity_id: P1, actor_id: 'rep-1', target_user_id: 'rep-2', user_id: 'rep-3', event: ['message_posted'], from: '2026-10-08', to: '2026-10-08T12:00:00+07:00' } as never);
    const q = records.queries.at(-1)!;
    expect(q.wheres).toEqual([
      'l.kind = :logKind',
      "l.payload->>'opportunity_id' = :logOpportunity",
      'l.sales_user_id = :logActor',
      "l.payload->>'target_user_id' = :logTarget",
      "(l.sales_user_id = :logUser OR l.payload->>'target_user_id' = :logUserText)",
      'l.status IN (:...logEvents)',
      'l.create_date >= :logFrom',
      'l.create_date <= :logUntil',
    ]);
    expect(q.params).toMatchObject({ logKind: LOG, logFrom: at('2026-10-07T17:00:00.000Z'), logUntil: at('2026-10-08T05:00:00.000Z'), logUser: 'rep-3', logUserText: 'rep-3' });
    expect(q.order).toEqual(['l.create_date DESC', "CAST(l.payload->>'seq' AS integer) DESC", 'l.id DESC']);
    expect([q.offset, q.limit]).toEqual([10, 10]);
  });

  it('log range errors are 400; one opportunity\'s log 404s for an unknown place', async () => {
    const { collab } = setup();
    await expect(collab.logs({ page: 1, limit: 50, from: '2026-10-09', to: '2026-10-08' } as never)).rejects.toThrow(BadRequestException);
    await expect(collab.logs({ page: 1, limit: 50, from: '2026-02-30' } as never)).rejects.toThrow(BadRequestException);
    await expect(collab.opportunityLogs('00000000-0000-4000-8000-000000000999', { page: 1, limit: 50 })).rejects.toThrow(NotFoundException);
    await collab.postMessage(REP, P1, { recipient_id: 'rep-2', text: 'x' });
    await collab.postMessage(REP, P2, { recipient_id: 'rep-2', text: 'y' });
    expect(await collab.opportunityLogs(P2, { page: 1, limit: 50 })).toMatchObject({ meta: { page: 1, limit: 50, total: 1 }, data: [{ opportunity_id: P2, note: 'y' }] });
  });

  it('the roster is not capped at 100: recipient #150 is accepted and named; an admin resolver is named', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `u-${String(i + 1).padStart(3, '0')}`, name: `User ${i + 1}`, role: 'sale' }));
    const { collab, leads, records } = setup([...many, { id: 'rep-1', name: 'Rep One', role: 'sale' }, { id: 'adm-1', name: 'Admin One', role: 'admin' }]);
    const state = await collab.createRequest(REP, P1, { kind: 'handoff', recipient_id: 'u-150', reason: 'x' });
    expect(state.requests[0]).toMatchObject({ recipient_id: 'u-150', recipient_name: 'User 150' });
    await expect(collab.postMessage(REP, P1, { recipient_id: 'u-150', text: 'hi' })).resolves.toMatchObject({ messages: [{ recipient_name: 'User 150' }] });
    expect((await collab.directory())).toHaveLength(151);
    const out = await collab.resolveRequest(ADMIN, P1, state.requests[0].id, { status: 'approved', note: 'ok' });
    expect(out).toMatchObject({ owner_sales_user_id: 'u-150', owner_name: 'User 150', requests: [{ resolved_by_id: 'adm-1', resolved_by_name: 'Admin One' }] });
    expect(records.kind(LOG).at(-1)).toMatchObject({ status: 'owner_changed', payload: { actor_name: 'Admin One', target_user_name: 'User 150' } });
    expect(leads.listSalesUsers).not.toHaveBeenCalled();
    expect(leads.listStaffNames).toHaveBeenCalledWith(WINBACK_NAMED_ROLES);
  });

  it('LeadService.listStaffNames: no row cap, internal staff of the given roles, name falls back to email', async () => {
    const calls: Array<[string, unknown[]]> = [];
    const qb: Row = new Proxy({}, {
      get: (_t, key: string) => key === 'getMany'
        ? async () => [{ id: 'a', email: 'a@x', first_name: 'Ann', last_name: 'B', role: 'admin' }, { id: 'b', email: 'b@x', first_name: null, last_name: null, role: 'sale' }]
        : (...args: unknown[]) => { calls.push([key, args]); return qb; },
    });
    const users = { createQueryBuilder: jest.fn(() => qb) };
    const service = new LeadService({} as never, {} as never, users as never, {} as never, {} as never, {} as never);
    expect(await service.listStaffNames(WINBACK_NAMED_ROLES)).toEqual([{ id: 'a', name: 'Ann B', role: 'admin' }, { id: 'b', name: 'b@x', role: 'sale' }]);
    const names = calls.map(([k]) => k);
    for (const cap of ['take', 'limit', 'skip', 'offset']) expect(names).not.toContain(cap);
    expect(calls.find(([k, a]) => (k === 'where' || k === 'andWhere') && String(a[0]).includes('u.role IN'))![1][1]).toEqual({ roles: [...WINBACK_NAMED_ROLES] });
    expect(await service.listStaffNames([])).toEqual([]);
  });
});
