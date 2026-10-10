import { DataSource } from 'typeorm';
import { WorkflowAnalyticsService } from './workflow-analytics.service';

/** Opt-in: MARKETING_TEST_DATABASE_URL=postgres:///<migrated db> (never a shared / prod DB). */
const url = process.env.MARKETING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('WorkflowAnalyticsService (real DB)', () => {
  let db: DataSource; let svc: WorkflowAnalyticsService; let wf: string;
  const U = '33333333-3333-4333-8333-333333333333';
  beforeAll(async () => {
    db = await new DataSource({ type: 'postgres', url }).initialize();
    svc = new WorkflowAnalyticsService(db);
    [{ id: wf }] = await db.query(`INSERT INTO marketing_workflows (name, trigger_type) VALUES ('analytics-spec', 'first_login') RETURNING id`);
    const add = async (key: string, over: string) => (await db.query(`INSERT INTO marketing_workflow_enrollments (workflow_id, user_id, occurrence_key, status ${over ? ', ' + over.split('=')[0] : ''})
      VALUES ($1, $2, $3, 'completed' ${over ? ', ' + over.split('=')[1] : ''}) RETURNING id`, [wf, U, key]))[0].id;
    const a = await add('a', ''); const b = await add('b', 'converted_at=now()'); await add('h', 'is_holdout=true'); await add('t', 'is_test=true');
    for (const [e, branch] of [[a, 'A'], [b, 'B']]) {
      await db.query(`INSERT INTO marketing_workflow_action_logs (enrollment_id, step_id, kind, status, meta) VALUES ($1, 's1', 'split', 'sent', $2::jsonb)`, [e, JSON.stringify({ branchId: branch })]);
      await db.query(`INSERT INTO marketing_workflow_action_logs (enrollment_id, step_id, kind, status) VALUES ($1, 's2', 'notify', 'queued')`, [e]);
    }
  });
  afterAll(async () => { await db.query(`DELETE FROM marketing_workflows WHERE id = $1`, [wf]); await db.destroy(); });

  it('counts per branch, holdout vs treated, actions, and leaves test runs out', async () => {
    const steps = [{ id: 's1', type: 'split' as const, branches: [{ id: 'A', label: 'A', percent: 50, nextId: null }, { id: 'B', label: 'B', percent: 50, nextId: null }] }];
    const r = await svc.analytics(wf, steps);
    expect(r.counts).toMatchObject({ enrolled: 3, converted: 1, holdout: 1 });
    expect(r.splits[0].branches).toEqual([{ branchId: 'A', label: 'A', entered: 1, converted: 0 }, { branchId: 'B', label: 'B', entered: 1, converted: 1 }]);
    expect(r.actions).toEqual([{ kind: 'notify', status: 'queued', count: 2 }]);
    expect(r.treated).toEqual({ enrolled: 2, converted: 1 });
    const page = await svc.enrollments(wf, 1);
    expect(page.total).toBe(4);
  });
});
