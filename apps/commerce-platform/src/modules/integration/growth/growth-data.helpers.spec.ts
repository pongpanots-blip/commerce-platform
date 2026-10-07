import { experimentResult, workflowPayload } from './growth-data.helpers';
import { GrowthDataService } from './growth-data.service';

const ID = '55555555-5555-4555-8555-555555555555';
const OTHER = '66666666-6666-4666-8666-666666666666';
const actor = { userId: ID, email: 'marketing@example.test', role: 'marketing' };

function build(configured = true) {
  const replica = { configured, query: jest.fn(async (_sql: string, _params?: unknown[]) => [{ revenue: 410 }]) };
  const insights = { sales: jest.fn() };
  const workflows = { list: jest.fn(), detail: jest.fn(async () => ({ name: 'real workflow', enrollmentsByStatus: [{ status: 'failed', n: 2 }] })) };
  const analytics = { workflowId: ID, funnel: { enrolled: 20, notifySent: 15, offerShown: 3, couponGranted: 4, couponRedeemed: 1, orderConverted: 2 } };
  const conversion = { workflowId: ID, sent: { enrolled: 20, converted: 2 }, holdout: { enrolled: 2, converted: 0 } };
  const josh = { run: jest.fn(async (_target: string, _action: string, args: { path: string }) => ({ status: 200, data: { statusCode: 200, data: args.path.endsWith('analytics') ? analytics : conversion } })) };
  const research = { detail: jest.fn(), runDetail: jest.fn() };
  const db = { query: jest.fn(async (sql: string, _params?: unknown[]): Promise<Record<string, unknown>[]> =>
    /w\.conversions/.test(sql) ? [{ revenue: 300 }]
      : /josh_companies/.test(sql) ? [{ id: OTHER, name: 'ร้านสำเนา' }]
      : /josh_orders/.test(sql) ? [{ id: ID, at: '2026-10-01T03:00:00Z', status: 'delivered', total_price: 500, paid: true }]
        : /winback_activity/.test(sql) ? [] : [{ n: 3, updated_at: '2026-10-01' }]) };
  return { replica, insights, workflows, josh, research, db,
    service: new GrowthDataService(replica as never, insights as never, workflows as never, josh as never, research as never, db as never) };
}

describe('GROWTH_SOURCE=copies (stage 5, S5-6)', () => {
  const env = process.env.GROWTH_SOURCE;
  beforeEach(() => { process.env.GROWTH_SOURCE = 'copies'; });
  afterEach(() => { if (env === undefined) delete process.env.GROWTH_SOURCE; else process.env.GROWTH_SOURCE = env; });

  it('workspace without the replica: sales from the copies, reorder-due from commerce winback, workflows from their copy, carts "not copied"', async () => {
    const { service, replica, insights, workflows, db } = build(false);
    workflows.list.mockResolvedValue([{ failed_runs: 1 }, { failed_runs: 0 }]);
    insights.sales.mockResolvedValue({ totals: { revenue_inc_vat: 900, orders: 3, refunds: { n: null, amount: null } }, vsPreviousPeriod: { revenue_change_percent: 5 }, counted: 'paid' });
    expect(service.available).toBe(true);
    const w = await service.workspace();
    expect(insights.sales).toHaveBeenCalledWith(expect.anything(), 1, 'copies');
    expect(replica.query).not.toHaveBeenCalled();
    expect(workflows.list).toHaveBeenCalledWith(30, 'copies');
    expect(w.metrics.find((m) => m.key === 'workflow_failures')?.value).toBe(1);
    expect(db.query.mock.calls[0][0]).toContain('FROM winback_account');
    expect(w.availability).toBe('partial');
    expect(w.metrics.find((m) => m.key === 'revenue')?.value).toBe(900);
    expect(w.metrics.find((m) => m.key === 'reorder_due')?.value).toBe(3);
    expect(w.metrics.find((m) => m.key === 'idle_carts')?.value).toBeNull();
    expect(w.limitations.join(' ')).toContain('ยังไม่มีสำเนาใน commerce');
    expect(w.evidence.every((e) => e.source === 'สำเนาข้อมูล josh ใน commerce')).toBe(true);
  });

  it('timeline without the replica: company + orders from the copies, workflow enrollments "not copied"', async () => {
    const { service, replica, db } = build(false);
    const t = await service.timeline(OTHER, { ...actor, role: 'admin' });
    expect(replica.query).not.toHaveBeenCalled();
    expect(t.name).toBe('ร้านสำเนา');
    expect(t.events).toEqual([expect.objectContaining({ kind: 'order', title: expect.stringContaining('รับชำระ 500 THB') })]);
    expect(t.limitations.join(' ')).toContain('ยังไม่มีสำเนาใน commerce');
    expect(db.query.mock.calls.find(([sql]) => /josh_orders/.test(sql))?.[0]).toContain('o.paid');
  });

  it('results without the replica: workflow from its copy (S5-12), credited revenue from josh_orders + the conversions copy', async () => {
    const { service, replica, workflows, db } = build(false);
    const result = await service.results(ID, actor);
    expect(replica.query).not.toHaveBeenCalled();
    expect(workflows.detail).toHaveBeenCalledWith(ID, 'copies');
    expect(result.attributedRevenueThb).toBe(300);
    const [sql, params] = db.query.mock.calls.find(([q]) => /w\.conversions/.test(q))!;
    expect(sql).toContain('FROM josh_orders o');
    expect(sql).toContain('o.paid');
    expect(params?.[0]).toBe(ID);
    expect(result.operations).toEqual([{ label: 'failed', count: 2 }]);
  });
});

