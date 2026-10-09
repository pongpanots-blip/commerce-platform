import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AppRecordsService, WinbackActor } from './app-records.service';
import { SignalService } from './signal.service';
import { OpportunityService } from './opportunity.service';
import { CommercialService } from './commercial.service';
import { WinbackHealth, WinbackStage } from './winback.enums';

/** Minimal in-memory TypeORM repository: find / findOne / create / save / delete with plain, In and Like where. */
class FakeRepo<T extends { id?: string }> {
  rows: T[] = [];
  private seq = 0;
  constructor(seed: T[] = []) {
    this.rows = seed.map((r) => ({ ...r }));
  }
  private matchValue(actual: unknown, expected: unknown): boolean {
    if (expected instanceof FindOperator) {
      // the raw fields: `value` unwraps a nested operator (Not(IsNull()))
      const op = expected as unknown as { _type: string; _value: unknown };
      if (op._type === 'in') return (op._value as unknown[]).includes(actual);
      if (op._type === 'like') return typeof actual === 'string' && actual.startsWith(String(op._value).replace(/%$/, ''));
      if (op._type === 'not') return !this.matchValue(actual, op._value);
      if (op._type === 'isNull') return actual === null || actual === undefined;
      throw new Error(`FakeRepo: unsupported operator ${op._type}`);
    }
    return actual === expected;
  }
  private match(row: T, where: unknown): boolean {
    if (!where) return true;
    if (Array.isArray(where)) return where.some((w) => this.match(row, w));
    return Object.entries(where as object).every(([k, v]) => this.matchValue((row as Record<string, unknown>)[k], v));
  }
  find = jest.fn(async (opts: { where?: unknown; take?: number } = {}) =>
    this.rows.filter((r) => this.match(r, opts.where)).slice(0, opts.take ?? Infinity).map((r) => ({ ...r })));
  findOne = jest.fn(async (opts: { where?: unknown }) => {
    const row = this.rows.find((r) => this.match(r, opts.where));
    return row ? { ...row } : null;
  });
  /**
   * Query builder for the `alias.col` / `alias.payload->>'key'` comparisons and orders the services use;
   * filters and orders run before `limit`, like SQL. Every call is recorded in `calls` for order checks.
   */
  calls: string[] = [];
  createQueryBuilder = jest.fn(() => {
    const ref = /^\w+\.(\w+)(?:->>'(\w+)')?$/;
    const read = (row: T, col: string, key?: string) => {
      const v = (row as Record<string, unknown>)[col];
      return key ? (v as Record<string, unknown> | null)?.[key] ?? null : v;
    };
    const filters: ((row: T) => boolean)[] = [];
    const orders: { col: string; key?: string; dir: number; nullsLast: boolean }[] = [];
    let max = Infinity;
    const cond = (sql: string, params: Record<string, unknown> = {}) => {
      this.calls.push(`where ${sql}`);
      const m = /^(\w+\.\w+(?:->>'\w+')?)\s*(=|>=|<=)\s*:(\w+)$/.exec(sql);
      if (!m) throw new Error(`FakeRepo qb: unsupported condition ${sql}`);
      const [, col, key] = ref.exec(m[1])!;
      const want = params[m[3]];
      filters.push((row) => {
        const v = read(row, col, key);
        if (v === null || v === undefined) return false;
        return m[2] === '=' ? v === want : m[2] === '>=' ? String(v) >= String(want) : String(v) <= String(want);
      });
      return qb;
    };
    const order = (sql: string, dir: 'ASC' | 'DESC' = 'ASC', nulls?: string) => {
      this.calls.push(`order ${sql}`);
      const [, col, key] = ref.exec(sql)!;
      orders.push({ col, key, dir: dir === 'DESC' ? -1 : 1, nullsLast: nulls ? nulls === 'NULLS LAST' : dir === 'ASC' });
      return qb;
    };
    const cmp = (a: T, b: T) => {
      for (const o of orders) {
        const x = read(a, o.col, o.key);
        const y = read(b, o.col, o.key);
        if (x === y) continue;
        if (x === null || x === undefined) return o.nullsLast ? 1 : -1;
        if (y === null || y === undefined) return o.nullsLast ? -1 : 1;
        const xs = x instanceof Date ? x.getTime() : x;
        const ys = y instanceof Date ? y.getTime() : y;
        return (xs < ys ? -1 : xs > ys ? 1 : 0) * o.dir;
      }
      return 0;
    };
    const qb = {
      where: cond,
      andWhere: cond,
      orderBy: order,
      addOrderBy: order,
      limit: (n: number) => { this.calls.push('limit'); max = n; return qb; },
      getMany: async () => this.rows.filter((r) => filters.every((f) => f(r))).sort(cmp).slice(0, max).map((r) => ({ ...r })),
    };
    return qb;
  });
  create = jest.fn((v: Partial<T>) => ({ ...v }) as T);
  save = jest.fn(async (v: T) => {
    const now = new Date();
    const row = { ...v } as Record<string, unknown>;
    if (!row.id) row.id = `id-${++this.seq}`;
    row.create_date = row.create_date ?? now;
    row.update_date = now;
    const i = this.rows.findIndex((r) => r.id === row.id);
    if (i >= 0) this.rows[i] = row as T;
    else this.rows.push(row as T);
    return { ...row } as T;
  });
  delete = jest.fn(async (where: unknown) => {
    this.rows = this.rows.filter((r) => !this.match(r, where));
    return { affected: 1 };
  });
}

