import type { EventDefinition, EventFilter, EventLeaf, EventRule, EventWindow } from '@cp/marketing-workflow';
import { filterIssues, isFromTrigger, type Types } from './event-filter';

export const RULE_LIMITS = { maxDepth: 4, maxLeaves: 16, maxDays: 90, maxCount: 1000 } as const;
const DAY = 86_400_000;

/** segmentIds: dynamic segments that exist; null = segment references are not allowed here (inside a dynamic segment). */
export interface RuleContext { catalog: Map<string, EventDefinition>; coverageStart: Date | null; segmentIds: Set<string> | null; now: Date }

export const typesOf = (def: EventDefinition): Types =>
  Object.fromEntries(def.attributes.filter((a) => !a.archived).map((a) => [a.key, a.type]));
const isGroup = (n: EventRule): n is { op: 'AND' | 'OR'; children: EventRule[] } => !!n && typeof n === 'object' && 'children' in n;

export function windowStart(w: EventWindow, now: Date): Date | null {
  if (w && 'lastDays' in w) {
    return Number.isInteger(w.lastDays) && w.lastDays >= 1 && w.lastDays <= RULE_LIMITS.maxDays ? new Date(now.getTime() - w.lastDays * DAY) : null;
  }
  if (w && 'from' in w) {
    const a = Date.parse(w.from); const b = Date.parse(w.to);
    if (Number.isNaN(a) || Number.isNaN(b) || a >= b || a < now.getTime() - RULE_LIMITS.maxDays * DAY || b > now.getTime() + DAY) return null;
    return new Date(a);
  }
  return null;
}

/** Staff-facing problems (spec §11). Coverage: a window may not start before commerce began collecting events. */
export function ruleIssues(rule: EventRule, ctx: RuleContext): string[] {
  const out: string[] = [];
  let leaves = 0;
  const visit = (n: EventRule, depth: number): void => {
    if (depth > RULE_LIMITS.maxDepth) { out.push(`เงื่อนไขซ้อนลึกเกิน ${RULE_LIMITS.maxDepth} ชั้น`); return; }
    if (!n || typeof n !== 'object') { out.push('เงื่อนไขไม่ถูกต้อง'); return; }
    if (isGroup(n)) {
      if ((n.op !== 'AND' && n.op !== 'OR') || !Array.isArray(n.children) || !n.children.length) { out.push('กลุ่มเงื่อนไขต้องมีอย่างน้อย 1 ข้อ'); return; }
      for (const c of n.children) visit(c, depth + 1);
      return;
    }
    if (++leaves > RULE_LIMITS.maxLeaves) { out.push(`เงื่อนไขได้ไม่เกิน ${RULE_LIMITS.maxLeaves} ข้อ`); return; }
    leafIssues(n, ctx, out);
  };
  visit(rule, 1);
  return [...new Set(out)];
}

function leafIssues(l: EventLeaf, ctx: RuleContext, out: string[]): void {
  if (l.kind === 'segment') {
    if (!ctx.segmentIds) out.push('dynamic segment ใช้ซ้อนใน dynamic segment ไม่ได้');
    else if (!ctx.segmentIds.has(l.segmentId)) out.push('ไม่พบ dynamic segment');
    return;
  }
  if (l.kind !== 'event') { out.push('เงื่อนไขไม่ถูกต้อง'); return; }
  const def = ctx.catalog.get(l.name);
  if (!def || def.status !== 'active') { out.push(`ไม่มี event "${l.name}" ใน catalog`); return; }
  const types = typesOf(def);
  if (l.measure !== 'count' && (!l.measure || typeof l.measure !== 'object' || types[l.measure.sum] !== 'number')) out.push('ผลรวมต้องใช้ attribute ชนิดตัวเลข');
  if (!['gte', 'eq', 'lte'].includes(l.op)) out.push('เปรียบเทียบได้เฉพาะ ≥ = ≤');
  const valueOk = l.measure === 'count'
    ? Number.isInteger(l.value) && l.value >= 0 && l.value <= RULE_LIMITS.maxCount
    : typeof l.value === 'number' && Number.isFinite(l.value);
  if (!valueOk) out.push('จำนวนไม่ถูกต้อง');
  const start = windowStart(l.window, ctx.now);
  if (!start) out.push('ช่วงเวลาไม่ถูกต้อง (1–90 วันล่าสุด)');
  else if (!ctx.coverageStart) out.push('ยังไม่เริ่มเก็บ event — ใช้เงื่อนไขนี้ได้หลังมี event เข้ามา');
  else if (start.getTime() < ctx.coverageStart.getTime()) out.push(`เริ่มเก็บ event เมื่อ ${ctx.coverageStart.toISOString().slice(0, 10)} — ช่วงเวลาต้องไม่ย้อนก่อนวันนั้น`);
  if (!Array.isArray(l.filters)) out.push('เงื่อนไข attribute ไม่ถูกต้อง');
  else if (l.filters.some((f) => isFromTrigger(f.value))) out.push('ใน event rule ใช้ค่าจาก event ที่ trigger ไม่ได้');
  else out.push(...filterIssues(l.filters, types, null));
}

