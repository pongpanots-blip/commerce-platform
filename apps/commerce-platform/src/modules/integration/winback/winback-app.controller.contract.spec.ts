/**
 * Contract of the app gap routes (WinbackAppController): the route table, role scoping, the
 * `{ data, meta }` camelCase envelope, and the ownership write guard. josh has the same spec
 * (only the guard wiring at the bottom differs) — the snapshots must stay identical on both sides.
 */
import 'reflect-metadata';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { WinbackAppController } from './winback-app.controller';
import { WinbackResponseInterceptor, wrapWinbackResponse } from './winback-response.interceptor';
import { AdminWriteGuard } from './shared/admin-write.guard';
import { WinbackModule } from './winback.module';
import { WinbackOwnershipGuard } from './winback-ownership.guard';
import { WinbackAppRoleGuard } from './winback-app-role.guard';
import { WinbackController } from './winback.controller';

const sale = { user: { sub: 'sales-1', role: 'sale' } } as any;
const manager = { user: { sub: 'mgr-1', role: 'manager' } } as any;
const UUID = '00000000-0000-4000-8000-000000000001';

function createController() {
  const opportunities = {
    list: jest.fn(), provinces: jest.fn(), convert: jest.fn(), filterMeta: jest.fn(), accountOpportunities: jest.fn(),
  };
  const signals = { list: jest.fn(), complete: jest.fn(), snooze: jest.fn(), dismiss: jest.fn(), revenueContext: jest.fn() };
  const catalog = { listProducts: jest.fn() };
  const records = new Proxy({} as Record<string, jest.Mock>, {
    get: (target, key: string) => (target[key] ??= jest.fn()),
  });
  const commercial = new Proxy({} as Record<string, jest.Mock>, {
    get: (target, key: string) => (target[key] ??= jest.fn()),
  });
  const collab = new Proxy({} as Record<string, jest.Mock>, {
    get: (target, key: string) => (target[key] ??= jest.fn()),
  });
  const controller = new WinbackAppController(
    opportunities as any,
    signals as any,
    catalog as any,
    records as any,
    commercial as any,
    collab as any,
  );
  return { controller, opportunities, signals, catalog, records, commercial, collab };
}

function routes() {
  const proto = WinbackAppController.prototype as unknown as Record<string, unknown>;
  const base = Reflect.getMetadata(PATH_METADATA, WinbackAppController);
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && Reflect.getMetadata(PATH_METADATA, proto[name] as object) !== undefined)
    .map((name) => {
      const handler = proto[name] as object;
      return `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)]} /${base}/${Reflect.getMetadata(PATH_METADATA, handler)} → ${name}`;
    });
}

