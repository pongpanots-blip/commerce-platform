import { describe, expect, it } from 'vitest';
import { addLoose, autoLayout, connect, disconnect, firstFreePort, insertAfter, newStep, removeStep, tailOfMain, targetOf, TRIGGER, type Graph } from './workflow-graph';

let n = 0;
const fresh = (kind: Parameters<typeof newStep>[0]) => newStep(kind, `id${++n}`);
const empty: Graph = { entryStepId: null, steps: [] };

describe('workflow-graph', () => {
  it('inserts after the trigger, then between two steps', () => {
    const a = fresh('push'); const b = fresh('email');
    let g = insertAfter(empty, { stepId: TRIGGER }, a);
    expect(g.entryStepId).toBe(a.id);
    g = insertAfter(g, { stepId: TRIGGER }, b);
    expect(g.entryStepId).toBe(b.id);
    expect(targetOf(g, { stepId: b.id })).toBe(a.id);
  });

  it('inserts on a condition / split port and chains the old target behind the new step', () => {
    const c = fresh('condition'); const x = fresh('push'); const y = fresh('webhook');
    let g = insertAfter(empty, { stepId: TRIGGER }, c);
    g = insertAfter(g, { stepId: c.id, port: 'no' }, x);
    g = insertAfter(g, { stepId: c.id, port: 'no' }, y);
    expect(targetOf(g, { stepId: c.id, port: 'no' })).toBe(y.id);
    expect(targetOf(g, { stepId: y.id })).toBe(x.id);
    expect(firstFreePort(g, c.id)).toEqual({ stepId: c.id, port: 'yes' });
    const s = fresh('split');
    g = insertAfter(g, { stepId: c.id, port: 'no' }, s); // branch A takes over the old 'no' target (y)
    expect(targetOf(g, { stepId: s.id })).toBe(y.id);
    const branchB = (g.steps.find((st) => st.id === s.id) as { branches: { id: string }[] }).branches[1].id;
    expect(firstFreePort(g, s.id)).toEqual({ stepId: s.id, port: branchB });
  });

  it('removes a step and reconnects around single-exit steps', () => {
    const a = fresh('push'); const b = fresh('wait'); const c = fresh('email');
    let g = insertAfter(insertAfter(insertAfter(empty, { stepId: TRIGGER }, c), { stepId: TRIGGER }, b), { stepId: TRIGGER }, a);
    g = removeStep(g, b.id);
    expect(targetOf(g, { stepId: a.id })).toBe(c.id);
    g = removeStep(g, a.id);
    expect(g.entryStepId).toBe(c.id);
  });

  it('removing a branching step ends the pointers into it', () => {
    const c = fresh('condition'); const a = fresh('push');
    let g = insertAfter(insertAfter(empty, { stepId: TRIGGER }, a), { stepId: TRIGGER }, c);
    g = removeStep(g, c.id);
    expect(g.entryStepId).toBeNull();
  });

  it('connect refuses self-loops; disconnect clears a port; loose steps stay unconnected', () => {
    const a = fresh('push');
    let g = addLoose(empty, a);
    expect(g.entryStepId).toBeNull();
    expect(connect(g, { stepId: a.id }, a.id)).toBe(g);
    g = connect(g, { stepId: TRIGGER }, a.id);
    expect(g.entryStepId).toBe(a.id);
    expect(disconnect(g, { stepId: TRIGGER }).entryStepId).toBeNull();
  });

  it('finds the end of the main path and lays out by depth', () => {
    const a = fresh('push'); const b = fresh('email');
    const g = insertAfter(insertAfter(empty, { stepId: TRIGGER }, b), { stepId: TRIGGER }, a);
    expect(tailOfMain(g)).toEqual({ stepId: b.id, port: undefined });
    const pos = autoLayout(g);
    expect(pos[TRIGGER].x).toBeLessThan(pos[a.id].x);
    expect(pos[a.id].x).toBeLessThan(pos[b.id].x);
  });

  it('makes the right step for each palette kind', () => {
    expect(newStep('email', 'x')).toMatchObject({ type: 'action', action: { kind: 'notify', channels: ['email'] } });
    expect(newStep('grant_coupon', 'x')).toMatchObject({ type: 'action', action: { kind: 'grant_coupon' } });
    const split = newStep('split', 'x') as { branches: { percent: number }[] };
    expect(split.branches.map((b) => b.percent)).toEqual([50, 50]);
  });
  it('wait_event and event_split have two ports; removing them ends what pointed at them', () => {
    const w = fresh('wait_event'); const a = fresh('push'); const b = fresh('email');
    let g = insertAfter(empty, { stepId: TRIGGER }, w);
    g = insertAfter(g, { stepId: w.id, port: 'timeout' }, a);
    g = insertAfter(g, { stepId: w.id, port: 'matched' }, b);
    expect(targetOf(g, { stepId: w.id, port: 'timeout' })).toBe(a.id);
    expect(targetOf(g, { stepId: w.id, port: 'matched' })).toBe(b.id);
    g = removeStep(g, w.id);
    expect(g.entryStepId).toBeNull();
    const s = fresh('event_split');
    expect((s as { rule: { op: string } }).rule.op).toBe('AND');
    g = insertAfter(empty, { stepId: TRIGGER }, s);
    expect(firstFreePort(g, s.id)).toEqual({ stepId: s.id, port: 'yes' });
  });
});
