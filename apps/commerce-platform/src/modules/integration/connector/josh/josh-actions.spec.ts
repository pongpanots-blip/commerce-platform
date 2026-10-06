import { createHash, createHmac } from 'node:crypto';
import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { JoshActions } from './josh-actions';

describe('JoshActions (commerce asks josh to act)', () => {
  const OLD = process.env;
  const realFetch = global.fetch;
  let insert: jest.Mock;
  let actions: JoshActions;
  const actor = { userId: 'staff-1', email: 'mgr@jagota.test' };

  beforeEach(() => {
    process.env = { ...OLD, JOSH_API_URL: 'http://josh.test/api/', JOSH_EVENTS_SECRET: 's3cret' };
    insert = jest.fn();
    actions = new JoshActions({ getRepository: () => ({ insert }) } as never);
  });
  afterAll(() => { process.env = OLD; global.fetch = realFetch; });

  it('signs the whole envelope (action, args, actor, time, nonce) and audits the call', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"id":"a1"}' }) as never;
    await expect(actions.run('winback', 'assign', { accountId: 'a1', assignedSalesUserId: null }, actor, 'admin')).resolves.toEqual({ id: 'a1' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://josh.test/api/internal/commerce/winback');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ action: 'assign', args: { accountId: 'a1', assignedSalesUserId: null }, actorEmail: 'mgr@jagota.test' });
    expect(body.nonce).toHaveLength(36);
    expect(Math.abs(Date.parse(body.at) - Date.now())).toBeLessThan(5000);
    expect(init.headers['x-signature']).toBe(createHmac('sha256', 's3cret').update(init.body).digest('hex'));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'staff-1', action: 'josh.winback.assign', context: { via: 'admin', email: 'mgr@jagota.test', joshStatus: 200 } }));
  });

  it('passes josh\'s refusal on with josh\'s message, and still audits it', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '{"message":"เฉพาะ manager ที่ตั้งเป้ายอดขายได้"}' }) as never;
    await expect(actions.run('winback', 'set_target', {}, actor, 'admin')).rejects.toThrow(ForbiddenException);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ context: expect.objectContaining({ joshStatus: 403 }) }));
  });

  it('a josh 400 keeps the clashing SKUs (promotion SKU check) next to the message', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '{"message":"SKU ซ้ำกับโปรอื่นใน campaign เดียวกัน","duplicate_skus":["A1","B2"]}' }) as never;
    const err = await actions.run('promotions', 'update', {}, actor, 'admin').catch((e: BadRequestException) => e) as BadRequestException;
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toEqual({ message: 'josh: SKU ซ้ำกับโปรอื่นใน campaign เดียวกัน', duplicate_skus: ['A1', 'B2'] });
  });

  it('upload: multipart to /admin-call/upload, envelope in a header signed with each file\'s sha256; audit keeps no file bytes', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"status":200,"data":{"ok":true}}' }) as never;
    const bytes = Buffer.from('video-bytes');
    await actions.upload({ method: 'POST', path: '/product/video-upload', body: { skus: 'A1' } }, [{ field: 'video', filename: 'v.mp4', contentType: 'video/mp4', bytes }], actor, 'admin');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://josh.test/api/internal/commerce/admin-call/upload');
    expect(init.body).toBeInstanceOf(FormData);
    const text = Buffer.from(init.headers['x-commerce-envelope'], 'base64url').toString('utf8');
    expect(init.headers['x-signature']).toBe(createHmac('sha256', 's3cret').update(text).digest('hex'));
    expect(JSON.parse(text).args.streamedFiles).toEqual([{ field: 'video', filename: 'v.mp4', contentType: 'video/mp4', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]);
    expect(JSON.stringify(insert.mock.calls[0][0])).not.toContain(bytes.toString('base64'));
  });

  it('does nothing when josh is not connected', async () => {
    delete process.env.JOSH_EVENTS_SECRET;
    global.fetch = jest.fn() as never;
    await expect(actions.run('push-campaigns', 'send', { id: 'x' }, actor, 'admin')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['marketing-workflows', 'activate', { id: '22222222-2222-4222-8222-222222222222' }],
    ['admin-call', 'call', { method: 'POST', path: '/marketing-workflows/22222222-2222-4222-8222-222222222222/activate' }],
    ['admin-call', 'call', { method: 'POST', path: '/marketing-workflows/22222222-2222-4222-8222-222222222222/test', body: { dryRun: false } }],
  ])('blocks Growth sending through %s/%s before any external mutation', async (target, action, args) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ status: 200, data: { data: {
      name: 'Growth [11111111-1111-4111-8111-111111111111:v3] Campaign', status: 'draft',
    } } }) }) as never;
    await expect(actions.run(target as 'marketing-workflows' | 'admin-call', action, args, actor, 'mcp')).rejects.toBeInstanceOf(ForbiddenException);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).args.method).toBe('GET');
  });
  it('does not let another marketing user change a marked workflow or invalidate its approval', async () => {
    const plan = { createdBy: 'another-owner', workflowId: '22222222-2222-4222-8222-222222222222', status: 'ready', version: 3 };
    const manager = { findOne: jest.fn().mockResolvedValueOnce(plan).mockResolvedValueOnce({ role: 'marketing', status: 'active' }), save: jest.fn() };
    actions = new JoshActions({ getRepository: () => ({ insert }), transaction: async (fn: (m: unknown) => unknown) => fn(manager) } as never);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ status: 200, data: { data: {
      name: 'Growth [11111111-1111-4111-8111-111111111111:v3] Campaign', status: 'draft',
    } } }) }) as never;
    await expect(actions.run('marketing-workflows', 'update', { id: plan.workflowId, workflow: { steps: [] } }, actor, 'admin')).rejects.toBeInstanceOf(ForbiddenException);
    expect(manager.save).not.toHaveBeenCalled(); expect(global.fetch).toHaveBeenCalledTimes(1); expect(plan.version).toBe(3);
  });
});