const LEAF_CMP = { gte: '>=', eq: '=', lte: '<=' } as const;
const NUM_CMP: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

/**
 * One SQL boolean for the rule. `userSql` is chosen by the caller from two fixed strings; every key and value is a bound
 * parameter appended to `params`. An event or segment that no longer exists compiles to FALSE.
 */
export function compileRule(rule: EventRule, refs: { catalog: Map<string, EventDefinition>; segments: Map<string, EventRule> },
  userSql: '$1::uuid' | 'u.id', params: unknown[]): string {
  const p = (v: unknown, cast = '') => { params.push(v); return `$${params.length}${cast}`; };
  // `inSegment`: segment references expand one level only (a segment inside a segment — or itself — is FALSE).
  const node = (n: EventRule, inSegment = false): string => {
    if (isGroup(n)) return `(${n.children.map((c) => node(c, inSegment)).join(n.op === 'AND' ? ' AND ' : ' OR ')})`;
    if (n.kind === 'segment') { const r = inSegment ? undefined : refs.segments.get(n.segmentId); return r ? node(r, true) : 'FALSE'; }
    const def = refs.catalog.get(n.name);
    if (!def) return 'FALSE';
    const types = typesOf(def);
    const where = [`e.attributed_user_id = ${userSql}`, `e.name = ${p(n.name)}`];
    if ('lastDays' in n.window) where.push(`e.occurred_at >= now() - make_interval(days => ${p(n.window.lastDays, '::int')})`);
    else where.push(`e.occurred_at >= ${p(n.window.from, '::timestamptz')}`, `e.occurred_at < ${p(n.window.to, '::timestamptz')}`);
    for (const f of n.filters) where.push(filterSql(f, types[f.key], p));
    const agg = n.measure === 'count' ? 'count(*)' : `COALESCE(sum((e.attributes->>${p(n.measure.sum)})::numeric), 0)`;
    return `((SELECT ${agg} FROM marketing_events e WHERE ${where.join(' AND ')}) ${LEAF_CMP[n.op]} ${p(n.value, '::numeric')})`;
  };
  return node(rule);
}

function filterSql(f: EventFilter, type: string | undefined, p: (v: unknown, cast?: string) => string): string {
  if (!type) return 'FALSE';
  const text = `(e.attributes->>${p(f.key)})`;
  if (type === 'string') {
    if (f.op === 'contains') return `strpos(${text}, ${p(f.value)}) > 0`;
    if (f.op === 'in') return `${text} = ANY(${p(f.value, '::text[]')})`;
    return `${text} ${f.op === 'neq' ? '<>' : '='} ${p(f.value)}`;
  }
  if (type === 'number') return `${text}::numeric ${NUM_CMP[f.op] ?? '='} ${p(f.value, '::numeric')}`;
  if (type === 'boolean') return `${text}::boolean = ${p(f.value, '::boolean')}`;
  if (f.op === 'within_last_days') return `${text}::timestamptz BETWEEN now() - make_interval(days => ${p(f.value, '::int')}) AND now()`;
  if (f.op === 'within_next_days') return `${text}::timestamptz BETWEEN now() AND now() + make_interval(days => ${p(f.value, '::int')})`;
  return `${text}::timestamptz ${f.op === 'before' ? '<' : '>'} ${p(f.value, '::timestamptz')}`;
}

export function segmentIdsIn(rule: EventRule): string[] {
  if (isGroup(rule)) return [...new Set(rule.children.flatMap(segmentIdsIn))];
  return rule.kind === 'segment' ? [rule.segmentId] : [];
}

/** Every event name (and its attribute keys) a workflow / rule JSON refers to — for the catalog's archive check (spec §14). */
export function eventRefsIn(value: unknown, refs = new Map<string, Set<string>>()): Map<string, Set<string>> {
  if (Array.isArray(value)) { for (const v of value) eventRefsIn(v, refs); return refs; }
  if (!value || typeof value !== 'object') return refs;
  const o = value as Record<string, unknown>;
  const name = typeof o.eventName === 'string' ? o.eventName : o.kind === 'event' && typeof o.name === 'string' ? o.name : null;
  if (name) {
    const keys = refs.get(name) ?? new Set<string>();
    for (const f of Array.isArray(o.filters) ? o.filters : []) if (typeof (f as EventFilter)?.key === 'string') keys.add((f as EventFilter).key);
    const m = o.measure as { sum?: unknown } | undefined;
    if (m && typeof m === 'object' && typeof m.sum === 'string') keys.add(m.sum);
    refs.set(name, keys);
  }
  for (const v of Object.values(o)) eventRefsIn(v, refs);
  return refs;
}