const MGR: WinbackActor = { id: 'mgr-1', isManager: true };
const REP: WinbackActor = { id: 'rep-1', isManager: false };
const OTHER: WinbackActor = { id: 'rep-2', isManager: false };

function account(over: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    customer_code: 'GNA1',
    display_name: 'ร้าน A',
    health: WinbackHealth.DORMANT,
    stage: WinbackStage.INACTIVE_POOL,
    last_order_at: new Date('2026-03-01T00:00:00Z'),
    inactive_days: 200,
    avg_monthly_revenue: 100000,
    delay_ratio: 5,
    median_reorder_interval_days: 20,
    order_count_365d: 4,
    phone: '0812345678',
    assigned_sales_user_id: 'rep-1',
    created_by_sales_user_id: null,
    restaurant_place_id: null,
    ...over,
  };
}

function setup() {
  const records = new FakeRepo<Record<string, any>>();
  const accounts = new FakeRepo<Record<string, any>>([account(), account({ id: 'acc-2', assigned_sales_user_id: 'rep-2', customer_code: 'GNA2' })]);
  const activities = new FakeRepo<Record<string, any>>([
    { id: 'act-1', account_id: 'acc-1', sales_user_id: 'rep-1', status: 'planned', scheduled_at: new Date('2026-10-10T03:00:00Z'), checkin_at: null },
    { id: 'act-2', account_id: 'acc-1', sales_user_id: 'rep-1', status: 'in_progress', scheduled_at: null, checkin_at: new Date() },
  ]);
  const leads = {
    listSalesUsers: jest.fn(async () => [
      { id: 'rep-1', email: 'r1@x', name: 'Rep One', role: 'sale' },
      { id: 'rep-2', email: 'r2@x', name: 'Rep Two', role: 'sale' },
    ]),
    createTmpFromRestaurantPlace: jest.fn(),
  };
  const store = new AppRecordsService(records as never, accounts as never, activities as never, leads as never);
  return { records, accounts, activities, leads, store };
}

