import { createHmac } from 'node:crypto';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
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

  it('does nothing when josh is not connected', async () => {
    delete process.env.JOSH_EVENTS_SECRET;
    global.fetch = jest.fn() as never;
    await expect(actions.run('push-campaigns', 'send', { id: 'x' }, actor, 'admin')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
