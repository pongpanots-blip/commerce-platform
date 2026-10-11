import { uiText } from '@cp/ui';
import type { EventAttributeType, EventDefinition, EventFilter, EventRule, FilterOp } from '@cp/marketing-workflow';

/** Same table as commerce-platform marketing-events/domain/event-filter.ts. */
export const OPS_BY_TYPE: Record<EventAttributeType, FilterOp[]> = {
  string: ['eq', 'neq', 'contains', 'in'], number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], boolean: ['eq'],
  date: ['before', 'after', 'within_last_days', 'within_next_days'],
};
export const OP_LABEL: Record<FilterOp, string> = {
  eq: '=', neq: '≠', contains: 'มีคำว่า', in: 'เป็นหนึ่งใน', gt: '>', gte: '≥', lt: '<', lte: '≤', before: 'ก่อน', after: 'หลัง',
  within_last_days: 'ภายใน N วันที่ผ่านมา', within_next_days: 'ภายใน N วันข้างหน้า',
};
const DEFAULT_VALUE: Record<EventAttributeType, EventFilter['value']> = { string: '', number: 0, boolean: true, date: new Date().toISOString().slice(0, 10) };

export const liveAttributes = (def: EventDefinition | undefined) => (def?.attributes ?? []).filter((a) => !a.archived);

export function defaultFilter(def: EventDefinition): EventFilter | null {
  const a = liveAttributes(def)[0];
  if (!a) return null;
  const op = a.type === 'number' ? 'gte' : OPS_BY_TYPE[a.type][0];
  return { key: a.key, op, value: DEFAULT_VALUE[a.type] };
}

export function newEventLeaf(def: EventDefinition | undefined): EventRule {
  return { kind: 'event', name: def?.name ?? '', measure: 'count', op: 'gte', value: 1, window: { lastDays: 7 }, filters: [] };
}

const CMP = { gte: '≥', eq: '=', lte: '≤' } as const;
export function describeRule(rule: EventRule, names: Map<string, string>): string {
  if ('children' in rule) return `(${rule.children.map((c) => describeRule(c, names)).join(` ${uiText(rule.op === 'AND' ? 'และ' : 'หรือ')} `)})`;
  if (rule.kind === 'segment') return `${uiText('กลุ่มลูกค้า')} ${names.get(rule.segmentId) ?? rule.segmentId.slice(0, 8)}`;
  const what = rule.measure === 'count' ? `${CMP[rule.op]} ${rule.value} ${uiText('ครั้ง')}` : `${uiText('ผลรวมของ {0}', { 0: rule.measure.sum })} ${CMP[rule.op]} ${rule.value}`;
  const when = 'lastDays' in rule.window ? `${rule.window.lastDays} ${uiText('วัน')}` : `${rule.window.from.slice(0, 10)}–${rule.window.to.slice(0, 10)}`;
  return `${names.get(rule.name) ?? rule.name} ${what} / ${when}${rule.filters.length ? ` (+${rule.filters.length})` : ''}`;
}
