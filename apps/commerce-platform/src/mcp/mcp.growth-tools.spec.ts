import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { GrowthPlan, GrowthPlanInput } from '@cp/growth';
import { MCP_WRITE_SCOPE, McpStaff } from './mcp-oauth.provider';
import { McpTools } from './mcp.tools';

const id = '11111111-1111-4111-8111-111111111111';
const workflowId = '22222222-2222-4222-8222-222222222222';
const input: GrowthPlanInput = {
  title: 'แผนซื้อซ้ำ', goal: 'ตรวจการซื้อซ้ำ', template: 'reorder', owner: 'Marketing', segmentIds: [workflowId], excludeSegmentIds: [],
  productSkus: [], notifyTemplateKey: null, scheduleAt: null, budgetThb: 0, minimumMarginPercent: 20,
  holdoutPercent: 10, cooldownDays: 7, conversionWindowDays: 14,
  variants: [{ label: 'A', title: 'กลับมาสั่งซื้อ', body: 'ตรวจสินค้าในร้าน', evidenceIds: [] }], selectedVariant: 0,
  researchTopicId: null, researchRunId: null,
};

async function setup(role: 'marketing' | 'admin' = 'marketing', scopes = [MCP_WRITE_SCOPE], clientId = 'client-1') {
  const staff: McpStaff = { userId: 'staff-1', email: 'staff@jagota.co.th', role };
  const plan: GrowthPlan = { ...input, id, createdBy: staff.userId, version: 1, status: 'draft', approvedBy: null, approvedVersion: null,
    workflowId: null, evidence: [], tasks: [], history: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), canManage: true };
  const growth = {
    readiness: jest.fn(() => ({ ai: true, workflow: true, replica: true, activationBlockers: ['No live activation'] })),
    detail: jest.fn(async () => plan), list: jest.fn(async () => ({ items: [plan], totalCount: 1, page: 1, limit: 20 })),
    create: jest.fn(async () => plan), update: jest.fn(async () => plan), tasks: jest.fn(async () => plan),
    review: jest.fn(async () => plan), export: jest.fn(async () => ({ ...plan, status: 'ready', workflowId })), reconcile: jest.fn(async () => plan),
  };
  const growthData = {
    workspace: jest.fn(async () => ({ availability: 'ready', evidence: [], limitations: ['No costs'] })),
    results: jest.fn(async () => ({ workflowId, contributionThb: null })), timeline: jest.fn(async () => ({ companyId: id, events: [] })),
  };
  const analyst = { readiness: jest.fn(() => ({ configured: true, modelConfigured: true, limitations: [] })),
    list: jest.fn(async () => ({ items: [] })), detail: jest.fn(async () => ({ id })),
    generate: jest.fn(async (_id: string, _input: unknown, _staff: unknown, _open: () => ReturnType<McpTools['openReadClient']>) => ({ id, summary: 'report' })) };
  const insert = jest.fn(async (_row: { action: string; context: { tool?: string; clientId?: string } }) => undefined);
  const codes = new Map<string, string>();
  let issued = 0;
  const binding = (u: string, c: string, tool: string, hash: string) => JSON.stringify([u, c, tool, hash]);
  const oauth = {
    issueConfirm: jest.fn(async (u: string, c: string, tool: string, hash: string) => { const code = `code-${++issued}`; codes.set(code, binding(u, c, tool, hash)); return code; }),
    consumeConfirm: jest.fn(async (code: string, u: string, c: string, tool: string, hash: string) => {
      if (codes.get(code) !== binding(u, c, tool, hash)) return false;
      codes.delete(code); return true;
    }),
  };
  const tools = Object.assign(Object.create(McpTools.prototype), {
    db: { getRepository: () => ({ insert }) }, growth, growthData, analyst, oauth, insights: { available: false },
  }) as McpTools;
  const server = tools.server(staff, clientId, scopes);
  const client = new Client({ name: 'growth-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, any> & { isError: boolean }> => {
    const result = await client.callTool({ name, arguments: args });
    const text = String(result.content[0]?.text ?? '');
    let data: Record<string, any>;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    return { ...data, isError: result.isError === true };
  };
  return { staff, plan, tools, server, client, call, growth, growthData, analyst, insert, oauth,
    close: async () => { await Promise.all([client.close(), server.close()]); } };
}

