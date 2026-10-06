import { BadGatewayException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { MarketAnalystService } from './market-analyst.service';
import { MarketAnalystController } from './market-analyst.controller';
import type { McpStaff } from './mcp-oauth.provider';

const id = '11111111-1111-4111-8111-111111111111';
const staff: McpStaff = { userId: '22222222-2222-4222-8222-222222222222', email: 'test@example.test', role: 'marketing' };
const input = { question: 'หาเทรนด์และเทียบกับพฤติกรรมร้าน', area: 'กรุงเทพฯ', days: 1 };
const source = `analysis:${id}:mcp:0`;
const message = (value: unknown) => ({ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] });
const good = () => ({ summary: 'เสนอทดลอง', findings: [{ title: 'พฤติกรรม', detail: 'ตรวจเพิ่ม', kind: 'hypothesis', evidenceIds: [source] }],
  recommendations: [{ id: 'check', title: 'ตรวจคำค้น', why: 'เป็นสมมติฐาน', nextStep: 'ตรวจสินค้า', successMetric: 'no-results ลดลง', productSkus: ['SKU-1'], evidenceIds: [source] }], limitations: [] });

function setup(answer = good(), maliciousTool = false) {
  let stored: any;
  const repo = { findOneBy: jest.fn(async () => stored), find: jest.fn(async () => stored ? [stored] : []),
    createQueryBuilder: () => ({ insert() { return this; }, values(row: unknown) { stored = row; return this; }, orIgnore() { return this; }, async execute() {} }) };
  const service = new MarketAnalystService({ getRepository: () => repo } as any);
  const client = {
    listTools: jest.fn(async () => ({ tools: ['growth_workspace', 'shop_traffic', 'catalog_products', 'workflow_activate'].map(name => ({ name, inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: name !== 'workflow_activate' } })) })),
    callTool: jest.fn(async ({ name }) => ({ content: [{ type: 'text', text: JSON.stringify(name === 'catalog_products' ? [{ sku: 'SKU-1' }] : { available: false, internalOnly: 'internal-snapshot', search: 'test@example.test 0812345678' }) }] })),
  };
  const close = jest.fn(async () => undefined), open = jest.fn(async () => ({ client: client as any, close }));
  const bodies: any[] = [];
  const outputs = [
    [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'ข้อมูลเว็บตัวอย่าง', annotations: [{ type: 'url_citation', url: 'https://example.com/trend', title: 'แหล่งตัวอย่าง' }] }] }],
    [{ type: 'function_call', name: maliciousTool ? 'workflow_activate' : 'catalog_products', call_id: 'call-1', arguments: '{}' }],
    [message({ note: 'อ่านครบ' })], [message(answer)],
  ];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return { ok: true, json: async () => ({ status: 'completed', output: outputs.shift() }) } as Response;
  });
  return { service, repo, client, close, open, bodies };
}

describe('Market Analyst trust boundaries and draft flow', () => {
  const env = { key: process.env.OPENAI_API_KEY, model: process.env.MARKETING_ANALYST_MODEL, growth: process.env.GROWTH_AI_MODEL };
  beforeEach(() => { process.env.OPENAI_API_KEY = 'test-only'; process.env.MARKETING_ANALYST_MODEL = 'test-model'; });
  afterEach(() => { jest.restoreAllMocks();
    for (const [name, value] of [['OPENAI_API_KEY', env.key], ['MARKETING_ANALYST_MODEL', env.model], ['GROWTH_AI_MODEL', env.growth]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
  });
  it('stores grounded evidence, isolates web queries, preserves unavailability and replays before checking provider', async () => {
    const s = setup();
    s.client.callTool.mockImplementationOnce(async () => ({ content: [{ type: 'text', text: JSON.stringify({ available: false, padding: 'x'.repeat(4500), lateDetail: 'must-persist' }) }] }));
    const report = await s.service.generate(id, input, staff, s.open);
    expect(s.bodies[0].tools.map(t => t.type)).toEqual(['web_search']);
    expect(JSON.stringify(s.bodies[0])).not.toContain('internal-snapshot');
    expect(s.bodies.slice(1).every(b => !b.tools?.some(t => t.type === 'web_search'))).toBe(true);
    expect(JSON.stringify(s.bodies)).not.toContain('test@example.test');
    expect(JSON.stringify(s.bodies)).not.toContain('0812345678');
    const traffic = s.client.callTool.mock.calls.find(([args]) => args.name === 'shop_traffic')![0] as any;
    expect(traffic.arguments.fromDate).toBe(traffic.arguments.toDate); // days=1 means today's Bangkok calendar day.
    expect(report.trace.find(t => t.tool === 'shop_traffic')?.status).toBe('unavailable');
    expect(report.evidence.some(e => e.url === 'https://example.com/trend')).toBe(true);
    expect(report.evidence[0].excerpt).toContain('must-persist');
    expect(s.close).toHaveBeenCalledTimes(1);
    delete process.env.OPENAI_API_KEY;
    expect(await s.service.generate(id, input, staff, s.open)).toEqual(report);
    expect(s.open).toHaveBeenCalledTimes(1);
    await expect(s.service.generate(id, { ...input, days: 2 }, staff, s.open)).rejects.toBeInstanceOf(ConflictException);
    await expect(s.service.detail(id, { ...staff, userId: 'other' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(await s.service.detail(id, { ...staff, userId: 'other', role: 'admin' })).toEqual(report);
    await s.service.list(staff); expect(s.repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { createdBy: staff.userId }, take: 20 }));
  });
  it.each(['citation', 'sku', 'unavailable-fact', 'write-tool'])('rejects unsupported %s without saving or mutating', async kind => {
    const answer = good();
    if (kind === 'citation') answer.recommendations[0].evidenceIds = ['invented'];
    if (kind === 'sku') answer.recommendations[0].productSkus = ['NOT-READ'];
    if (kind === 'unavailable-fact') answer.findings[0].kind = 'fact';
    const s = setup(answer, kind === 'write-tool');
    await expect(s.service.generate(id, input, staff, s.open)).rejects.toBeInstanceOf(BadGatewayException);
    expect(s.client.callTool.mock.calls.every(([args]) => args.name !== 'workflow_activate')).toBe(true);
    expect(await s.repo.findOneBy()).toBeUndefined(); expect(s.close).toHaveBeenCalledTimes(1);
  });
  it('returns explicit missing-provider state without opening MCP or calling AI', async () => {
    const s = setup(); delete process.env.OPENAI_API_KEY;
    await expect(s.service.generate(id, input, staff, s.open)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(s.open).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('creates a report-linked draft only after an explicit recommendation action, with no audience or schedule', async () => {
    const s = setup(), report = await s.service.generate(id, input, staff, s.open);
    const growth = { create: jest.fn(async (_request, plan) => plan) };
    const controller = new MarketAnalystController(s.service, {} as any, growth as any);
    expect(growth.create).not.toHaveBeenCalled();
    const plan = await controller.plan(id, { requestId: staff.userId, recommendationId: 'check' }, { staff } as any);
    expect(plan.analysisId).toBe(report.id); expect(plan.segmentIds).toEqual([]); expect(plan.scheduleAt).toBeNull();
    expect(plan.variants[0].evidenceIds).toEqual(report.recommendations[0].evidenceIds);
  });
});