describe('AppRecordsService', () => {
  it('drafts are per user + key', async () => {
    const { store } = setup();
    await store.saveDraft(REP, 'acc-1', { type: 'call', account_id: 'acc-1', note: 'n' } as never);
    expect(await store.getDraft(REP, 'acc-1')).toMatchObject({ key: 'acc-1', type: 'call', note: 'n', account_id: 'acc-1' });
    expect(await store.getDraft(OTHER, 'acc-1')).toBeNull();
    await store.saveDraft(REP, 'acc-1', { type: 'line' } as never);
    expect(await store.getDraft(REP, 'acc-1')).toMatchObject({ type: 'line', version: 2 });
    expect(await store.deleteDraft(REP, 'acc-1')).toEqual({ deleted: true });
    expect(await store.getDraft(REP, 'acc-1')).toBeNull();
  });

  it('coaching: manager creates, rep sees own and closes with a result, cannot rewrite the task', async () => {
    const { store } = setup();
    await expect(store.createCoachingTask(REP, {} as never)).rejects.toThrow(ForbiddenException);
    const task = await store.createCoachingTask(MGR, {
      sales_user_id: 'rep-1', account_id: 'acc-1', action: ' ติดตามราคา ', due_at: '2026-10-10', manager_note: 'm',
    });
    expect(task).toMatchObject({ action: 'ติดตามราคา', account_name: 'ร้าน A', status: 'open', is_done: false });
    expect(await store.listCoachingTasks(REP, { sales_user_id: 'rep-2' })).toHaveLength(1); // forced to self
    expect(await store.listCoachingTasks(OTHER, {})).toHaveLength(0);
    await expect(store.updateCoachingTask(OTHER, String(task.id), { result: 'x' })).rejects.toThrow(ForbiddenException);
    await expect(store.updateCoachingTask(REP, String(task.id), { action: 'y' })).rejects.toThrow(ForbiddenException);
    await expect(store.updateCoachingTask(REP, String(task.id), { completed_at: '2026-10-09T00:00:00Z' })).rejects.toThrow(BadRequestException);
    const done = await store.updateCoachingTask(REP, String(task.id), { completed_at: '2026-10-09T00:00:00Z', result: 'ok' });
    expect(done).toMatchObject({ status: 'done', is_done: true, result: 'ok' });
    const reopened = await store.updateCoachingTask(MGR, String(task.id), { completed_at: null });
    expect(reopened).toMatchObject({ status: 'open', is_done: false });
  });

  it('coaching: over 500 tasks keeps the earliest due (ordered before the cap)', async () => {
    const { store, records } = setup();
    // 600 tasks inserted latest-due first, so an unordered take(500) would drop the earliest
    for (let i = 599; i >= 0; i--) {
      const due = new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString();
      records.rows.push({ id: `ct-${i}`, kind: 'coaching_task', sales_user_id: 'rep-1', account_id: 'acc-1', status: 'open', version: 1, payload: { due_at: due }, create_date: new Date(), update_date: new Date() });
    }
    const tasks = await store.listCoachingTasks(REP, {});
    expect(tasks).toHaveLength(500);
    expect(tasks[0]).toMatchObject({ id: 'ct-0', due_at: '2026-01-01T00:00:00.000Z' });
    expect(tasks[499]).toMatchObject({ id: 'ct-499' });
    expect(records.calls.slice(-4)).toEqual(["order r.payload->>'due_at'", 'order r.create_date', 'order r.id', 'limit']);
  });

  it('teams: manager only, members must be reps', async () => {
    const { store } = setup();
    await expect(store.saveTeam(REP, null, { name: 'T', sales_user_ids: [] })).rejects.toThrow(ForbiddenException);
    await expect(store.saveTeam(MGR, null, { name: 'T', sales_user_ids: ['ghost'] })).rejects.toThrow(BadRequestException);
    const team = await store.saveTeam(MGR, null, { name: ' Team North ', sales_user_ids: ['rep-1'] });
    expect(team).toMatchObject({ name: 'Team North', sales_user_ids: ['rep-1'] });
    await store.saveTeam(MGR, String(team.id), { name: 'Team N', sales_user_ids: ['rep-1', 'rep-2'] });
    expect(await store.listTeams()).toEqual([expect.objectContaining({ name: 'Team N', sales_user_ids: ['rep-1', 'rep-2'] })]);
    await store.deleteTeam(MGR, String(team.id));
    expect(await store.listTeams()).toEqual([]);
  });

  it('work plan: defaults, partial update, readiness needs every step', async () => {
    const { store } = setup();
    expect(await store.getWorkPlan('acc-1')).toMatchObject({ next_action: 'prepare_visit', completed: [], preparation_complete: false });
    await expect(store.saveWorkPlan(REP, 'acc-1', { preparation_complete: true })).rejects.toThrow(BadRequestException);
    await store.saveWorkPlan(REP, 'acc-1', { completed: ['contact', 'objective', 'materials', 'follow_up'], preparation_complete: true, blocker: ' รอราคา ' });
    expect(await store.getWorkPlan('acc-1')).toMatchObject({ preparation_complete: true, blocker: 'รอราคา' });
    const unticked = await store.saveWorkPlan(REP, 'acc-1', { completed: ['contact'] });
    expect(unticked).toMatchObject({ preparation_complete: false, blocker: 'รอราคา' });
    await expect(store.saveWorkPlan(REP, 'nope', {})).rejects.toThrow(NotFoundException);
    expect((await store.listWorkPlans(['acc-1', 'acc-2'])).map((p) => p.completed)).toEqual([['contact'], []]);
  });

  it('saved places are a per-user set; discovery query validates origin/radius', async () => {
    const { store } = setup();
    expect(await store.setSavedPlace(REP, 'p1', true)).toEqual(['p1']);
    expect(await store.setSavedPlace(REP, 'p1', true)).toEqual(['p1']);
    expect(await store.setSavedPlace(OTHER, 'p2', true)).toEqual(['p2']);
    expect(await store.setSavedPlace(REP, 'p1', false)).toEqual([]);
    await expect(store.saveDiscoveryQuery(REP, { radius_km: 5 })).rejects.toThrow(BadRequestException);
    await expect(store.saveDiscoveryQuery(REP, { origin_lat: 0, origin_lng: 0 })).rejects.toThrow(BadRequestException);
    await expect(store.saveDiscoveryQuery(REP, { origin_lat: 13.7 })).rejects.toThrow(BadRequestException);
    await store.saveDiscoveryQuery(REP, { province_code: 10, radius_km: 5, origin_lat: 13.7, origin_lng: 100.5 });
    expect(await store.getDiscoveryQuery(REP)).toMatchObject({ province_code: 10, radius_km: 5 });
    expect(await store.getDiscoveryQuery(OTHER)).toMatchObject({ province_code: null, radius_km: null });
  });

  it('appointment plan: writer, end time, prepared ⊂ products, no duplicate product+unit', async () => {
    const { store } = setup();
    const base = { place_code: 'storefront', purpose_code: 'quote', objective: 'o' };
    const p = { product_id: 'x', sku: 'S', name: 'n', unit_id: 'selling', unit_label: 'KG', quantity: 1 };
    await expect(store.saveAppointmentPlan(OTHER, 'act-1', base as never)).rejects.toThrow(ForbiddenException);
    await expect(store.saveAppointmentPlan(REP, 'act-1', { ...base, end_at: '2026-10-10T02:00:00Z' } as never)).rejects.toThrow(BadRequestException);
    await expect(store.saveAppointmentPlan(REP, 'act-1', { ...base, products: [p, p] } as never)).rejects.toThrow(BadRequestException);
    await expect(store.saveAppointmentPlan(REP, 'act-1', { ...base, products: [p], prepared_product_ids: ['y'] } as never)).rejects.toThrow(BadRequestException);
    const plan = await store.saveAppointmentPlan(MGR, 'act-1', { ...base, products: [p], prepared_product_ids: ['x'], end_at: '2026-10-10T04:00:00Z', documents_prepared: true } as never);
    expect(plan).toMatchObject({ activity_id: 'act-1', account_id: 'acc-1', end_at: '2026-10-10T04:00:00Z', documents_prepared: true });
    expect(await store.getAppointmentPlan('act-1')).toMatchObject({ objective: 'o' });
    expect(await store.getAppointmentPlan('act-9')).toBeNull();
  });

  it('visit completion: next step pair, quote must be the account, writes the work plan', async () => {
    const { store, records } = setup();
    await expect(store.saveVisitCompletion(REP, 'act-2', { products: [], next_action: 'follow_up' } as never)).rejects.toThrow(BadRequestException);
    records.rows.push({ id: 'q-other', kind: 'quote', account_id: 'acc-2' });
    await expect(store.saveVisitCompletion(REP, 'act-2', { products: [], quote_id: 'q-other' } as never)).rejects.toThrow(BadRequestException);
    const saved = await store.saveVisitCompletion(REP, 'act-2', { products: [], next_action: 'new_appointment', follow_up_at: '2026-10-12T03:00:00Z' } as never);
    expect(saved).toMatchObject({ activity_id: 'act-2', next_action: 'new_appointment' });
    expect(await store.getWorkPlan('acc-1')).toMatchObject({ next_action: 'new_appointment', due_at: '2026-10-12T03:00:00Z' });
  });

  it('start evidence needs a check-in', async () => {
    const { store } = setup();
    await expect(store.saveStartEvidence(REP, 'act-1', { photo_urls: ['u'] })).rejects.toThrow('check-in');
    expect(await store.saveStartEvidence(REP, 'act-2', { photo_urls: ['u'] })).toMatchObject({ photo_urls: ['u'] });
  });

  it('joint visit: manager, roster participant (not self), planned activity only', async () => {
    const { store } = setup();
    await expect(store.saveJointVisit(REP, 'act-1', { participant_id: 'rep-2', note: 'n' })).rejects.toThrow(ForbiddenException);
    await expect(store.saveJointVisit(MGR, 'act-1', { participant_id: 'mgr-1', note: 'n' })).rejects.toThrow(BadRequestException);
    await expect(store.saveJointVisit(MGR, 'act-1', { participant_id: 'ghost', note: 'n' })).rejects.toThrow(BadRequestException);
    await expect(store.saveJointVisit(MGR, 'act-2', { participant_id: 'rep-2', note: 'n' })).rejects.toThrow(BadRequestException);
    const jv = await store.saveJointVisit(MGR, 'act-1', { participant_id: 'rep-2', note: ' ไปด้วย ' });
    expect(jv).toMatchObject({ organizer_id: 'mgr-1', participant_name: 'Rep Two', note: 'ไปด้วย', current_activity_status: 'planned' });
    expect(await store.listJointVisits('acc-1')).toEqual([expect.objectContaining({ activity_id: 'act-1', current_activity_status: 'planned' })]);
  });

  it('sync runs: recorded with counts, newest first', async () => {
    const { store } = setup();
    const run = await store.recordSyncRun(MGR, 30, { created: 2, updated: 5, reactivated: 1, scanned: 99 }, new Date());
    expect(run).toMatchObject({ source_id: 'josh_dormant', days: 30, created: 2, updated: 5, reactivated: 1, skipped: null, status: 'done' });
    expect(await store.listSyncRuns(20)).toHaveLength(1);
  });
});

