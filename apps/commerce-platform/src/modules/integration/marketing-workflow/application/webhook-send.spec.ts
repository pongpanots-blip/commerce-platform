import { sendWebhook, WebhookSendError } from './webhook-send';

const SID = '11111111-1111-4111-8111-111111111111';
const pub = async () => [{ address: '93.184.216.34' }];
const res = (status: number, body = 'ok') => ({ status, ok: status >= 200 && status < 300, text: async () => body }) as unknown as Response;
const req = { method: 'POST' as const, url: 'https://hooks.example/a', headers: [{ key: 'Authorization', value: `{{secret:${SID}}}` }], body: '{"a":1}', deliveryId: 'd1' };

describe('sendWebhook', () => {
  it('swaps in the secret, adds JSON content-type and the delivery id, never follows redirects', async () => {
    const fetchImpl = jest.fn(async () => res(200, 'fine'));
    await expect(sendWebhook(req, new Map([[SID, 'Bearer s3cr3t']]), { fetchImpl, resolve: pub })).resolves.toEqual({ status: 200, body: 'fine' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer s3cr3t', 'Content-Type': 'application/json', 'x-delivery-id': 'd1' });
    expect(init.redirect).toBe('manual');
  });
  it('fails without retry on a missing secret, a blocked URL, a redirect or a 4xx', async () => {
    const f = jest.fn(async () => res(200));
    await expect(sendWebhook(req, new Map(), { fetchImpl: f, resolve: pub })).rejects.toMatchObject({ code: 'secret_missing', retryable: false });
    await expect(sendWebhook({ ...req, url: 'http://10.0.0.1/' }, new Map([[SID, 'x']]), { fetchImpl: f })).rejects.toMatchObject({ code: 'blocked_url', retryable: false });
    await expect(sendWebhook(req, new Map([[SID, 'x']]), { fetchImpl: async () => res(302), resolve: pub })).rejects.toMatchObject({ code: 'redirect_not_followed' });
    await expect(sendWebhook(req, new Map([[SID, 'x']]), { fetchImpl: async () => res(404), resolve: pub })).rejects.toMatchObject({ code: 'http_404', retryable: false });
    expect(f).not.toHaveBeenCalled();
  });
  it('retries 5xx / 429 / network errors, and the error never contains the secret', async () => {
    const e1 = await sendWebhook(req, new Map([[SID, 'Bearer s3cr3t']]), { fetchImpl: async () => res(503), resolve: pub }).catch((e) => e);
    expect(e1).toBeInstanceOf(WebhookSendError);
    expect(e1).toMatchObject({ code: 'http_503', retryable: true, status: 503 });
    const e2 = await sendWebhook(req, new Map([[SID, 'Bearer s3cr3t']]), { fetchImpl: async () => { throw new Error('ECONNRESET Bearer s3cr3t'); }, resolve: pub }).catch((e) => e);
    expect(e2).toMatchObject({ code: 'network_error', retryable: true });
    expect(JSON.stringify(e2) + String(e2.message)).not.toContain('s3cr3t');
  });
  it('sends no body for GET', async () => {
    const fetchImpl = jest.fn(async () => res(200));
    await sendWebhook({ ...req, method: 'GET', headers: [] }, new Map(), { fetchImpl, resolve: pub });
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBeUndefined();
  });
});
