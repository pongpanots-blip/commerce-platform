import { CsCrmRelayController } from './cs-crm-relay.controller';

const resMock = () => {
  const r = { code: 0, headers: {} as Record<string, string>, body: undefined as unknown,
    status(c: number) { r.code = c; return r; }, setHeader(k: string, v: string) { r.headers[k] = v; },
    json(b: unknown) { r.body = b; return r; }, type() { return r; }, send(b: unknown) { r.body = b; return r; } };
  return r;
};

describe('CsCrmRelayController', () => {
  const OLD = process.env;
  const realFetch = global.fetch;
  beforeEach(() => { process.env = { ...OLD, LIVECHAT_CS_CRM_BASE_URL: 'http://cscrm.test/api', LIVECHAT_API_KEY: 'k' }; });
  afterEach(() => { process.env = OLD; global.fetch = realFetch; });

  it('KYC and agent replies are relayed to josh as CS-CRM events and logged', async () => {
    const relay = { relay: jest.fn(async () => undefined) };
    const logs = { insert: jest.fn(async () => undefined) };
    const c = new CsCrmRelayController(relay as never, logs as never);
    await c.kyc({ documentId: 'd-1', status: 'approved' });
    await c.outbound({ visitorId: 'v-1', externalMessageId: 'm-1', text: 'สวัสดีค่ะ' } as never);
    expect(relay.relay.mock.calls.map((x) => (x as unknown[])[0])).toEqual(['cs.kyc.decided', 'cs.livechat.outbound']);
    expect(logs.insert).toHaveBeenCalledWith(expect.objectContaining({ direction: 'to_shop', visitorId: 'v-1', text: 'สวัสดีค่ะ' }));
  });

  it('shop chat → CS-CRM: relays the answer with the mark; CS-CRM down = no mark (josh goes direct)', async () => {
    const logs = { insert: jest.fn(async () => undefined) };
    const c = new CsCrmRelayController({} as never, logs as never);
    global.fetch = jest.fn(async () => ({ status: 201, text: async () => '{"created":1}' })) as never;
    const req = { method: 'POST', path: '/api/v1/storefront/livechat/integrations/livechat/chat-messages', url: '/x', body: { messages: [{ visitorId: 'v-1', text: 'มีของไหม' }] } } as never;
    const r1 = resMock();
    await c.toCsCrm(req, r1 as never);
    expect([r1.code, r1.headers['x-livechat-relay'], r1.body]).toEqual([201, '1', '{"created":1}']);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://cscrm.test/api/integrations/livechat/chat-messages');
    expect(logs.insert).toHaveBeenCalledWith(expect.objectContaining({ direction: 'to_cs_crm', text: 'มีของไหม', status: 201 }));
    global.fetch = jest.fn(async () => { throw new Error('timeout'); }) as never;
    const r2 = resMock();
    await c.toCsCrm(req, r2 as never);
    expect([r2.code, r2.headers['x-livechat-relay']]).toEqual([502, undefined]);
    const r3 = resMock();
    await c.toCsCrm({ ...(req as object), path: '/api/v1/storefront/livechat/admin/users' } as never, r3 as never);
    expect(r3.code).toBe(404);
  });
});
