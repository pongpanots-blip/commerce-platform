import { MCP_WRITE_SCOPE } from './mcp-oauth.provider';
import { McpTools } from './mcp.tools';

/** The marketing write tools, called the way an MCP client does (preview → confirmCode → run). */
function setup() {
  const josh = { run: jest.fn(async (_t: string, _a: string, args: { method?: string }) => (args?.method ? { status: 200, data: { id: 'new-1' } } : { id: 'p-1' })) };
  const codes = new Map<string, string>();
  const tools: McpTools = Object.assign(Object.create(McpTools.prototype) as object, {
    db: { getRepository: () => ({ insert: jest.fn(async () => undefined) }) },
    joshActions: josh,
    workflows: { detail: jest.fn(async () => ({ id: 'w-1', name: 'ตะกร้าค้าง', status: 'active' })) },
    oauth: {
      issueConfirm: jest.fn(async (_u: string, _c: string, tool: string, hash: string) => { codes.set('code-1', `${tool}:${hash}`); return 'code-1'; }),
      consumeConfirm: jest.fn(async (code: string, _u: string, _c: string, tool: string, hash: string) => codes.get(code) === `${tool}:${hash}`),
    },
  }) as unknown as McpTools;
  const server = tools.server({ userId: 's-1', email: 'mkt@jagota.co.th', role: 'marketing' } as never, 'client-1', [MCP_WRITE_SCOPE]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await (server as unknown as { _registeredTools: Record<string, { handler: (a: unknown, e: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })
      ._registeredTools[name].handler(args, {});
    return { ...JSON.parse(r.content[0].text), isError: r.isError };
  };
  return { call, josh };
}

describe('MCP marketing tools', () => {
  it('marketing_save creates a coupon switched off, only after confirmation, through josh admin-call', async () => {
    const { call, josh } = setup();
    const args = { kind: 'coupon', data: { coupon_code: 'NEW10', title: 'ลด 10' } };
    const preview = await call('marketing_save', args);
    expect(preview.status).toBe('needs_confirmation');
    expect(preview.willDo.data).toMatchObject({ coupon_code: 'NEW10', is_active: false });
    expect(josh.run).not.toHaveBeenCalled();
    const done = await call('marketing_save', { ...args, confirmCode: preview.confirmCode });
    expect(done.status).toBe('done');
    expect(josh.run).toHaveBeenCalledWith('admin-call', 'call', expect.objectContaining({ method: 'POST', path: '/coupon', body: { coupon_code: 'NEW10', title: 'ลด 10', is_active: false } }),
      { userId: 's-1', email: 'mkt@jagota.co.th' }, 'mcp');
  });

  it('never switches anything on or activates a workflow', async () => {
    const { call, josh } = setup();
    for (const data of [{ is_active: true }, { active: true }, { status: 'active' }]) {
      const r = await call('marketing_save', { kind: 'workflow', id: '11111111-1111-4111-8111-111111111111', data });
      expect(r.isError).toBe(true);
    }
    expect(josh.run).not.toHaveBeenCalled();
  });

  it('workflow create / edit and promotion go to the right josh calls; segment edit is a PATCH', async () => {
    const { call, josh } = setup();
    const run = async (args: Record<string, unknown>) => { const p = await call('marketing_save', args); return call('marketing_save', { ...args, confirmCode: p.confirmCode }); };
    await run({ kind: 'workflow', data: { name: 'ลูกค้าใหม่', trigger_type: 'signup', steps: [] } });
    await run({ kind: 'segment', id: '22222222-2222-4222-8222-222222222222', data: { name: 'ร้านอาหารญี่ปุ่น' } });
    await run({ kind: 'promotion', data: { name: 'ลด 5%' } });
    expect(josh.run.mock.calls.map((c) => [c[0], c[1], (c[2] as { method?: string; path?: string }).method ?? '', (c[2] as { path?: string }).path ?? ''])).toEqual([
      ['admin-call', 'call', 'POST', '/marketing-workflows'],
      ['admin-call', 'call', 'PATCH', '/user-segments/22222222-2222-4222-8222-222222222222'],
      ['promotions', 'create', '', ''],
    ]);
    expect((josh.run.mock.calls[2][2] as { mechanic: { is_active: boolean } }).mechanic.is_active).toBe(false);
  });

  it('a read-only connection has no write tools', () => {
    const tools: McpTools = Object.assign(Object.create(McpTools.prototype) as object, { db: {}, joshActions: {}, oauth: {} }) as unknown as McpTools;
    const server = tools.server({ userId: 's', email: 'e', role: 'marketing' } as never, 'c', []);
    const names = Object.keys((server as unknown as { _registeredTools: object })._registeredTools);
    expect(names).toContain('marketing_list');
    expect(names).not.toContain('marketing_save');
  });
});
