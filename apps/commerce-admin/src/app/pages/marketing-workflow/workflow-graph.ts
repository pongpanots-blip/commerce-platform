import { uiText } from '@cp/ui';
import type { CanvasPosition, WorkflowStep } from '@cp/marketing-workflow';

/** Pure edits of a workflow's graph. Every pointer is explicit (`nextId` etc.); the entry is `entryStepId`. */
export const TRIGGER = 'trigger';
export type StepKind = 'audience' | 'wait' | 'condition' | 'split' | 'push' | 'email' | 'in_app' | 'webhook' | 'grant_coupon' | 'wait_event' | 'event_split';
export interface Anchor { stepId: string; port?: string }
export interface Graph { entryStepId: string | null; steps: WorkflowStep[] }

const uuid = () => crypto.randomUUID();

export function newStep(kind: StepKind, newId: string = uuid()): WorkflowStep {
  switch (kind) {
    case 'audience': return { id: newId, type: 'audience', segmentIds: [], excludeSegmentIds: [], nextId: null };
    case 'wait': return { id: newId, type: 'wait', hours: 1, minutes: 0, nextId: null };
    case 'condition': return { id: newId, type: 'condition', expression: 'still_no_order == true', yesNextId: null, noNextId: null };
    case 'split': return { id: newId, type: 'split', branches: [
      { id: uuid(), label: 'A', percent: 50, nextId: null }, { id: uuid(), label: 'B', percent: 50, nextId: null }] };
    case 'webhook': return { id: newId, type: 'webhook', method: 'POST', url: '', headers: [], body: '', nextId: null };
    case 'grant_coupon': return { id: newId, type: 'action', action: { kind: 'grant_coupon', couponId: '' }, nextId: null };
    case 'wait_event': return { id: newId, type: 'wait_event', eventName: '', filters: [], timeoutHours: 24, timeoutMinutes: 0, matchedNextId: null, timeoutNextId: null };
    case 'event_split': return { id: newId, type: 'event_split', rule: { op: 'AND', children: [] }, yesNextId: null, noNextId: null };
    default: return { id: newId, type: 'action', action: { kind: 'notify', channels: [kind], templateKey: '' }, nextId: null };
  }
}

export function outPorts(step: WorkflowStep): { port?: string; label: string; target: string | null }[] {
  if (step.type === 'condition') return [{ port: 'yes', label: 'Yes', target: step.yesNextId }, { port: 'no', label: 'No', target: step.noNextId }];
  if (step.type === 'split') return step.branches.map((b) => ({ port: b.id, label: `${b.label} ${b.percent}%`, target: b.nextId }));
  if (step.type === 'event_split') return [{ port: 'yes', label: 'Yes', target: step.yesNextId }, { port: 'no', label: 'No', target: step.noNextId }];
  if (step.type === 'wait_event') return [{ port: 'matched', label: uiText('เกิดขึ้น'), target: step.matchedNextId }, { port: 'timeout', label: uiText('หมดเวลา'), target: step.timeoutNextId }];
  return [{ port: undefined, label: '', target: step.nextId }];
}

const find = (g: Graph, id: string) => g.steps.find((s) => s.id === id);

export function targetOf(g: Graph, a: Anchor): string | null {
  if (a.stepId === TRIGGER) return g.entryStepId;
  const s = find(g, a.stepId);
  if (!s) return null;
  const ports = outPorts(s);
  return (a.port === undefined ? ports[0] : ports.find((p) => p.port === a.port))?.target ?? null;
}

function withTarget(step: WorkflowStep, port: string | undefined, target: string | null): WorkflowStep {
  if (step.type === 'condition') return port === 'no' ? { ...step, noNextId: target } : { ...step, yesNextId: target };
  if (step.type === 'event_split') return port === 'no' ? { ...step, noNextId: target } : { ...step, yesNextId: target };
  if (step.type === 'wait_event') return port === 'timeout' ? { ...step, timeoutNextId: target } : { ...step, matchedNextId: target };
  if (step.type === 'split') {
    const branchId = port ?? step.branches[0]?.id;
    return { ...step, branches: step.branches.map((b) => (b.id === branchId ? { ...b, nextId: target } : b)) };
  }
  return { ...step, nextId: target };
}

