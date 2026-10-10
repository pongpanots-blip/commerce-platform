import { UnrecoverableError } from 'bullmq';
import { MARKETING_WEBHOOK_MAX_ATTEMPTS, MarketingWebhookWorker } from './marketing-webhook.worker';

const SID = '11111111-1111-4111-8111-111111111111';
function setup(row: Record<string, unknown> | null) {
  const saved: Record<string, unknown>[] = [];
  const deliveries = { findOne: jest.fn(async () => row), save: jest.fn(async (d: Record<string, unknown>) => { saved.push({ ...d }); return d; }) };
  const secrets = { configured: () => true, resolve: jest.fn(async () => new Map([[SID, 'Bearer s3cr3t']])) };
  return { worker: new MarketingWebhookWorker(deliveries as never, secrets as never), saved };
}
const row = (over: object = {}) => ({ id: 'd1', kind: 'marketing', status: 'pending', attempts: 0, method: 'POST', targetUrl: 'https://93.184.216.34/h',
  headers: [{ key: 'Authorization', value: `{{secret:${SID}}}` }], payload: '{"a":1}', statusCode: null, error: null, ...over });
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe('MarketingWebhookWorker', () => {
  it('marks success', async () => {
    global.fetch = jest.fn(async () => ({ status: 200, ok: true, text: async () => '' })) as never;
    const { worker, saved } = setup(row());
    await worker.handle('d1');
    expect(saved.at(-1)).toMatchObject({ status: 'success', statusCode: 200, attempts: 1 });
  });
  it('keeps a 5xx pending for retry, then fails at the last attempt', async () => {
    global.fetch = jest.fn(async () => ({ status: 503, ok: false, text: async () => '' })) as never;
    const a = setup(row());
    await expect(a.worker.handle('d1')).rejects.toThrow('http_503');
    expect(a.saved.at(-1)).toMatchObject({ status: 'pending', error: 'http_503' });
    const b = setup(row({ attempts: MARKETING_WEBHOOK_MAX_ATTEMPTS - 1 }));
    await expect(b.worker.handle('d1')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(b.saved.at(-1)).toMatchObject({ status: 'failed' });
  });
  it('fails a blocked URL at once and never stores the secret', async () => {
    global.fetch = jest.fn() as never;
    const { worker, saved } = setup(row({ targetUrl: 'http://169.254.169.254/latest' }));
    await expect(worker.handle('d1')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(saved.at(-1)).toMatchObject({ status: 'failed', error: 'blocked_url' });
    expect(JSON.stringify(saved)).not.toContain('s3cr3t');
  });
  it('ignores rows that are not pending marketing deliveries', async () => {
    global.fetch = jest.fn() as never;
    await setup(null).worker.handle('d1');
    await setup(row({ status: 'success' })).worker.handle('d1');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