describe('SignalService', () => {
  function signals() {
    const { records, accounts } = setup();
    return { svc: new SignalService(accounts as never, records as never), records, accounts };
  }

  it('lists only accounts with order history, scoped to the rep (sales_user_id ignored for a sale)', async () => {
    const { svc, accounts } = signals();
    accounts.rows.push(account({ id: 'acc-new', last_order_at: null, assigned_sales_user_id: 'rep-1' }));
    const list = await svc.list(REP, { sales_user_id: 'rep-2', limit: 15 });
    expect(list.map((s) => s.id)).toEqual(['acc-1']);
    expect(list[0]).toMatchObject({ signal_type: 'reactivate', status: 'open' });
    expect((await svc.list(MGR, { limit: 15 })).map((s) => s.id).sort()).toEqual(['acc-1', 'acc-2']);
    expect((await svc.list(MGR, { sales_user_id: 'rep-2', limit: 15 })).map((s) => s.id)).toEqual(['acc-2']);
  });

  it('actions: 403 on another rep, 404 without a signal, snooze must be in the future, status filter', async () => {
    const { svc, accounts } = signals();
    await expect(svc.complete(REP, 'acc-2', { outcome: 'follow_up' })).rejects.toThrow(ForbiddenException);
    await expect(svc.complete(REP, 'nope', { outcome: 'follow_up' })).rejects.toThrow(NotFoundException);
    accounts.rows.push(account({ id: 'acc-active', health: WinbackHealth.ACTIVE_AGAIN }));
    await expect(svc.dismiss(MGR, 'acc-active', { reason: 'x' })).rejects.toThrow(NotFoundException);
    await expect(svc.snooze(REP, 'acc-1', { until: '2020-01-01' })).rejects.toThrow(BadRequestException);
    expect(await svc.complete(REP, 'acc-1', { outcome: 'follow_up', note: ' ok ' })).toMatchObject({ status: 'completed', note: 'ok' });
    expect(await svc.list(REP, { status: 'open', limit: 15 })).toEqual([]);
    expect((await svc.list(REP, { status: 'completed', limit: 15 })).map((s) => s.id)).toEqual(['acc-1']);
    expect(await svc.dismiss(MGR, 'acc-2', { reason: ' ปิดกิจการ ' })).toMatchObject({ status: 'dismissed', reason: 'ปิดกิจการ' });
  });

  it('revenue context: 404 unknown account, {} without orders', async () => {
    const { svc, accounts } = signals();
    await expect(svc.revenueContext('nope')).rejects.toThrow(NotFoundException);
    accounts.rows.push(account({ id: 'acc-new', last_order_at: null }));
    expect(await svc.revenueContext('acc-new')).toEqual({});
    expect(await svc.revenueContext('acc-1')).toMatchObject({ customer_state: 'dormant', revenue_at_risk: 100000 });
  });
});