describe('WinbackAppController contract', () => {
  it('route table', () => {
    expect(routes()).toMatchSnapshot();
  });

  it('runs behind AdminWriteGuard and the winback {data, meta} camelCase interceptor', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WinbackAppController)).toEqual(expect.arrayContaining([AdminWriteGuard]));
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, WinbackAppController)).toEqual(expect.arrayContaining([WinbackResponseInterceptor]));
  });

  describe('roles', () => {
    it.each([
      ['teams', (c: WinbackAppController) => c.teams(sale)],
      ['createTeam', (c: WinbackAppController) => c.createTeam(sale, { name: 'T', sales_user_ids: [] })],
      ['updateTeam', (c: WinbackAppController) => c.updateTeam(sale, UUID, { name: 'T', sales_user_ids: [] })],
      ['deleteTeam', (c: WinbackAppController) => c.deleteTeam(sale, UUID)],
      ['createCoachingTask', (c: WinbackAppController) => c.createCoachingTask(sale, {} as any)],
      ['saveJointVisit', (c: WinbackAppController) => c.saveJointVisit(sale, UUID, {} as any)],
      ['syncRuns', (c: WinbackAppController) => c.syncRuns(sale, { limit: 20 })],
      ['saveQuoteTerms', (c: WinbackAppController) => c.saveQuoteTerms(sale, {} as any)],
      ['reviewDailyReport', (c: WinbackAppController) => c.reviewDailyReport(sale, UUID, '2026-10-08', {} as any)],
      ['collaborationLogs', (c: WinbackAppController) => c.collaborationLogs(sale, { page: 1, limit: 50 } as any)],
      ['opportunityCollaborationLogs', (c: WinbackAppController) => c.opportunityCollaborationLogs(sale, UUID, { page: 1, limit: 50 } as any)],
    ])('%s is manager-only (403 for a sale)', (_name, call) => {
      const { controller } = createController();
      expect(() => call(controller)).toThrow(ForbiddenException);
    });

    it('passes the caller as actor: a sale is never a manager, a manager is', async () => {
      const { controller, signals, records, commercial } = createController();
      controller.listSignals(sale, { limit: 15, sales_user_id: UUID } as any);
      expect(signals.list).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, { limit: 15, sales_user_id: UUID });
      controller.coachingTasks(manager, {});
      expect(records.listCoachingTasks).toHaveBeenCalledWith({ id: 'mgr-1', isManager: true }, {});
      controller.invoices(sale, { limit: 100 } as any);
      expect(commercial.invoiceEvidence).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, { limit: 100 });
      controller.teams(manager);
      expect(records.listTeams).toHaveBeenCalled();
    });

    it('§4.11.8: list / filter-meta / meta and collaboration writes get the caller as actor', () => {
      const { controller, opportunities, collab } = createController();
      controller.listOpportunities(sale, { page: 1, limit: 20, owner_sales_user_id: UUID } as any);
      expect(opportunities.list).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, { page: 1, limit: 20, owner_sales_user_id: UUID });
      controller.opportunityFilterMeta(manager);
      expect(opportunities.filterMeta).toHaveBeenCalledWith({ id: 'mgr-1', isManager: true });
      controller.updateOpportunityMeta(sale, UUID, { stage: 'contacted', expected_version: 0 });
      expect(collab.updateMeta).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, UUID, { stage: 'contacted', expected_version: 0 });
      controller.createCollabRequest(sale, UUID, { kind: 'handoff', recipient_id: UUID, reason: 'r' });
      expect(collab.createRequest).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, UUID, { kind: 'handoff', recipient_id: UUID, reason: 'r' });
      controller.resolveCollabRequest(manager, UUID, UUID, { status: 'approved', note: 'ok' });
      expect(collab.resolveRequest).toHaveBeenCalledWith({ id: 'mgr-1', isManager: true }, UUID, UUID, { status: 'approved', note: 'ok' });
      controller.postCollabMessage(sale, UUID, { recipient_id: UUID, text: 't' });
      expect(collab.postMessage).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, UUID, { recipient_id: UUID, text: 't' });
      controller.collaborationDirectory();
      expect(collab.directory).toHaveBeenCalled();
    });

    it('§4.11.8 visibility: detail / meta / thread / convert / account opportunities get the caller (scoped in the service)', () => {
      const { controller, opportunities, collab } = createController();
      controller.opportunity(sale, UUID);
      expect(collab.detail).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, UUID);
      controller.opportunityMeta(sale, UUID);
      expect(collab.meta).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, UUID);
      controller.opportunityCollaboration(manager, UUID);
      expect(collab.collaboration).toHaveBeenCalledWith({ id: 'mgr-1', isManager: true }, UUID);
      controller.convertOpportunity(sale, UUID);
      expect(opportunities.convert).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, UUID);
      controller.accountOpportunities(sale, UUID);
      expect(opportunities.accountOpportunities).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, UUID);
    });

    it('a caller without a JWT sub reaches the service with an empty id (the service answers 403 on writes)', () => {
      const { controller, collab } = createController();
      const noSub = { user: { role: 'sale' } } as any;
      controller.postCollabMessage(noSub, UUID, { recipient_id: UUID, text: 't' });
      expect(collab.postMessage).toHaveBeenCalledWith({ id: '', isManager: false }, UUID, { recipient_id: UUID, text: 't' });
    });

    it('collaboration logs: 403 message for a sale, the query goes through for a manager', () => {
      const { controller, collab } = createController();
      expect(() => controller.collaborationLogs(sale, { page: 1, limit: 50 } as any)).toThrow('เฉพาะ manager ที่ดูบันทึกการประสานงานได้');
      expect(collab.logs).not.toHaveBeenCalled();
      expect(collab.opportunityLogs).not.toHaveBeenCalled();
      const q = { page: 2, limit: 10, opportunity_id: UUID, event: ['owner_changed'], from: '2026-10-08' };
      controller.collaborationLogs(manager, q as any);
      expect(collab.logs).toHaveBeenCalledWith(q);
      controller.opportunityCollaborationLogs(manager, UUID, { page: 1, limit: 50 } as any);
      expect(collab.opportunityLogs).toHaveBeenCalledWith(UUID, { page: 1, limit: 50 });
    });

    it('collaboration log routes are GETs that no other route shadows', () => {
      const r = routes();
      expect(r).toEqual(expect.arrayContaining([
        'GET /winback/collaboration/logs → collaborationLogs',
        'GET /winback/opportunities/:id/collaboration/logs → opportunityCollaborationLogs',
      ]));
      // same depth, same method, declared earlier would win — only the PATCH :requestId route is that deep
      expect(r.filter((x) => /^GET \/winback\/opportunities\/:id\/collaboration\/[^/]+ /.test(x))).toEqual([
        'GET /winback/opportunities/:id/collaboration/logs → opportunityCollaborationLogs',
      ]);
      expect(r.filter((x) => /^GET \/winback\/collaboration\/[^/]+ /.test(x))).toEqual([
        'GET /winback/collaboration/directory → collaborationDirectory',
        'GET /winback/collaboration/logs → collaborationLogs',
      ]);
    });

    it('filter-meta is declared before opportunities/:id (else ParseUUIDPipe would 400 it)', () => {
      const r = routes();
      expect(r.findIndex((x) => x.includes('opportunities/filter-meta'))).toBeLessThan(r.findIndex((x) => x.startsWith('GET /winback/opportunities/:id ')));
    });

    it('convert stamps the caller as the lead creator', () => {
      const { controller, opportunities } = createController();
      controller.convertOpportunity(sale, UUID);
      expect(opportunities.convert).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, UUID);
    });

    it('province counts receive the caller visibility scope', () => {
      const { controller, opportunities } = createController();
      controller.opportunityProvinces(sale, { search: 'Bangkok' });
      expect(opportunities.provinces).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, { search: 'Bangkok' });
    });

    it('rejects a malformed draft key and report day (400)', () => {
      const { controller } = createController();
      expect(() => controller.activityDraft(sale, '../x')).toThrow('draft key');
      expect(() => controller.dailyReport(sale, UUID, '08-10-2026')).toThrow('YYYY-MM-DD');
    });
  });

  describe('envelope (wrapWinbackResponse over the service result)', () => {
    it('opportunities list', async () => {
      const { controller, opportunities } = createController();
      opportunities.list.mockResolvedValue({
        items: [{
          id: UUID, name: 'ร้านวัฒนา', province_code: 'TH-10', province_name: 'กรุงเทพมหานคร', district: 'วัฒนา',
          restaurant_segment: 'japanese_premium', spend_min: 400, spend_max: 800, premium_fit_score: null,
          revenue_potential_score: null, delivery_efficiency_score: null, sales_priority_score: 81, road_distance_km: null,
          estimated_delivery_cost: null, delivery_cost_ratio: null, enrichment_status: 'enriched', converted_to_winback: false,
          winback_account_id: null, premium_signals: ['Google 4.6 (320 รีวิว)'], premium_fit_reasons: [], delivery_reasons: [],
          priority_reason: null,
        }],
        pagination: { page: 1, limit: 20, total: 1, capped: false, candidate_cap: 3000 },
        counts: { recommended: 1, near_warehouse: 0, needs_enrich: 3 },
      });
      expect(wrapWinbackResponse(await controller.listOpportunities(sale, { page: 1, limit: 20 } as any))).toMatchSnapshot();
    });

    it('opportunity meta + filter-meta + collaboration (§4.11.8)', async () => {
      const { controller, opportunities, collab } = createController();
      collab.meta.mockResolvedValue({
        opportunity_id: UUID, stage: 'prospect', purpose: 'new_product', owner_sales_user_id: null, owner_name: null,
        cuisine_id: null, district_code: null, source: 'derived', version: 0, updated_at: null,
        recommendation: {
          reason: 'needs_research', reason_detail: 'ข้อมูลร้านยังไม่ครบ (ยังไม่มีช่วงราคาต่อหัว)', suggestion: 'เก็บข้อมูลร้านก่อนประเมินการเสนอขาย',
          urgency: 'research', source: 'restaurant_place', source_date: '2026-09-01T00:00:00.000Z', historical_monthly_purchase_baht: null,
          purchase_evidence: null, proposal_monthly_estimate_baht: null, product_summary: null,
        },
      });
      opportunities.filterMeta.mockResolvedValue({
        stages: [{ value: 'prospect', count: 3 }], purposes: [{ value: 'new_product', count: 3 }],
        recommendation_reasons: [{ value: 'needs_research', count: 1 }], owners: [{ sales_user_id: 'sales-1', name: 'Rep One', count: 1 }],
        unassigned_count: 2, capped: false, candidate_cap: 3000,
      });
      collab.collaboration.mockResolvedValue({
        opportunity_id: UUID, owner_sales_user_id: 'sales-1', owner_name: 'Rep One', revision: 2,
        requests: [{
          id: UUID, kind: 'handoff', requester_id: 'sales-2', requester_name: 'Rep Two', recipient_id: 'sales-1', recipient_name: 'Rep One',
          reason: 'ช่วยดูแลต่อ', created_at: '2026-10-08T00:00:00.000Z', status: 'approved', resolution_note: 'รับ',
          resolved_by_id: 'sales-1', resolved_by_name: 'Rep One', resolved_at: '2026-10-08T01:00:00.000Z',
        }],
        messages: [{
          id: UUID, author_id: 'sales-1', author_name: 'Rep One', recipient_id: 'sales-2', recipient_name: 'Rep Two',
          text: 'โทรแล้ว', is_call_note: true, created_at: '2026-10-08T02:00:00.000Z',
        }],
      });
      opportunities.accountOpportunities.mockResolvedValue([UUID]);
      collab.directory.mockResolvedValue([{ id: 'sales-1', name: 'Rep One' }]);
      expect(wrapWinbackResponse(await controller.opportunityMeta(sale, UUID))).toMatchSnapshot();
      expect(wrapWinbackResponse(await controller.opportunityFilterMeta(sale))).toMatchSnapshot();
      expect(wrapWinbackResponse(await controller.opportunityCollaboration(sale, UUID))).toMatchSnapshot();
      expect(wrapWinbackResponse(await controller.accountOpportunities(sale, UUID))).toEqual({ data: [UUID] });
      expect(wrapWinbackResponse(await controller.collaborationDirectory())).toEqual({ data: [{ id: 'sales-1', name: 'Rep One' }] });
    });

    it('collaboration log page ({ data, meta } passes through, camelCased)', async () => {
      const { controller, collab } = createController();
      collab.logs.mockResolvedValue({
        data: [{
          id: UUID, event: 'owner_changed', opportunity_id: UUID, opportunity_name: 'ร้านวัฒนา', account_id: null, account_name: null,
          actor_id: 'mgr-1', actor_name: 'Mgr One', target_user_id: 'sales-1', target_user_name: 'Rep One', request_id: UUID,
          request_kind: 'handoff', note: null,
          changes: { owner: { from: 'sales-2', to: 'sales-1', from_name: 'Rep Two', to_name: 'Rep One' } },
          created_at: '2026-10-08T03:00:00.000Z',
        }],
        meta: { page: 1, limit: 50, total: 1 },
      });
      expect(wrapWinbackResponse(await controller.collaborationLogs(manager, { page: 1, limit: 50 } as any))).toMatchSnapshot();
    });

    it('convert', async () => {
      const { controller, opportunities } = createController();
      opportunities.convert.mockResolvedValue({ opportunity_id: UUID, winback_account_id: 'acc-1', customer_code: 'TMP-1', stage: 'prospect', lifecycle: 'tmp' });
      expect(wrapWinbackResponse(await controller.convertOpportunity(sale, UUID))).toMatchSnapshot();
    });

    it('revenue signal + revenue context', async () => {
      const { controller, signals } = createController();
      signals.complete.mockResolvedValue({
        id: 'acc-1', customer_code: 'GNA1', display_name: 'ร้าน A', signal_type: 'reactivate', priority: 91,
        reasons: ['ไม่ได้สั่ง 214 วัน'], recommended_action: 'visit', last_order_at: '2026-03-08T00:00:00.000Z',
        inactive_days: 214, delay_ratio: 11.9, median_reorder_interval_days: 18, avg_monthly_revenue: 180000,
        winnable: true, province: null, status: 'completed', outcome: 'follow_up', note: 'โทรแล้ว', snoozed_until: null, reason: null,
      });
      signals.revenueContext.mockResolvedValue({
        customer_state: 'dormant', last_order_at: '2026-03-08T00:00:00.000Z', days_since_last_order: 214,
        median_reorder_interval_days: 18, delay_ratio: 11.9, historical_monthly_revenue: 180000, revenue_at_risk: 180000,
        top_products: [], recommended_action: 'visit',
      });
      expect(wrapWinbackResponse(await controller.completeSignal(sale, UUID, { outcome: 'follow_up', note: 'โทรแล้ว' }))).toMatchSnapshot();
      expect(wrapWinbackResponse(await controller.revenueContext(UUID))).toMatchSnapshot();
    });

    it('products', async () => {
      const { controller, catalog } = createController();
      catalog.listProducts.mockResolvedValue([{
        id: UUID, sku: 'RIB20', name: 'ริบอาย', name_en: 'Ribeye', brand_name: null, category_name: 'เนื้อ',
        image_url: null, units: [{ id: 'selling', label: 'KG', unit_price: 912.5 }],
      }]);
      expect(wrapWinbackResponse(await controller.products({ search: 'ริบ', limit: 500 }))).toMatchSnapshot();
      expect(catalog.listProducts).toHaveBeenCalledWith({ search: 'ริบ', limit: 500 });
    });

    it('work plan + saved places + empty plan', async () => {
      const { controller, records } = createController();
      records.getWorkPlan.mockResolvedValue({
        account_id: UUID, completed: ['contact'], next_action: 'follow_up', due_at: null, blocker: '', note: '',
        preparation_complete: false, updated_at: null,
      });
      records.listSavedPlaces.mockResolvedValue([UUID]);
      records.getAppointmentPlan.mockResolvedValue(null);
      expect(wrapWinbackResponse(await controller.workPlan(UUID))).toMatchSnapshot();
      expect(wrapWinbackResponse(await controller.savedPlaces(sale))).toEqual({ data: [UUID] });
      expect(wrapWinbackResponse(await controller.appointmentPlan(UUID))).toEqual({ data: null });
    });

    it('quote', async () => {
      const { controller, commercial } = createController();
      commercial.saveQuote.mockResolvedValue({
        id: UUID, account_name: 'ร้าน A', lines: [{ product_id: 'p', product_name: 'ริบอาย', sku: 'RIB20', unit_id: 'selling', unit_label: 'KG', unit_price: 912.5, quantity: 2 }],
        valid_until: '2026-10-31', note: '', terms: null, content_version: 1, follow_up_at: null,
        events: [{ at: '2026-10-08T00:00:00.000Z', label: 'สร้างใบเสนอราคา', actor_id: 'sales-1', version: 1 }], versions: [],
        sales_user_id: 'sales-1', account_id: 'acc-1', status: 'draft', version: 1, created_at: '2026-10-08T00:00:00.000Z',
        updated_at: '2026-10-08T00:00:00.000Z', status_at: 'draft',
      });
      expect(wrapWinbackResponse(await controller.createQuote(sale, {} as any))).toMatchSnapshot();
      expect(commercial.saveQuote).toHaveBeenCalledWith({ id: 'sales-1', isManager: false }, null, {});
    });
  });
});

describe('ownership write guard (commerce: WINBACK_OWNER, wired in winback.module)', () => {
  const ctx = (method: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method }) }) }) as never;
  const saved = process.env.WINBACK_OWNER;
  afterEach(() => {
    if (saved === undefined) delete process.env.WINBACK_OWNER;
    else process.env.WINBACK_OWNER = saved;
  });

  it('the module puts WinbackOwnershipGuard on the app routes', () => {
    expect(WinbackModule).toBeDefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, WinbackAppController)).toEqual([AdminWriteGuard, WinbackAppRoleGuard, WinbackOwnershipGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, WinbackController)).toEqual([AdminWriteGuard, WinbackOwnershipGuard]);
  });

  it('409 on a write while josh still runs winback; reads pass; writes pass once commerce owns it', () => {
    delete process.env.WINBACK_OWNER;
    const guard = new WinbackOwnershipGuard();
    expect(guard.canActivate(ctx('GET'))).toBe(true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(() => guard.canActivate(ctx(method))).toThrow(ConflictException);
    process.env.WINBACK_OWNER = 'commerce';
    expect(guard.canActivate(ctx('PUT'))).toBe(true);
  });
});