function setTarget(g: Graph, a: Anchor, target: string | null): Graph {
  if (a.stepId === TRIGGER) return { ...g, entryStepId: target };
  return { ...g, steps: g.steps.map((s) => (s.id === a.stepId ? withTarget(s, a.port, target) : s)) };
}

/** New step goes on the anchor's port; whatever was there continues from the new step's first port. */
export function insertAfter(g: Graph, a: Anchor, step: WorkflowStep): Graph {
  const old = targetOf(g, a);
  const chained = withTarget(step, undefined, old);
  return setTarget({ ...g, steps: [...g.steps, chained] }, a, step.id);
}

export const addLoose = (g: Graph, step: WorkflowStep): Graph => ({ ...g, steps: [...g.steps, step] });

export function connect(g: Graph, from: Anchor, to: string): Graph {
  if (from.stepId === to || to === TRIGGER || !find(g, to)) return g;
  return setTarget(g, from, to);
}

export const disconnect = (g: Graph, from: Anchor): Graph => setTarget(g, from, null);

/** Pointers into the removed step move to its target when it has a single exit; otherwise they end (null). */
export function removeStep(g: Graph, id: string): Graph {
  const gone = find(g, id);
  if (!gone) return g;
  const ports = outPorts(gone);
  const through = ports.length === 1 ? ports[0].target : null;
  const repoint = (t: string | null) => (t === id ? through : t);
  const steps = g.steps.filter((s) => s.id !== id).map((s): WorkflowStep => {
    if (s.type === 'condition') return { ...s, yesNextId: repoint(s.yesNextId), noNextId: repoint(s.noNextId) };
    if (s.type === 'split') return { ...s, branches: s.branches.map((b) => ({ ...b, nextId: repoint(b.nextId) })) };
    if (s.type === 'event_split') return { ...s, yesNextId: repoint(s.yesNextId), noNextId: repoint(s.noNextId) };
    if (s.type === 'wait_event') return { ...s, matchedNextId: repoint(s.matchedNextId), timeoutNextId: repoint(s.timeoutNextId) };
    return { ...s, nextId: repoint(s.nextId) };
  });
  return { entryStepId: repoint(g.entryStepId), steps };
}

export function firstFreePort(g: Graph, stepId: string): Anchor | null {
  if (stepId === TRIGGER) return g.entryStepId ? null : { stepId };
  const s = find(g, stepId);
  const free = s ? outPorts(s).find((p) => p.target === null) : undefined;
  return free ? { stepId, port: free.port } : null;
}

/** Follow first ports from the trigger to the last step (where a click in the palette appends). */
export function tailOfMain(g: Graph): Anchor {
  let anchor: Anchor = { stepId: TRIGGER };
  const seen = new Set<string>();
  for (let next = g.entryStepId; next && !seen.has(next);) {
    seen.add(next);
    const s = find(g, next);
    if (!s) break;
    const port = outPorts(s)[0];
    anchor = { stepId: s.id, port: port.port };
    next = port.target;
  }
  return anchor;
}

const COL = 300; const ROW = 140;
/** Columns by BFS depth from the trigger, rows in visit order; unreachable steps go in a row below. */
export function autoLayout(g: Graph): Record<string, CanvasPosition> {
  const pos: Record<string, CanvasPosition> = { [TRIGGER]: { x: 0, y: 0 } };
  const rows = new Map<number, number>();
  const queue: [string, number][] = g.entryStepId ? [[g.entryStepId, 1]] : [];
  while (queue.length) {
    const [id, depth] = queue.shift()!;
    if (pos[id]) continue;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    pos[id] = { x: depth * COL, y: row * ROW };
    const s = find(g, id);
    if (s) for (const p of outPorts(s)) if (p.target) queue.push([p.target, depth + 1]);
  }
  const deepest = Math.max(0, ...rows.values());
  g.steps.filter((s) => !pos[s.id]).forEach((s, i) => { pos[s.id] = { x: (i + 1) * COL, y: (deepest + 1) * ROW }; });
  return pos;
}
