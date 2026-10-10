import { DataSource } from 'typeorm';
import { MarketingWorkflowRow } from './marketing-workflow.entity';
import { WorkflowStore } from './workflow.store';

/** Opt-in: MARKETING_TEST_DATABASE_URL=postgres:///<migrated db> (never a shared / prod DB). */
const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('WorkflowStore (real DB)', () => {
  let db: DataSource; let store: WorkflowStore; let wf: string;
  const U = '11111111-1111-4111-8111-111111111111';
  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url, entities: [MarketingWorkflowRow] }).initialize();
    store = new WorkflowStore(db);
    [{ id: wf }] = await db.query(`INSERT INTO marketing_workflows (name, trigger_type) VALUES ('db-spec', 'first_login') RETURNING id`);
  });
  afterAll(async () => { await db.query(`DELETE FROM marketing_workflows WHERE id = $1`, [wf]); await db.destroy(); });

  it('enrolls once per occurrence, locks, parks and finishes', async () => {
    const id = await store.insertEnrollment({ workflowId: wf, userId: U, occurrenceKey: 'once', entryStepId: 's1', holdout: false, test: false, skipWaits: false });
    expect(id).toBeTruthy();
    expect(await store.insertEnrollment({ workflowId: wf, userId: U, occurrenceKey: 'once', entryStepId: 's1', holdout: false, test: false, skipWaits: false })).toBeNull();
    await db.transaction(async (m) => {
      const e = await store.lockDue(m, id!);
      expect(e).toMatchObject({ currentStepId: 's1', status: 'pending' });
      await store.park(m, id!, 's2', new Date(Date.now() + 60_000));
    });
    await db.transaction(async (m) => expect(await store.lockDue(m, id!)).toBeNull());
    await db.transaction((m) => store.finish(m, id!, 'completed', null));
    const [row] = await db.query(`SELECT status, current_step_id FROM marketing_workflow_enrollments WHERE id = $1`, [id]);
    expect(row).toEqual({ status: 'completed', current_step_id: null });
  });

  it('records a holdout as completed at insert', async () => {
    const id = await store.insertEnrollment({ workflowId: wf, userId: U, occurrenceKey: 'holdout', entryStepId: 's1', holdout: true, test: false, skipWaits: false });
    const [row] = await db.query(`SELECT status, end_reason, current_step_id, completed_at IS NOT NULL AS done FROM marketing_workflow_enrollments WHERE id = $1`, [id]);
    expect(row).toEqual({ status: 'completed', end_reason: 'holdout', current_step_id: null, done: true });
  });

  it('inserts one webhook delivery per enrollment + step', async () => {
    const d1 = await db.transaction((m) => store.insertWebhookDelivery(m, { idempotencyKey: `cmw:${wf}:s3`, url: 'https://h.co', method: 'POST', headers: [], body: '{}' }));
    const d2 = await db.transaction((m) => store.insertWebhookDelivery(m, { idempotencyKey: `cmw:${wf}:s3`, url: 'https://h.co', method: 'POST', headers: [], body: '{}' }));
    expect(d2).toBe(d1);
    const [row] = await db.query(`SELECT kind, subscription_id, payload FROM webhook_deliveries WHERE id = $1`, [d1]);
    expect(row).toEqual({ kind: 'marketing', subscription_id: null, payload: '{}' });
    await db.query(`DELETE FROM webhook_deliveries WHERE id = $1`, [d1]);
  });

  it('counts queued notifies today and logs actions', async () => {
    const id = await store.insertEnrollment({ workflowId: wf, userId: U, occurrenceKey: 'cap', entryStepId: null, holdout: false, test: false, skipWaits: false });
    await db.transaction(async (m) => {
      await store.log(m, id!, 's1', 'notify', 'queued', { templateKey: 'x' });
      expect(await store.notifiesQueuedToday(m, U)).toBeGreaterThanOrEqual(1);
    });
  });
});
