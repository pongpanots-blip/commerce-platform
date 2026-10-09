import { EVENT_NAMES, FoundationEventName, instant, opaqueId } from './event-contracts';

export const SEGMENT_LIMITS = Object.freeze({ maxDepth: 6, maxNodes: 32, maxChildren: 8, maxWindowDays: 365, maxCount: 10000, maxBranches: 100, statementTimeoutMs: 1500, maxSqlBytes: 65536 });
export type ProfilePredicate =
  | { kind: 'profile'; field: 'eligible'; operator: 'eq'; value: boolean }
  | { kind: 'profile'; field: 'region'; operator: 'eq' | 'ne'; value: string }
  | { kind: 'profile'; field: 'approvedAt'; operator: 'at_least_days_ago'; value: number };
export type EventWindow = { kind: 'last_days'; days: number } | { kind: 'branch_lifetime'; maxDays: number };
export type EventPredicate = { kind: 'event_count'; event: FoundationEventName; window: EventWindow; operator: 'eq' | 'gte' | 'lte'; value: number };
export type SegmentRule = ProfilePredicate | EventPredicate | { kind: 'and'; children: SegmentRule[] } | { kind: 'or'; children: SegmentRule[] } | { kind: 'not'; child: SegmentRule };
export interface SegmentDefinition { schemaVersion: 1; ruleVersion: number; rule: SegmentRule }

export class InvalidSegment extends Error {}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new InvalidSegment('Expected a rule object.');
  return v as Record<string, unknown>;
};
const exact = (o: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(o).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(o, k))) throw new InvalidSegment('Unsupported or missing rule fields.');
};
const integer = (v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new InvalidSegment(`Integer must be between ${min} and ${max}.`);
  return v;
};

/** Input validation is separate from compilation and execution. No raw SQL/field/path escape hatch. */
export function validateSegment(raw: unknown): SegmentDefinition {
  const d = object(raw); exact(d, ['schemaVersion', 'ruleVersion', 'rule']);
  if (d.schemaVersion !== 1) throw new InvalidSegment('Unsupported segment schema version.');
  const version = integer(d.ruleVersion, 1, 2147483647);
  let nodes = 0;
  const visit = (value: unknown, depth: number): SegmentRule => {
    if (++nodes > SEGMENT_LIMITS.maxNodes || depth > SEGMENT_LIMITS.maxDepth) throw new InvalidSegment('Rule complexity exceeds the limit.');
    const n = object(value);
    if (n.kind === 'and' || n.kind === 'or') {
      exact(n, ['kind', 'children']);
      if (!Array.isArray(n.children) || n.children.length < 1 || n.children.length > SEGMENT_LIMITS.maxChildren) throw new InvalidSegment('Use one to eight conditions.');
      return { kind: n.kind, children: n.children.map(c => visit(c, depth + 1)) };
    }
    if (n.kind === 'not') { exact(n, ['kind', 'child']); return { kind: 'not', child: visit(n.child, depth + 1) }; }
    if (n.kind === 'profile') {
      exact(n, ['kind', 'field', 'operator', 'value']);
      if (n.field === 'eligible' && n.operator === 'eq' && typeof n.value === 'boolean') return { kind: 'profile', field: 'eligible', operator: 'eq', value: n.value };
      if (n.field === 'region' && (n.operator === 'eq' || n.operator === 'ne') && typeof n.value === 'string' && n.value.length > 0 && n.value.length <= 80) return { kind: 'profile', field: 'region', operator: n.operator, value: n.value };
      if (n.field === 'approvedAt' && n.operator === 'at_least_days_ago') return { kind: 'profile', field: 'approvedAt', operator: 'at_least_days_ago', value: integer(n.value, 1, SEGMENT_LIMITS.maxWindowDays) };
      throw new InvalidSegment('Unsupported profile field, comparison or value.');
    }
    if (n.kind === 'event_count') {
      exact(n, ['kind', 'event', 'window', 'operator', 'value']);
      if (!EVENT_NAMES.includes(n.event as FoundationEventName) || !['eq', 'gte', 'lte'].includes(String(n.operator))) throw new InvalidSegment('Unsupported event or count comparison.');
      const w = object(n.window); let window: EventWindow;
      if (w.kind === 'last_days') { exact(w, ['kind', 'days']); window = { kind: 'last_days', days: integer(w.days, 1, SEGMENT_LIMITS.maxWindowDays) }; }
      else if (w.kind === 'branch_lifetime') { exact(w, ['kind', 'maxDays']); window = { kind: 'branch_lifetime', maxDays: integer(w.maxDays, 1, SEGMENT_LIMITS.maxWindowDays) }; }
      else throw new InvalidSegment('Unsupported event window.');
      return { kind: 'event_count', event: n.event as FoundationEventName, window, operator: n.operator as EventPredicate['operator'], value: integer(n.value, 0, SEGMENT_LIMITS.maxCount) };
    }
    throw new InvalidSegment('Unsupported rule kind.');
  };
  return { schemaVersion: 1, ruleVersion: version, rule: visit(d.rule, 1) };
}

/** Fixture-only authority. Rules cannot supply a tenant, branch or principal override. */
export class FixtureScope {
  private readonly authority = true;
  readonly tenantId: string;
  readonly branchIds: readonly string[];
  private constructor(tenantId: string, branchIds: string[]) {
    this.tenantId = tenantId; this.branchIds = Object.freeze([...branchIds]); Object.freeze(this);
  }
  static authorize(principalId: string, grants: ReadonlyMap<string, { tenantId: string; branchIds: readonly string[] }>): FixtureScope {
    const g = grants.get(principalId);
    if (!g) throw new Error('Fixture principal is not authorized.');
    const tenantId = opaqueId.parse(g.tenantId), ids = g.branchIds.map(id => opaqueId.parse(id));
    if (ids.length > SEGMENT_LIMITS.maxBranches || new Set(ids).size !== ids.length) throw new Error('Invalid fixture branch scope.');
    return new FixtureScope(tenantId, ids);
  }
  static assert(scope: FixtureScope): void {
    if (!(scope instanceof FixtureScope) || !scope.authority) throw new Error('A separately authorized fixture scope is required.');
  }
}

export function evaluationInstant(raw: unknown): string { return new Date(instant.parse(raw)).toISOString(); }
