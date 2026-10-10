import type { EventAttributeType, EventFilter, FilterOp, FilterValue } from '@cp/marketing-workflow';

export type Types = Record<string, EventAttributeType>;
export const MAX_FILTERS = 10;
export const OPS_BY_TYPE: Record<EventAttributeType, FilterOp[]> = {
  string: ['eq', 'neq', 'contains', 'in'], number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], boolean: ['eq'],
  date: ['before', 'after', 'within_last_days', 'within_next_days'],
};
/** Ops that compare against one value, so they can take a value from the trigger event. */
const TRIGGER_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'before', 'after'];
const DAY = 86_400_000;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export const isFromTrigger = (v: unknown): v is { fromTrigger: string } =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { fromTrigger?: unknown }).fromTrigger === 'string';

/** Staff-facing problems with a filter list (spec §6). `triggerTypes` = the trigger event's attributes, null when fromTrigger is not allowed. */
export function filterIssues(filters: EventFilter[], types: Types, triggerTypes: Types | null): string[] {
  if (!Array.isArray(filters) || filters.length > MAX_FILTERS) return [`เงื่อนไข attribute ได้ไม่เกิน ${MAX_FILTERS} ข้อ`];
  const out: string[] = [];
  for (const f of filters) {
    const type = own(types, f.key) ? types[f.key] : undefined;
    if (!type) { out.push(`ไม่มี attribute "${f.key}"`); continue; }
    if (!OPS_BY_TYPE[type].includes(f.op)) { out.push(`"${f.key}" ใช้ ${f.op} ไม่ได้`); continue; }
    if (isFromTrigger(f.value)) {
      if (!triggerTypes) out.push(`"${f.key}": ค่าจาก event ที่ trigger ใช้ได้เฉพาะ workflow ที่เริ่มด้วย event`);
      else if (!TRIGGER_OPS.includes(f.op)) out.push(`"${f.key}": ${f.op} ใช้ค่าจาก event ที่ trigger ไม่ได้`);
      else if (!own(triggerTypes, f.value.fromTrigger) || triggerTypes[f.value.fromTrigger] !== type)
        out.push(`"${f.key}": attribute "${f.value.fromTrigger}" ของ event ที่ trigger ไม่มีหรือชนิดไม่ตรง`);
      continue;
    }
    if (!valueFits(type, f.op, f.value)) out.push(`"${f.key}": ค่าไม่ถูกต้อง`);
  }
  return out;
}

function valueFits(type: EventAttributeType, op: FilterOp, v: FilterValue): boolean {
  if (op === 'in') return Array.isArray(v) && v.length >= 1 && v.length <= 50 && v.every((x) => typeof x === 'string' && x.length <= 500);
  if (op === 'within_last_days' || op === 'within_next_days') return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 365;
  if (type === 'string') return typeof v === 'string' && v.length <= 500;
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (type === 'boolean') return typeof v === 'boolean';
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

/** All filters pass (AND). A missing attribute — or a fromTrigger value the trigger event lacks — fails the filter. */
export function matchesFilters(attributes: Record<string, unknown>, filters: EventFilter[], types: Types,
  trigger: Record<string, unknown> | null = null, now = new Date()): boolean {
  return filters.every((f) => matchOne(attributes[f.key], f, own(types, f.key) ? types[f.key] : undefined, trigger, now));
}

function matchOne(actual: unknown, f: EventFilter, type: EventAttributeType | undefined, trigger: Record<string, unknown> | null, now: Date): boolean {
  if (actual === undefined || actual === null || !type) return false;
  const expected = isFromTrigger(f.value) ? trigger?.[f.value.fromTrigger] : f.value;
  if (expected === undefined || expected === null) return false;
  if (type === 'string') {
    if (typeof actual !== 'string') return false;
    if (f.op === 'in') return Array.isArray(expected) && expected.includes(actual);
    if (f.op === 'contains') return typeof expected === 'string' && actual.includes(expected);
    return f.op === 'eq' ? actual === expected : f.op === 'neq' ? actual !== expected : false;
  }
  if (type === 'number') return typeof actual === 'number' && typeof expected === 'number' && compare(actual, expected, f.op);
  if (type === 'boolean') return f.op === 'eq' && actual === expected;
  const at = Date.parse(String(actual));
  if (Number.isNaN(at)) return false;
  if (f.op === 'within_last_days') return at <= now.getTime() && at >= now.getTime() - Number(expected) * DAY;
  if (f.op === 'within_next_days') return at >= now.getTime() && at <= now.getTime() + Number(expected) * DAY;
  const e = Date.parse(String(expected));
  if (Number.isNaN(e)) return false;
  return f.op === 'before' ? at < e : f.op === 'after' ? at > e : false;
}

const compare = (a: number, b: number, op: FilterOp) =>
  op === 'eq' ? a === b : op === 'neq' ? a !== b : op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : op === 'lte' ? a <= b : false;