describe('OpportunityService.convert', () => {
  it('is idempotent and survives a double tap', async () => {
    const { accounts, leads, records } = setup();
    const svc = new OpportunityService({} as never, accounts as never, leads as never, records as never);
    // This spec exercises idempotency; joined-row visibility is covered in opportunity-collab.service.spec.
    jest.spyOn(svc, 'placeRow').mockImplementation(async (id) => ({
      id, name_th: null, name_en: null, district: null, raw_category: null, rating: null,
      review_count: null, price_range: null, enriched_at: null,
    }));
    leads.createTmpFromRestaurantPlace.mockResolvedValueOnce({ id: 'acc-new', customer_code: 'TMP-1', stage: 'prospect', lifecycle: 'tmp' });
    expect(await svc.convert(REP, 'p1')).toEqual({ opportunity_id: 'p1', winback_account_id: 'acc-new', customer_code: 'TMP-1', stage: 'prospect', lifecycle: 'tmp' });
    accounts.rows.push(account({ id: 'acc-p2', restaurant_place_id: 'p2', stage: 'prospect' }));
    expect(await svc.convert(REP, 'p2')).toMatchObject({ winback_account_id: 'acc-p2' });
    leads.createTmpFromRestaurantPlace.mockImplementationOnce(async () => {
      accounts.rows.push(account({ id: 'acc-p3', restaurant_place_id: 'p3' }));
      throw new ConflictException('มี tmp lead จากร้านนี้แล้ว');
    });
    expect(await svc.convert(REP, 'p3')).toMatchObject({ winback_account_id: 'acc-p3' });
    leads.createTmpFromRestaurantPlace.mockRejectedValueOnce(new NotFoundException('ไม่พบร้านใน Market Explorer'));
    await expect(svc.convert(REP, 'p4')).rejects.toThrow('Opportunity not found');
  });
});

