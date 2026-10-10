import { WebhookSubscriptionService } from './webhook-subscription.service';

function setup(row: Record<string, unknown>) {
  const deliveries = { findOne: jest.fn(async () => row), save: jest.fn(async (d: unknown) => d) };
  const eventQueue = { add: jest.fn(async () => undefined) };
  const marketingQueue = { add: jest.fn(async () => undefined) };
  const svc = new WebhookSubscriptionService({} as never, deliveries as never, eventQueue as never, marketingQueue as never);
  return { svc, eventQueue, marketingQueue };
}

describe('WebhookSubscriptionService.retryDelivery', () => {
  it('sends a failed event delivery back to the subscription queue', async () => {
    const s = setup({ id: 'd1', kind: 'event', status: 'failed', attempts: 200 });
    await s.svc.retryDelivery('d1');
    expect(s.eventQueue.add).toHaveBeenCalled();
    expect(s.marketingQueue.add).not.toHaveBeenCalled();
  });

  it('sends a failed marketing webhook to the marketing queue with a fresh job id (the old failed job is kept by BullMQ)', async () => {
    const s = setup({ id: 'd2', kind: 'marketing', status: 'failed', attempts: 20 });
    const saved = await s.svc.retryDelivery('d2');
    expect(saved).toMatchObject({ status: 'pending', attempts: 0 });
    expect(s.eventQueue.add).not.toHaveBeenCalled();
    const [, data, opts] = s.marketingQueue.add.mock.calls[0] as unknown as [string, unknown, { jobId: string }];
    expect(data).toEqual({ deliveryId: 'd2' });
    expect(opts.jobId).toMatch(/^wh_d2_\d+$/);
  });
});
