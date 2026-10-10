import { WorkflowSweep } from './workflow-sweep';

function setup() {
  const store = { dueEnrollmentIds: jest.fn(async () => ['e1', 'e2']), stalePendingWebhookIds: jest.fn(async () => ['d1']) };
  const queue = { step: jest.fn(), webhook: jest.fn() };
  let release!: () => void;
  const triggers = { runScheduled: jest.fn(() => new Promise<void>((r) => { release = r; })) };
  return { sweep: new WorkflowSweep(store as never, queue as never, triggers as never), store, queue, triggers, release: () => release() };
}

describe('WorkflowSweep', () => {
  afterEach(() => { delete process.env.CRON_MARKETING_WORKFLOW_ENABLED; });

  it('re-queues due enrollments and stale webhooks, runs scheduled triggers, never overlaps itself', async () => {
    const s = setup();
    const first = s.sweep.tick();
    await new Promise((r) => setImmediate(r)); // first tick is now inside runScheduled
    await s.sweep.tick(); // still running → skipped
    s.release();
    await first;
    expect(s.queue.step.mock.calls.map((c) => c[0])).toEqual(['e1', 'e2']);
    expect(s.queue.webhook).toHaveBeenCalledWith('d1');
    expect(s.triggers.runScheduled).toHaveBeenCalledTimes(1);
  });

  it('does nothing when switched off', async () => {
    process.env.CRON_MARKETING_WORKFLOW_ENABLED = 'false';
    const s = setup();
    await s.sweep.tick();
    expect(s.store.dueEnrollmentIds).not.toHaveBeenCalled();
  });
});
