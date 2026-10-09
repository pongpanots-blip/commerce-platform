import { MCP_WRITE_SCOPE } from './mcp-oauth.provider';
import { McpTools } from './mcp.tools';

const SEG = '22222222-2222-4222-8222-222222222222';
const NEW = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const COUPON = {
  coupon_code: 'NEW10', title: 'ลด 10', applicable_products_th: 'ทุกสินค้า', applicable_products_en: 'All products',
  discount_type: 'PERCENTAGE', discount_value: 10, global_limit: 100, start_date: '2026-11-01T00:00:00+07:00', end_date: '2026-11-30T23:59:59+07:00',
};

/** The marketing write tools, called the way an MCP client does (preview → confirmCode → run). */
function setup(role: 'marketing' | 'admin' = 'marketing') {
  // josh admin-call: a GET answers the current record (live), a write answers the saved id.
  const josh = { run: jest.fn(async (_t: string, _a: string, args: { method?: string; path?: string }): Promise<unknown> => {
    if (args?.method === 'GET') return { status: 200, data: args.path?.endsWith('/user-segments') ? [] : { data: { id: SEG, name: 'เดิม', is_active: true } } };
    return args?.method ? { status: 200, data: { id: NEW } } : { id: 'p-1' };
  }) };
  const audit = jest.fn(async (_row: Record<string, unknown>) => undefined);
  const codes = new Map<string, string>();
  const tools: McpTools = Object.assign(Object.create(McpTools.prototype) as object, {
    db: { getRepository: () => ({ insert: audit, findOneBy: jest.fn(async () => ({ id: PRODUCT, sku: 'SKU1', translations: [{ language_code: 'en', product_name: 'Sauce', product_description: 'old' }] })) }) },
    joshActions: josh,
    catalogSync: { syncId: jest.fn(async () => undefined) },
    modules: { get: () => ({ query: async () => [{ sku: 'SKU1' }] }) },
    workflows: { detail: jest.fn(async () => ({ id: 'w-1', name: 'ตะกร้าค้าง', status: 'active' })) },
    promotions: { available: false },
    oauth: {
      issueConfirm: jest.fn(async (_u: string, _c: string, tool: string, hash: string) => { codes.set('code-1', `${tool}:${hash}`); return 'code-1'; }),
      consumeConfirm: jest.fn(async (code: string, _u: string, _c: string, tool: string, hash: string) => codes.get(code) === `${tool}:${hash}`),
    },
  }) as unknown as McpTools;
  const server = tools.server({ userId: 's-1', email: 'mkt@jagota.co.th', role } as never, 'client-1', [MCP_WRITE_SCOPE]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await (server as unknown as { _registeredTools: Record<string, { handler: (a: unknown, e: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> }> })
      ._registeredTools[name].handler(args, {});
    return { ...JSON.parse(r.content[0].text), isError: r.isError };
  };
  const run = async (name: string, args: Record<string, unknown>) => { const p = await call(name, args); return call(name, { ...args, confirmCode: p.confirmCode }); };
  const writes = () => josh.run.mock.calls.filter((c) => (c[2] as { method?: string }).method !== 'GET')
    .map((c) => [c[0], c[1], (c[2] as { method?: string }).method ?? '', (c[2] as { path?: string }).path ?? '']);
  const logged = () => audit.mock.calls.map((c) => c[0]).filter((row) => row.action === 'mcp.write');
  return { call, run, josh, writes, logged };
}

describe('MCP marketing tools', () => {
  it('marketing_save creates a coupon switched off, only after confirmation, through josh admin-call', async () => {
    const { call, josh } = setup();
    const args = { kind: 'coupon', data: COUPON };
    const preview = await call('marketing_save', args);
    expect(preview.status).toBe('needs_confirmation');
    expect(preview.willDo.data).toMatchObject({ coupon_code: 'NEW10', is_active: false });
    expect(josh.run).not.toHaveBeenCalled();
    const done = await call('marketing_save', { ...args, confirmCode: preview.confirmCode });
    expect(done.status).toBe('done');
    expect(done.openInAdmin).toMatch(new RegExp(`/j/coupon/${NEW}$`));
    expect(josh.run).toHaveBeenCalledWith('admin-call', 'call', expect.objectContaining({ method: 'POST', path: '/coupon', body: { ...COUPON, is_active: false } }),
      { userId: 's-1', email: 'mkt@jagota.co.th' }, 'mcp');
  });

  it('rejects data that does not match josh\'s fields before any preview, and says which fields', async () => {
    const { call, josh } = setup();
    const r = await call('marketing_save', { kind: 'coupon', data: { coupon_code: 'TOOLONGCODE', title: 'x', colour: 'red' } });
    expect(r.isError).toBe(true);
    expect(r.problems.join(' ')).toMatch(/coupon_code/);
    expect(r.problems.join(' ')).toMatch(/discount_type/);
    expect(r.fields.properties.discount_type.enum).toEqual(['PERCENTAGE', 'FIXED_AMOUNT']);
    expect(josh.run).not.toHaveBeenCalled();
  });

  it('never switches anything on or activates a workflow', async () => {
    const { call, josh } = setup();
    for (const data of [{ is_active: true }, { active: true }, { status: 'active' }]) {
      const r = await call('marketing_save', { kind: 'workflow', id: '11111111-1111-4111-8111-111111111111', data });
      expect(r.isError).toBe(true);
    }
    expect(josh.run).not.toHaveBeenCalled();
  });

  it('an edit previews the record before, the changed fields and a live warning', async () => {
    const { call } = setup();
    const preview = await call('marketing_save', { kind: 'segment', id: SEG, data: { name: 'ร้านอาหารญี่ปุ่น' } });
    expect(preview.willDo.before).toMatchObject({ name: 'เดิม' });
    expect(preview.willDo.changes).toEqual([{ field: 'name', before: 'เดิม', after: 'ร้านอาหารญี่ปุ่น' }]);
    expect(preview.willDo.live).toBeDefined();
    expect(preview.willDo.checkIn).toMatch(new RegExp(`/j/segments/edit/${SEG}$`));
  });

  it('workflow create / edit and promotion go to the right josh calls; segment edit is a PATCH', async () => {
    const { run, josh, writes } = setup();
    await run('marketing_save', { kind: 'workflow', data: { name: 'ลูกค้าใหม่', trigger_type: 'signup', steps: [] } });
    await run('marketing_save', { kind: 'segment', id: SEG, data: { name: 'ร้านอาหารญี่ปุ่น' } });
    await run('marketing_save', { kind: 'promotion', data: { name: 'ลด 5%' } });
    expect(writes()).toEqual([
      ['admin-call', 'call', 'POST', '/marketing-workflows'],
      ['admin-call', 'call', 'PATCH', `/user-segments/${SEG}`],
      ['promotions', 'create', '', ''],
    ]);
    expect((josh.run.mock.calls.find((c) => c[0] === 'promotions')![2] as { mechanic: { is_active: boolean } }).mechanic.is_active).toBe(false);
  });

  it('a new campaign is switched off right after josh creates it (josh drops is_active on create)', async () => {
    const { run, josh, writes } = setup();
    await run('marketing_save', { kind: 'campaign', data: { name: 'ปีใหม่', start_at: '2026-12-01', end_at: '2026-12-31' } });
    expect(writes()).toEqual([['admin-call', 'call', 'POST', '/campaigns'], ['admin-call', 'call', 'PATCH', `/campaigns/${NEW}`]]);
    expect((josh.run.mock.calls[0][2] as { body: object }).body).not.toHaveProperty('is_active');
    expect((josh.run.mock.calls[1][2] as { body: object }).body).toEqual({ is_active: false });
  });

  it('a banner is created off, with the field names josh\'s multipart route reads', async () => {
    const { run, josh } = setup();
    await run('marketing_save', { kind: 'banner', data: { title: 'ปีใหม่', placement: 'HERO', image_url_desktop: 'https://cdn/x.jpg', link_url: '/promotions/new-year', sort_order: 2 } });
    expect(josh.run.mock.calls[0][2]).toMatchObject({ method: 'POST', path: '/banner',
      body: { nameBanner: 'ปีใหม่', linkWeb: '/promotions/new-year', placement: 'HERO', image_url_desktop: 'https://cdn/x.jpg', sort_order: '2', is_active: 'false' } });
  });

  it('the welcome email is one record: no id, edited in place, flagged live', async () => {
    const { call, run, writes } = setup();
    expect((await call('marketing_save', { kind: 'welcome_email', id: SEG, data: { bgColor: '#ffffff' } })).isError).toBe(true);
    const preview = await call('marketing_save', { kind: 'welcome_email', data: { copy: { th: { headlineTop: 'ยินดีต้อนรับ' } } } });
    expect(preview.willDo.live).toBeDefined();
    await run('marketing_save', { kind: 'welcome_email', data: { copy: { th: { headlineTop: 'ยินดีต้อนรับ' } } } });
    expect(writes()).toEqual([['admin-call', 'call', 'PATCH', '/marketing-settings/welcome-lead-email']]);
  });

  it('logs who asked, through which AI, what record and which fields changed — and failed tries too', async () => {
    const { run, josh, logged } = setup();
    await run('marketing_save', { kind: 'segment', id: SEG, data: { name: 'ใหม่' } });
    expect(logged()[0]).toMatchObject({ actorId: 's-1', entityType: 'josh.segment', entityId: SEG, before: { name: 'เดิม' }, after: { name: 'ใหม่' },
      context: expect.objectContaining({ email: 'mkt@jagota.co.th', clientId: 'client-1', tool: 'marketing_save', changes: [{ field: 'name', before: 'เดิม', after: 'ใหม่' }] }) });
    josh.run.mockImplementation(async (_t: string, _a: string, args: { method?: string }) => (args?.method === 'GET' ? { status: 200, data: { data: { id: SEG } } } : { status: 400, data: { message: 'slug taken' } }));
    await expect(run('marketing_save', { kind: 'segment', id: SEG, data: { name: 'อีก' } })).rejects.toThrow('josh: slug taken');
    expect(logged()[1].context).toMatchObject({ error: 'josh: slug taken', email: 'mkt@jagota.co.th' });
  });

  it('marketing_fields returns the schema for a kind', async () => {
    const { call } = setup();
    const r = await call('marketing_fields', { kind: 'smart_link' });
    expect(r.schema.required).toEqual(expect.arrayContaining(['slug', 'destination_web']));
    expect(r.createdSwitchedOff).toEqual({ active: false });
  });

  it('product_content_save (admin) sends only copy fields to josh and logs the product', async () => {
    const { call, run, josh, logged } = setup('admin');
    const preview = await call('product_content_save', { sku: 'SKU1', fields: { product_description_en: 'Rich soy sauce' } });
    expect(preview.willDo.changes).toEqual([{ field: 'product_description_en', before: 'old', after: 'Rich soy sauce' }]);
    await run('product_content_save', { sku: 'SKU1', fields: { product_description_en: 'Rich soy sauce' } });
    expect(josh.run).toHaveBeenCalledWith('products', 'update', { id: PRODUCT, fields: { product_description_en: 'Rich soy sauce' } }, expect.objectContaining({ email: 'mkt@jagota.co.th' }), 'mcp');
    expect(logged()[0]).toMatchObject({ entityType: 'josh.product', entityId: PRODUCT });
  });

  it('a marketing connection has no product_content_save; a read-only connection has no write tools', () => {
    const names = (role: string, scopes: string[]) => {
      const tools: McpTools = Object.assign(Object.create(McpTools.prototype) as object, { db: {}, joshActions: {}, oauth: {} }) as unknown as McpTools;
      return Object.keys((tools.server({ userId: 's', email: 'e', role } as never, 'c', scopes) as unknown as { _registeredTools: object })._registeredTools);
    };
    expect(names('marketing', [MCP_WRITE_SCOPE])).not.toContain('product_content_save');
    expect(names('marketing', [])).toEqual(expect.arrayContaining(['marketing_list', 'marketing_fields']));
    expect(names('marketing', [])).not.toContain('marketing_save');
  });
});
