import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JoshMarketingWorkflowsController } from './josh-marketing-workflows.controller';
import { JoshMarketingWorkflows } from './josh-marketing-workflows';

describe('JoshMarketingWorkflowsController', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const req = { staff: { userId: 'staff-1', email: 'mkt@jagota.co.th' } } as never;

  it('activate / pause / update go to josh; nothing else (no test-send)', async () => {
    const josh = { run: jest.fn(async () => ({})) };
    const c = new JoshMarketingWorkflowsController({ available: true } as never, josh as never);
    await c.setState(ID, 'activate', req);
    await c.setState(ID, 'pause', req);
    await c.update(ID, { workflow: { name: 'x' } }, req);
    expect(() => c.setState(ID, 'test', req)).toThrow(BadRequestException);
    expect(josh.run.mock.calls.map((call) => (call as unknown[]).slice(0, 3))).toEqual([
      ['marketing-workflows', 'activate', { id: ID }],
      ['marketing-workflows', 'pause', { id: ID }],
      ['marketing-workflows', 'update', { id: ID, workflow: { name: 'x' } }],
    ]);
  });
});

describe('JoshMarketingWorkflows MARKETING_WORKFLOWS_SOURCE=copies (stage 5, S5-12)', () => {
  const env = process.env.MARKETING_WORKFLOWS_SOURCE;
  afterEach(() => { if (env === undefined) delete process.env.MARKETING_WORKFLOWS_SOURCE; else process.env.MARKETING_WORKFLOWS_SOURCE = env; });
  const ID = '11111111-1111-4111-8111-111111111111';
  const make = () => {
    const replica = { configured: false, query: jest.fn() };
    const db = { query: jest.fn(async (): Promise<unknown[]> => []) };
    return { replica, db, wf: new JoshMarketingWorkflows(replica as never, db as never) };
  };

  it('list sums the day buckets of the copy, without the replica', async () => {
    process.env.MARKETING_WORKFLOWS_SOURCE = 'copies';
    const { replica, db, wf } = make();
    expect(wf.available).toBe(true);
    await wf.list(7);
    expect(replica.query).not.toHaveBeenCalled();
    const [sql, params] = db.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('FROM josh_marketing_workflows w');
    expect(sql).toContain('jsonb_array_elements(w.enrollments_by_day)');
    expect(params).toEqual([7]);
  });

  it('detail answers the replica shape from the copy; a missing row is 404', async () => {
    process.env.MARKETING_WORKFLOWS_SOURCE = 'copies';
    const { db, wf } = make();
    db.query.mockResolvedValueOnce([{ workflow: { id: ID, name: 'W' }, enrollments_by_status: [{ status: 'failed', n: 1 }], recent_runs: [], recent_failures: [] }]);
    expect(await wf.detail(ID)).toEqual({ id: ID, name: 'W', enrollmentsByStatus: [{ status: 'failed', n: 1 }], recentRuns: [], recentFailures: [] });
    await expect(wf.detail(ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('replica stays the default, and a caller can ask for the copy explicitly', async () => {
    const { replica, db, wf } = make();
    expect(wf.available).toBe(false);
    await wf.list(30, 'copies');
    expect(db.query).toHaveBeenCalled();
    expect(replica.query).not.toHaveBeenCalled();
  });
});
