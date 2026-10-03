import { UnrecoverableError } from 'bullmq';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';

function makeWorker(delivery: Record<string, unknown>, newerSuccess = 0) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(newerSuccess),
  };
  const deliveries = {
    findOne: jest.fn().mockResolvedValue(delivery),
    save: jest.fn(async (d) => d),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  };
  const subs = { findOne: jest.fn().mockResolvedValue({ id: 's-1', secret: 'shh' }) };
  return { worker: new WebhookDeliveryWorker(deliveries as never, subs as never), deliveries, qb };
}

const base = () => ({
  id: 'd-1', subscriptionId: 's-1', eventType: 'inventory.qty.changed', targetUrl: 'https://josh/x',
  payload: { type: 'inventory.qty.changed', aggregateId: 'p-1', data: {}, snapshot: true },
  status: 'pending', attempts: 0, createdAt: new Date(),
});

describe('WebhookDeliveryWorker', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const respond = (status: number) => { global.fetch = jest.fn().mockResolvedValue({ ok: status < 300, status }) as never; };

  it('marks success on 2xx and signs the body', async () => {
    respond(200);
    const d = base();
    const { worker } = makeWorker(d);
    await worker.handle('d-1');
    expect(d.status).toBe('success');
    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(headers['x-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['x-delivery-id']).toBe('d-1');
  });

  it('does not retry a 4xx — subscriber rejected the payload', async () => {
    respond(422);
    const d = base();
    const { worker } = makeWorker(d);
    await expect(worker.handle('d-1')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(d.status).toBe('failed');
  });

  it('retries 5xx (throws a normal error, stays pending until the last attempt)', async () => {
    respond(503);
    const d = base();
    const { worker } = makeWorker(d);
    await expect(worker.handle('d-1')).rejects.not.toBeInstanceOf(UnrecoverableError);
    expect(d.status).toBe('pending');
    expect(d.attempts).toBe(1);
  });

  it('retries 429 like a 5xx', async () => {
    respond(429);
    const { worker } = makeWorker(base());
    await expect(worker.handle('d-1')).rejects.not.toBeInstanceOf(UnrecoverableError);
  });

  it('drops an older snapshot once a newer one for the same aggregate succeeded', async () => {
    global.fetch = jest.fn() as never;
    const d = base();
    const { worker } = makeWorker(d, 1);
    await worker.handle('d-1');
    expect(d.status).toBe('superseded');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('never supersedes non-snapshot events', async () => {
    respond(200);
    const d = { ...base(), payload: { type: 'order.created', aggregateId: 'o-1', data: {} } };
    const { worker, deliveries } = makeWorker(d, 1);
    await worker.handle('d-1');
    expect(deliveries.createQueryBuilder).not.toHaveBeenCalled();
    expect(d.status).toBe('success');
  });
});