describe('CommercialService', () => {
  function commercial() {
    const ctx = setup();
    const catalog = {
      listProducts: jest.fn(async () => [
        { id: 'prod-1', sku: 'RIB20', name: 'ริบอาย', units: [{ id: 'selling', label: 'KG', unit_price: 912.5 }] },
        { id: 'prod-2', sku: 'NOPRICE', name: 'x', units: [{ id: 'selling', label: 'KG', unit_price: null }] },
      ]),
    };
    const erpQb = {
      innerJoin: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(), addGroupBy: jest.fn().mockReturnThis(), having: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () => [
        { account_id: 'acc-1', account_name: 'ร้าน A', customer_code: 'GNA1', sales_user_id: 'rep-1', inv_date: '2026-03-01', amount: '1500.0000' },
      ]),
    };
    const erp = { createQueryBuilder: jest.fn(() => erpQb) };
    const svc = new CommercialService(ctx.records as never, ctx.accounts as never, erp as never, catalog as never, ctx.store);
    return { ...ctx, svc, catalog, erpQb };
  }
  const line = { product_id: 'prod-1', unit_id: 'selling', quantity: 2 };

  it('prices lines from the catalog and rejects unknown / unpriced products', async () => {
    const { svc } = commercial();
    const q = await svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [line], valid_until: '2099-01-01' });
    expect(q).toMatchObject({ status: 'draft', status_at: 'draft', version: 1, content_version: 1, sales_user_id: 'rep-1', account_name: 'ร้าน A' });
    expect(q.lines).toEqual([{ product_id: 'prod-1', product_name: 'ริบอาย', sku: 'RIB20', unit_id: 'selling', unit_label: 'KG', unit_price: 912.5, quantity: 2 }]);
    await expect(svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [{ ...line, product_id: 'ghost' }], valid_until: '2099-01-01' })).rejects.toThrow(BadRequestException);
    await expect(svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [{ ...line, product_id: 'prod-2' }], valid_until: '2099-01-01' })).rejects.toThrow('ราคา');
    await expect(svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [{ ...line, unit_id: 'box' }], valid_until: '2099-01-01' })).rejects.toThrow(BadRequestException);
    await expect(svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [line], valid_until: '2020-01-01' })).rejects.toThrow(BadRequestException);
    await expect(svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [], valid_until: '2099-01-01' })).rejects.toThrow(BadRequestException);
  });

  it('review flow, optimistic version, owner scoping, revision keeps history', async () => {
    const { svc } = commercial();
    const q = await svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [line], valid_until: '2099-01-01' });
    const id = String(q.id);
    await expect(svc.getQuote(OTHER, id)).rejects.toThrow(ForbiddenException);
    expect(await svc.listQuotes(OTHER, {})).toEqual([]);
    expect(await svc.listQuotes(MGR, { sales_user_id: 'rep-1' })).toHaveLength(1);
    await expect(svc.moveQuote(REP, id, { status: 'in_review', expected_version: 9 })).rejects.toThrow(ConflictException);
    await svc.moveQuote(REP, id, { status: 'in_review', expected_version: 1 });
    await expect(svc.moveQuote(REP, id, { status: 'follow_up', expected_version: 2 })).rejects.toThrow(ForbiddenException);
    await expect(svc.moveQuote(MGR, id, { status: 'accepted', expected_version: 2 })).rejects.toThrow(BadRequestException);
    const approved = await svc.moveQuote(MGR, id, { status: 'follow_up', expected_version: 2 });
    expect(approved).toMatchObject({ status: 'follow_up', version: 3 });
    const fu = await svc.followUpQuote(REP, id, { at: '2099-01-01', note: ' โทรตาม ', expected_version: 3 });
    expect(fu).toMatchObject({ follow_up_at: '2099-01-01', version: 4 });
    await expect(svc.saveQuote(REP, id, { account_id: 'acc-2', lines: [line], valid_until: '2099-01-01', expected_version: 4 })).rejects.toThrow(BadRequestException);
    await expect(svc.saveQuote(REP, id, { account_id: 'acc-1', lines: [line], valid_until: '2099-01-01' })).rejects.toThrow('expected_version');
    const rev = await svc.saveQuote(REP, id, { account_id: 'acc-1', lines: [{ ...line, quantity: 5 }], valid_until: '2099-02-01', expected_version: 4 });
    expect(rev).toMatchObject({ status: 'draft', version: 5, content_version: 2, follow_up_at: '2099-01-01' });
    expect(rev.versions).toEqual([expect.objectContaining({ version: 4, content_version: 1 })]);
    expect((rev.events as unknown[]).length).toBe(5);
  });

  it('dispatch is record-only, needs an approved quote and is idempotent per content version', async () => {
    const { svc } = commercial();
    const q = await svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [line], valid_until: '2099-01-01' });
    const id = String(q.id);
    await expect(svc.recordDispatch(REP, id, { channel: 'line', content_version: 1, expected_version: 1 })).rejects.toThrow('follow_up');
    await svc.moveQuote(REP, id, { status: 'in_review', expected_version: 1 });
    await svc.moveQuote(MGR, id, { status: 'follow_up', expected_version: 2 });
    await expect(svc.recordDispatch(REP, id, { channel: 'line', content_version: 7, expected_version: 3 })).rejects.toThrow(ConflictException);
    const receipt = await svc.recordDispatch(REP, id, { channel: 'line', content_version: 1, expected_version: 3 });
    expect(receipt).toMatchObject({ quote_id: id, channel: 'line', content_version: 1, sent_by_system: false, status: 'recorded' });
    const again = await svc.recordDispatch(REP, id, { channel: 'email', content_version: 1, expected_version: 99 });
    expect(again.id).toBe(receipt.id);
    expect(await svc.listDispatches(REP, id)).toHaveLength(1);
  });

  it('terms catalog: empty until a manager sets it; quotes take only listed terms', async () => {
    const { svc } = commercial();
    expect(await svc.getTermsCatalog()).toMatchObject({ configured: false, credit_days: [], price_lists: [] });
    await expect(svc.saveTermsCatalog(REP, {} as never)).rejects.toThrow(ForbiddenException);
    const dup = { credit_days: [30], price_lists: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }], warehouses: [], delivery_slots: [] };
    await expect(svc.saveTermsCatalog(MGR, dup)).rejects.toThrow(BadRequestException);
    await svc.saveTermsCatalog(MGR, {
      credit_days: [30, 0, 30],
      price_lists: [{ id: 'std', label: 'Standard' }],
      warehouses: [{ id: 'wh1', label: 'คลัง 1' }],
      delivery_slots: [{ id: 'am', label: 'เช้า', weekdays: [3, 6], before_minutes: 600 }],
    });
    expect(await svc.getTermsCatalog()).toMatchObject({ configured: true, credit_days: [0, 30] });
    const terms = { credit_days: 30, price_list_id: 'std', warehouse_id: 'wh1', delivery_slot_id: 'am', delivery_location: ' หน้าร้าน ' };
    const q = await svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [line], valid_until: '2099-01-01', terms });
    expect(q.terms).toEqual({
      credit_days: 30, price_list_id: 'std', price_list_label: 'Standard', warehouse_id: 'wh1', warehouse_label: 'คลัง 1',
      delivery_slot_id: 'am', delivery_slot_label: 'เช้า', delivery_weekdays: [3, 6], delivery_before_minutes: 600, delivery_location: 'หน้าร้าน',
    });
    await expect(svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [line], valid_until: '2099-01-01', terms: { ...terms, credit_days: 45 } })).rejects.toThrow(BadRequestException);
    await expect(svc.saveQuote(REP, null, { account_id: 'acc-1', lines: [line], valid_until: '2099-01-01', terms: { ...terms, warehouse_id: 'x' } })).rejects.toThrow(BadRequestException);
  });

  it('daily report: own draft → submitted → reviewed by a manager, versions checked', async () => {
    const { svc } = commercial();
    expect(await svc.getReport(REP, 'rep-1', '2026-10-08')).toMatchObject({ id: null, status: 'draft', version: 1 });
    await expect(svc.getReport(REP, 'rep-2', '2026-10-08')).rejects.toThrow(ForbiddenException);
    await expect(svc.saveReport(MGR, 'rep-1', '2026-10-08', { note: 'n', next_plan: 'p', expected_version: 1 })).rejects.toThrow(ForbiddenException);
    await expect(svc.submitReport(REP, 'rep-1', '2026-10-08', { expected_version: 1 })).rejects.toThrow(BadRequestException);
    const saved = await svc.saveReport(REP, 'rep-1', '2026-10-08', { note: ' n ', next_plan: 'p', expected_version: 1 });
    expect(saved).toMatchObject({ status: 'draft', version: 2, note: 'n' });
    await expect(svc.saveReport(REP, 'rep-1', '2026-10-08', { note: 'n', next_plan: 'p', expected_version: 1 })).rejects.toThrow(ConflictException);
    await expect(svc.reviewReport(MGR, 'rep-1', '2026-10-08', { approved: true, expected_version: 2 })).rejects.toThrow('submitted');
    const submitted = await svc.submitReport(REP, 'rep-1', '2026-10-08', { expected_version: 2 });
    expect(submitted).toMatchObject({ status: 'submitted', version: 3 });
    await expect(svc.saveReport(REP, 'rep-1', '2026-10-08', { note: 'n', next_plan: 'p', expected_version: 3 })).rejects.toThrow(BadRequestException);
    await expect(svc.reviewReport(REP, 'rep-1', '2026-10-08', { approved: true, expected_version: 3 })).rejects.toThrow(ForbiddenException);
    await expect(svc.reviewReport(MGR, 'rep-1', '2026-10-08', { approved: false, expected_version: 3 })).rejects.toThrow('reason');
    const back = await svc.reviewReport(MGR, 'rep-1', '2026-10-08', { approved: false, reason: 'เพิ่มรายละเอียด', expected_version: 3 });
    expect(back).toMatchObject({ status: 'needs_revision', review_note: 'เพิ่มรายละเอียด', version: 4 });
    expect(await svc.listReports(REP, { sales_user_id: 'rep-2' })).toHaveLength(1); // forced to self
    expect(await svc.listReports(MGR, { status: 'approved' })).toHaveLength(0);
    expect(await svc.listReports(MGR, { from: '2026-10-09' })).toHaveLength(0);
  });

  it('daily reports: from/to filter before the 500 cap, newest day first', async () => {
    const { svc, records } = commercial();
    // 600 days of reports for rep-1, inserted oldest first (2025-01-01 onward)
    const start = Date.UTC(2025, 0, 1);
    for (let i = 0; i < 600; i++) {
      const day = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      records.rows.push({ id: `dr-${i}`, kind: 'daily_report', record_key: `rep-1|${day}`, sales_user_id: 'rep-1', status: 'submitted', version: 1, payload: { day }, create_date: new Date(start + i * 86_400_000), update_date: new Date() });
    }
    // The oldest week sits outside the newest 500 rows: it must still come back in full.
    const old = await svc.listReports(MGR, { sales_user_id: 'rep-1', from: '2025-01-01', to: '2025-01-07' });
    expect(old.map((r) => r.day)).toEqual(['2025-01-07', '2025-01-06', '2025-01-05', '2025-01-04', '2025-01-03', '2025-01-02', '2025-01-01']);
    const all = await svc.listReports(MGR, {});
    expect(all).toHaveLength(500);
    expect(all[0].day).toBe('2026-08-23'); // the newest 500 days when no range is sent
    expect(records.calls.indexOf('limit')).toBeGreaterThan(records.calls.lastIndexOf("where r.payload->>'day' <= :to"));
  });

  it('invoice evidence: one row per customer-day from the ERP history, scoped to the rep', async () => {
    const { svc, erpQb } = commercial();
    expect(await svc.invoiceEvidence(REP, { sales_user_id: 'rep-2', limit: 100 } as never)).toEqual([{
      id: 'GNA1:2026-03-01', account_id: 'acc-1', account_name: 'ร้าน A', sales_user_id: 'rep-1', issued_at: '2026-03-01',
      amount: 1500, label: 'ใบแจ้งหนี้ GNA1 2026-03-01', status: 'issued', is_synthetic: false,
    }]);
    expect(erpQb.andWhere).toHaveBeenCalledWith('a.assigned_sales_user_id = :uid', { uid: 'rep-1' });
    erpQb.andWhere.mockClear();
    await svc.invoiceEvidence(MGR, { limit: 100 } as never);
    expect(erpQb.andWhere).not.toHaveBeenCalled();
  });
});
