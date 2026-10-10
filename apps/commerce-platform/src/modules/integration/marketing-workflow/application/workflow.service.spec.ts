import { UnprocessableEntityException } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { workflowInputSchema } from '../presentation/workflow.schemas';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const valid = { name: 'W', triggerType: 'first_login', triggerConfig: {}, entryStepId: id(1), graphUi: null, cooldownDays: 0, holdoutPercent: 0,
  conversionWindowDays: 7, exitOnGoal: null, schedule: null,
  steps: [{ id: id(1), type: 'action', action: { kind: 'notify', channels: ['push'], templateKey: 'custom_a' }, nextId: null }] };

function setup(row: Record<string, unknown> | null = null) {
  const saved: Record<string, unknown>[] = [];
  const workflows = {
    save: jest.fn(async (r: Record<string, unknown>) => { const out = { id: 'wf1', status: 'draft', createdAt: new Date(), updatedAt: new Date(), ...row, ...r }; saved.push(out); return out; }),
    findOneBy: jest.fn(async () => row), find: jest.fn(async () => []), delete: jest.fn(),
  };
  const revisions = { save: jest.fn(async (r: unknown) => r), find: jest.fn(async () => []) };
  const segments = { evaluableSegments: jest.fn(async () => [{ id: id(9), name: 'VIP', memberCount: 3 }]) };
  const rules = { context: jest.fn(async () => ({ catalog: new Map(), coverageStart: null, segmentIds: new Set<string>(), now: new Date() })) };
  const dynamic = { list: jest.fn(async () => []) };
  const svc = new WorkflowService(workflows as never, revisions as never, segments as never, { query: jest.fn(async () => []) } as never, rules as never, dynamic as never);
  return { svc, saved, revisions };
}

describe('WorkflowService', () => {
  it('the editor payload with event steps parses', () => {
    const steps = [{ id: id(1), type: 'wait_event', eventName: 'purchase', filters: [{ key: 'order_id', op: 'eq', value: { fromTrigger: 'order_id' } }],
      timeoutHours: 2, matchedNextId: null, timeoutNextId: null },
      { id: id(2), type: 'event_split', rule: { op: 'AND', children: [{ kind: 'segment', segmentId: id(3) }] }, yesNextId: null, noNextId: null }];
    expect(workflowInputSchema.safeParse({ ...valid, triggerType: 'event', triggerConfig: { eventName: 'add_to_cart', filters: [], includeGuests: true },
      entryStepId: id(1), steps, exitOnGoal: { kind: 'event', eventName: 'purchase', filters: [] } }).success).toBe(true);
  });

  it('the editor payload shape parses', () => expect(workflowInputSchema.safeParse(valid).success).toBe(true));
  it('saves a draft with issues and records a revision', async () => {
    const { svc, revisions } = setup();
    const wf = await svc.create({ ...valid, entryStepId: null } as never, 'a@x');
    expect(wf.issues.map((i) => i.code)).toContain('no_entry');
    expect(revisions.save).toHaveBeenCalledTimes(1);
  });
  it('refuses to activate an invalid flow with its issues', async () => {
    const { svc } = setup({ ...valid, id: 'wf1', status: 'draft', entryStepId: null });
    await expect(svc.activate('wf1', 'a@x')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
  it('activates and stamps activatedAt', async () => {
    const { svc, saved } = setup({ ...valid, id: 'wf1', status: 'draft' });
    await svc.activate('wf1', 'a@x');
    expect(saved.at(-1)).toMatchObject({ status: 'active', activatedAt: expect.any(Date) });
  });
  it('refuses an audience segment commerce cannot evaluate', async () => {
    const steps = [{ id: id(2), type: 'audience', segmentIds: [id(8)], nextId: id(1) }, ...valid.steps];
    const { svc } = setup({ ...valid, id: 'wf1', status: 'draft', steps, entryStepId: id(2) });
    await expect(svc.activate('wf1', 'a@x')).rejects.toMatchObject({ response: { issues: [expect.objectContaining({ code: 'audience_segment' })] } });
  });
  it('keeps an active workflow valid on update', async () => {
    const { svc } = setup({ ...valid, id: 'wf1', status: 'active' });
    await expect(svc.update('wf1', { ...valid, entryStepId: null } as never, 'a@x')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
  it('will not delete an active workflow', async () => {
    const { svc } = setup({ ...valid, id: 'wf1', status: 'active' });
    await expect(svc.remove('wf1')).rejects.toThrow('หยุด workflow ก่อนลบ');
  });
});