describe('Growth data uses verifiable facts', () => {
  it('does not invent zero counts or sample opportunities without the replica', async () => {
    const { service, replica, insights } = build(false);
    const workspace = await service.workspace();
    expect(workspace.availability).toBe('unavailable');
    expect(workspace.metrics.every((metric) => metric.value === null)).toBe(true);
    expect(workspace.opportunities).toEqual([]);
    expect(replica.query).not.toHaveBeenCalled();
    expect(insights.sales).not.toHaveBeenCalled();
  });

  it('retains real available sources when another source fails', async () => {
    const { service, insights, replica, workflows } = build();
    const sales = { totals: { revenue_inc_vat: 2000, orders: 10, refunds: { amount: 0 } }, vsPreviousPeriod: { revenue_change_percent: -10 }, counted: 'paid real orders' };
    insights.sales.mockResolvedValue(sales);
    replica.query.mockImplementation(async (sql: string) => {
      if (sql.includes('cart_snapshot')) throw new Error('cart unavailable');
      return [{ n: 4 }] as never;
    });
    workflows.list.mockResolvedValue([{ failed_runs: 2 }]);
    const workspace = await service.workspace();
    expect(workspace.availability).toBe('partial');
    expect(workspace.metrics.find((metric) => metric.key === 'revenue')?.value).toBe(2000);
    expect(workspace.metrics.find((metric) => metric.key === 'idle_carts')?.value).toBeNull();
    expect(workspace.opportunities.map((opportunity) => opportunity.id)).toEqual(['sales-decline', 'reorder-due', 'workflow-failures']);
    expect(workspace.opportunities.every((opportunity) => opportunity.evidenceIds.every((id) => workspace.evidence.some((item) => item.id === id)))).toBe(true);
    expect((await service.workspace()).evidence.map((item) => item.id)).toEqual(workspace.evidence.map((item) => item.id));
    insights.sales.mockResolvedValue({ ...sales, totals: { ...sales.totals, revenue_inc_vat: 3000 } });
    const changed = await service.workspace();
    expect(changed.evidence[0].id).not.toBe(workspace.evidence[0].id);
    expect(workspace.evidence[0].excerpt).toContain('2000 THB');
  });

  it('reads results through authorized GETs, with paid orders deduplicated before summing and missing costs explicit', async () => {
    const { service, replica, josh } = build();
    const result = await service.results(ID, actor);
    expect(result.attributedRevenueThb).toBe(410);
    expect(result.contributionThb).toBeNull();
    expect(result.missingCosts).toContain('ต้นทุนสินค้า (COGS)');
    expect(result.experiment.confidence).toBe('insufficient');
    expect(result.experiment.sent).toEqual({ enrolled: 20, converted: 2 });
    const [sql, params] = replica.query.mock.calls[0];
    expect(sql).toContain('FROM orders o');
    expect(sql).toContain('AND EXISTS (');
    expect(sql).toContain('payment_transaction_orders');
    expect(sql).toContain("pt_.status::text = 'success' AND NOT pt_.is_test");
    expect(sql).toContain('NOT e.is_holdout');
    expect(sql).toContain('e.user_id = o.user_id');
    expect(sql).toContain('make_interval(days => w.conversion_window_days)');
    expect(params?.[0]).toBe(ID);
    for (const call of josh.run.mock.calls) expect((call[2] as { method?: string }).method).toBe('GET');
  });

  it('reports unavailable attribution as null when the revenue source fails', async () => {
    const { service, replica } = build();
    replica.query.mockRejectedValue(new Error('orders unavailable'));
    const result = await service.results(ID, actor);
    expect(result.attributedRevenueThb).toBeNull();
    expect(result.limitations.some((item) => item.includes('ไม่พร้อมอ่านออเดอร์'))).toBe(true);
  });

  it('rejects company timelines for marketing before reading any customer data', async () => {
    const { service, replica } = build();
    await expect(service.timeline(ID, actor)).rejects.toThrow('admin only');
    expect(replica.query).not.toHaveBeenCalled();
  });

  it('attaches only stored completed research evidence belonging to the selected topic', async () => {
    const { service, research } = build();
    research.detail.mockResolvedValue({ id: ID, version: 3, archivedAt: null });
    const run = { topicId: ID, status: 'partial', topicVersion: 2, scope: { title: 'stored topic', area: 'กรุงเทพ', sector: 'ร้านอาหาร', days: 30 }, report: {
      coverage: [{ source: 'tat', status: 'searched', from: '2026-09-06', to: '2026-10-06' }, { source: 'google', status: 'unavailable' }], limitations: ['pilot coverage only'],
      evidence: [{ id: 'e1', source: 'tat', url: 'https://example.test/source', collectedAt: '2026-10-06T01:00:00Z', excerpt: 'Stored evidence' }] } };
    research.runDetail.mockResolvedValue(run);
    const [evidence] = await service.researchEvidence(ID, OTHER, actor);
    expect(evidence).toMatchObject({ ...run.report.evidence[0], id: `research:${OTHER}:e1`, title: 'stored topic · โจทย์ v2', excerpt: expect.stringContaining('Stored evidence') });
    expect(evidence.excerpt).toContain('เป็นรายงานเวอร์ชันเก่า'); expect(evidence.excerpt).toContain('google'); expect(evidence.excerpt).toContain('2026-09-06');
    research.runDetail.mockResolvedValue({ ...run, topicId: OTHER });
    await expect(service.researchEvidence(ID, OTHER, actor)).rejects.toThrow('ไม่ได้อยู่ในโจทย์');
    research.runDetail.mockResolvedValue({ ...run, status: 'failed' });
    await expect(service.researchEvidence(ID, OTHER, actor)).rejects.toThrow('รายงาน Research ที่เสร็จแล้ว');
  });
});

describe('Growth experiment boundaries', () => {
  it('does not use a large sent group to conceal a tiny holdout', () => {
    const result = experimentResult({ sent: { enrolled: 10000, converted: 2000 }, holdout: { enrolled: 2, converted: 0 } });
    expect(result.confidence).toBe('insufficient');
    expect(result.rateDifferencePoints).toBe(20);
  });
  it('retains inconclusive status for large counts while company independence is unverified', () => {
    expect(experimentResult({ sent: { enrolled: 10000, converted: 3000 }, holdout: { enrolled: 1000, converted: 100 } }).confidence).toBe('inconclusive');
  });
  it('rejects invalid conversion counts and cross-workflow responses', () => {
    expect(() => experimentResult({ sent: { enrolled: 1, converted: 2 }, holdout: { enrolled: 2, converted: 0 } })).toThrow();
    expect(() => experimentResult({ sent: { enrolled: 20, converted: null }, holdout: { enrolled: 2, converted: 0 } })).toThrow();
    expect(() => workflowPayload({ data: { workflowId: OTHER } }, ID)).toThrow('ไม่ตรงกับ workflow');
  });
});