describe('MCP Growth tools through the SDK', () => {
  it('lists role-scoped read tools, validates list filters and delegates reads with the actor', async () => {
    const s = await setup('marketing', []);
    try {
      const listed = (await s.client.listTools()).tools;
      expect(listed.filter(t => t.name.startsWith('growth_') || t.name.startsWith('market_')).map(t => t.name).sort())
        .toEqual(['growth_plans', 'growth_results', 'growth_workspace', 'market_analysis_reports']);
      expect(listed.every(t => t.annotations?.readOnlyHint)).toBe(true);
      expect((await s.call('growth_plans', { page: '2', limit: '5', month: '2026-10' })).isError).toBe(false);
      expect(s.growth.list).toHaveBeenCalledWith(s.staff, { page: 2, limit: 5, search: '', month: '2026-10' });
      await s.call('growth_plans', { id }); await s.call('growth_results', { workflowId }); await s.call('market_analysis_reports', { id });
      expect(s.growth.detail).toHaveBeenCalledWith(id, s.staff);
      expect(s.growthData.results).toHaveBeenCalledWith(workflowId, s.staff);
      expect(s.analyst.detail).toHaveBeenCalledWith(id, s.staff);
      expect((await s.call('growth_timeline', { companyId: id })).isError).toBe(true);
      expect((await s.call('growth_plans', { month: '2026-13' })).isError).toBe(true);
      expect((await s.call('growth_workspace')).readiness.activationBlockers).toEqual(['No live activation']);
    } finally { await s.close(); }
  });

  it('validates campaign inputs and creates only after an argument-bound, one-use confirmation', async () => {
    const s = await setup();
    try {
      const args = { id, plan: input };
      expect((await s.call('growth_plan_save', { ...args, plan: { ...input, budgetThb: -1 } })).isError).toBe(true);
      const preview = await s.call('growth_plan_save', args);
      expect(preview.willDo.after).toEqual(input);
      expect(s.growth.create).not.toHaveBeenCalled();
      expect((await s.call('growth_plan_save', { ...args, plan: { ...input, title: 'changed' }, confirmCode: preview.confirmCode })).status).toBe('rejected');
      expect((await s.call('growth_plan_save', { ...args, confirmCode: preview.confirmCode })).status).toBe('done');
      expect(s.growth.create).toHaveBeenCalledWith(id, input, s.staff);
      expect((await s.call('growth_plan_save', { ...args, confirmCode: preview.confirmCode })).status).toBe('rejected');
      expect(s.growth.create).toHaveBeenCalledTimes(1);
      expect(s.insert.mock.calls.some(([row]) => row.action === 'mcp.write' && row.context.tool === 'growth_plan_save')).toBe(true);
    } finally { await s.close(); }
  });

  it('refuses previews for non-owners, stale versions and uncertain exports; shows the full revision', async () => {
    const s = await setup();
    try {
      const args = { id, version: 1, plan: input };
      s.plan.canManage = false; expect((await s.call('growth_plan_save', args)).isError).toBe(true);
      s.plan.canManage = true; s.plan.version = 2; expect((await s.call('growth_plan_save', args)).isError).toBe(true);
      s.plan.version = 1; s.plan.status = 'export_unknown'; expect((await s.call('growth_plan_save', args)).isError).toBe(true);
      s.plan.status = 'draft'; const preview = await s.call('growth_plan_save', args);
      expect(preview.willDo.before).toEqual(s.plan);
      await s.call('growth_plan_save', { ...args, confirmCode: preview.confirmCode });
      expect(s.growth.update).toHaveBeenCalledWith(id, 1, input, s.staff);
    } finally { await s.close(); }
  });

  it('binds confirmation to the staff, client and tool as well as the arguments', async () => {
    const s = await setup();
    const otherClient = s.tools.server(s.staff, 'other-client', [MCP_WRITE_SCOPE]);
    const otherStaff = s.tools.server({ ...s.staff, userId: 'other-staff' }, 'client-1', [MCP_WRITE_SCOPE]);
    const handler = (server: typeof s.server, tool: string) => (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<{ content: { text: string }[] }> }> })._registeredTools[tool].handler;
    try {
      const args = { id, plan: input };
      const preview = await s.call('growth_plan_save', args);
      for (const server of [otherClient, otherStaff]) {
        const answer = await handler(server, 'growth_plan_save')({ ...args, confirmCode: preview.confirmCode }, {});
        expect(JSON.parse(answer.content[0].text).status).toBe('rejected');
      }
      expect((await s.call('growth_plan_tasks', { id, update: { version: 1, tasks: [] }, confirmCode: preview.confirmCode })).status).toBe('rejected');
      expect(s.growth.create).not.toHaveBeenCalled(); expect(s.growth.tasks).not.toHaveBeenCalled();
      expect((await s.call('growth_plan_save', { ...args, confirmCode: preview.confirmCode })).status).toBe('done');
    } finally { await Promise.all([s.close(), otherClient.close(), otherStaff.close()]); }
  });

  it('reuses the typed task schema and delegates a complete task replacement', async () => {
    const s = await setup();
    try {
      const task = { id: workflowId, title: 'ตรวจกลุ่ม', owner: 'Marketing', dueAt: null, done: false };
      expect((await s.call('growth_plan_tasks', { id, update: { version: 1, tasks: [task, task] } })).isError).toBe(true);
      const args = { id, update: { version: 1, tasks: [task] } };
      const p = await s.call('growth_plan_tasks', args);
      expect(p.willDo.plan).toEqual(s.plan); expect(p.willDo.tasksAfter).toEqual([task]);
      await s.call('growth_plan_tasks', { ...args, confirmCode: p.confirmCode });
      expect(s.growth.tasks).toHaveBeenCalledWith(id, 1, [task], s.staff);
    } finally { await s.close(); }
  });

  it('hides admin actions from marketing schema and also guards direct calls at runtime', async () => {
    const s = await setup();
    try {
      const tool = (await s.client.listTools()).tools.find(t => t.name === 'growth_plan_action')!;
      expect((tool.inputSchema.properties!.action as { enum: string[] }).enum).toEqual(['submit', 'export']);
      expect((await s.call('growth_plan_action', { id, version: 1, action: 'approve' })).isError).toBe(true);
      const raw = (s.server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools.growth_plan_action;
      await expect(raw.handler({ id, version: 1, action: 'approve' }, {})).rejects.toThrow('admin only');
      const args = { id, version: 1, action: 'submit' };
      const p = await s.call('growth_plan_action', args);
      expect(p.willDo.plan).toEqual(s.plan);
      await s.call('growth_plan_action', { ...args, confirmCode: p.confirmCode });
      expect(s.growth.review).toHaveBeenCalledWith(id, 1, false, s.staff);
    } finally { await s.close(); }
  });

  it('delegates admin approval, stopped draft export and uncertain-export reconciliation', async () => {
    const s = await setup('admin');
    try {
      await s.call('growth_timeline', { companyId: id }); expect(s.growthData.timeline).toHaveBeenCalledWith(id, s.staff);
      const run = async (action: string, extra = {}) => { const args = { id, version: 1, action, ...extra }; const p = await s.call('growth_plan_action', args); expect(p.willDo.plan).toEqual(s.plan); return s.call('growth_plan_action', { ...args, confirmCode: p.confirmCode }); };
      s.plan.status = 'review'; await run('approve'); expect(s.growth.review).toHaveBeenCalledWith(id, 1, true, s.staff);
      s.plan.status = 'approved'; s.plan.approvedBy = s.staff.userId; s.plan.approvedVersion = 1;
      expect((await run('export')).result.status).toBe('ready'); expect(s.growth.export).toHaveBeenCalledWith(id, 1, s.staff);
      s.plan.status = 'export_unknown'; expect((await s.call('growth_plan_action', { id, version: 1, action: 'export' })).isError).toBe(true);
      expect((await s.call('growth_plan_action', { id, version: 1, action: 'reconcile' })).isError).toBe(true);
      await run('reconcile', { workflowId }); expect(s.growth.reconcile).toHaveBeenCalledWith(id, 1, workflowId, s.staff);
    } finally { await s.close(); }
  });

  it('validates, previews and confirms analysis without automatically creating a campaign', async () => {
    const s = await setup();
    try {
      expect((await s.call('market_analyse', { requestId: id, question: '   ', days: 91 })).isError).toBe(true);
      const args = { requestId: id, question: ' เทรนด์ร้านอาหาร ', area: ' กรุงเทพฯ ', days: 30 };
      const p = await s.call('market_analyse', args);
      expect(p.willDo.question).toBe('เทรนด์ร้านอาหาร'); expect(s.analyst.generate).not.toHaveBeenCalled();
      await s.call('market_analyse', { ...args, confirmCode: p.confirmCode });
      expect(s.analyst.generate).toHaveBeenCalledWith(id, { question: 'เทรนด์ร้านอาหาร', area: 'กรุงเทพฯ', days: 30 }, s.staff, expect.any(Function));
      const open = s.analyst.generate.mock.calls[0][3] as () => ReturnType<McpTools['openReadClient']>;
      const connection = await open();
      try { expect((await connection.client.listTools()).tools.every(t => t.annotations?.readOnlyHint)).toBe(true); }
      finally { await connection.close(); }
      expect(s.growth.create).not.toHaveBeenCalled(); expect(s.growth.export).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });

  it('opens an audited read-only analyst client and closes both SDK endpoints', async () => {
    const s = await setup('admin');
    try {
      const serverSpy = jest.spyOn(s.tools, 'server');
      const connection = await s.tools.openReadClient(s.staff);
      const analystServer = serverSpy.mock.results[0].value;
      const closeServer = jest.spyOn(analystServer, 'close'); const closeClient = jest.spyOn(connection.client, 'close');
      const names = (await connection.client.listTools()).tools;
      expect(names.some(t => t.name === 'shop_traffic')).toBe(true); expect(names.every(t => t.annotations?.readOnlyHint)).toBe(true);
      expect((await connection.client.callTool({ name: 'growth_plan_save', arguments: { id, plan: input } })).isError).toBe(true);
      await connection.client.callTool({ name: 'growth_workspace', arguments: {} });
      expect(s.insert.mock.calls.some(([row]) => row.action === 'mcp.tool_call' && row.context.clientId === 'in-app-marketing-analyst')).toBe(true);
      await connection.close(); expect(closeServer).toHaveBeenCalled(); expect(closeClient).toHaveBeenCalled();
    } finally { await s.close(); }
  });
});
