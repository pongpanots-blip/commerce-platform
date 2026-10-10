import type { EventDefinition, EventRule } from '@cp/marketing-workflow';
import { compileRule, eventRefsIn, ruleIssues, segmentIdsIn, type RuleContext } from './event-rule';

const def: EventDefinition = { name: 'add_to_cart', label: '', description: null, evidence: 'browser', status: 'active', createdAt: '', updatedAt: '',
  attributes: [{ key: 'price', type: 'number', label: '' }, { key: 'item_id', type: 'string', label: '' }] };
const catalog = new Map([[def.name, def]]);
const now = new Date('2026-10-10T00:00:00Z');
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({ catalog, coverageStart: new Date('2026-08-01T00:00:00Z'), segmentIds: new Set(['s1']), now, ...over });
const leaf = (over: object = {}): EventRule => ({ kind: 'event', name: 'add_to_cart', measure: 'count', op: 'gte', value: 1, window: { lastDays: 7 }, filters: [], ...over }) as EventRule;

describe('event rules', () => {
  it('accepts a valid nested rule', () => {
    expect(ruleIssues({ op: 'AND', children: [leaf(), { op: 'OR', children: [leaf({ measure: { sum: 'price' }, value: 500 }), { kind: 'segment', segmentId: 's1' }] }] }, ctx())).toEqual([]);
  });

  it('rejects a window before coverage instead of counting the gap as zero', () => {
    expect(ruleIssues(leaf({ op: 'eq', value: 0, window: { lastDays: 30 } }), ctx({ coverageStart: new Date('2026-10-08T00:00:00Z') })))
      .toEqual(['เริ่มเก็บ event เมื่อ 2026-10-08 — ช่วงเวลาต้องไม่ย้อนก่อนวันนั้น']);
    expect(ruleIssues(leaf(), ctx({ coverageStart: null }))).toEqual(['ยังไม่เริ่มเก็บ event — ใช้เงื่อนไขนี้ได้หลังมี event เข้ามา']);
  });

  it('rejects sum on a non-number, unknown events, segment refs where not allowed, too deep / too many', () => {
    expect(ruleIssues(leaf({ measure: { sum: 'item_id' } }), ctx())).toContain('ผลรวมต้องใช้ attribute ชนิดตัวเลข');
    expect(ruleIssues(leaf({ name: 'nope' }), ctx())).toEqual(['ไม่มี event "nope" ใน catalog']);
    expect(ruleIssues({ kind: 'segment', segmentId: 's1' }, ctx({ segmentIds: null }))).toEqual(['dynamic segment ใช้ซ้อนใน dynamic segment ไม่ได้']);
    const deep: EventRule = { op: 'AND', children: [{ op: 'AND', children: [{ op: 'AND', children: [{ op: 'AND', children: [leaf()] }] }] }] };
    expect(ruleIssues(deep, ctx())).toEqual(['เงื่อนไขซ้อนลึกเกิน 4 ชั้น']);
    expect(ruleIssues({ op: 'OR', children: Array.from({ length: 17 }, () => leaf()) }, ctx())).toEqual(['เงื่อนไขได้ไม่เกิน 16 ข้อ']);
    expect(ruleIssues(leaf({ filters: [{ key: 'price', op: 'eq', value: { fromTrigger: 'price' } }] }), ctx())).toEqual(['ใน event rule ใช้ค่าจาก event ที่ trigger ไม่ได้']);
  });

  it('compiles to SQL where keys and values are parameters', () => {
    const params: unknown[] = ['user'];
    const sql = compileRule({ op: 'AND', children: [
      leaf({ filters: [{ key: 'item_id', op: 'eq', value: "x' OR 1=1 --" }] }),
      leaf({ measure: { sum: 'price' }, op: 'lte', value: 500, window: { from: '2026-09-15T00:00:00Z', to: '2026-10-01T00:00:00Z' } }),
      { kind: 'segment', segmentId: 's1' },
    ] }, { catalog, segments: new Map([['s1', leaf()]]) }, '$1::uuid', params);
    expect(sql).not.toContain("x'");
    expect(sql).not.toContain('item_id');
    expect(sql).toContain('e.attributed_user_id = $1::uuid');
    expect(sql).toContain('COALESCE(sum((e.attributes->>$');
    expect(params).toEqual(['user', 'add_to_cart', 7, 'item_id', "x' OR 1=1 --", 1, 'add_to_cart', '2026-09-15T00:00:00Z', '2026-10-01T00:00:00Z', 'price', 500,
      'add_to_cart', 7, 1]);
  });

  it('compiles an unknown event or segment to FALSE', () => {
    expect(compileRule(leaf({ name: 'gone' }), { catalog, segments: new Map() }, 'u.id', [])).toBe('FALSE');
    expect(compileRule({ kind: 'segment', segmentId: 'x' }, { catalog, segments: new Map() }, 'u.id', [])).toBe('FALSE');
  });

  it('finds segment ids and event references anywhere in workflow JSON', () => {
    expect(segmentIdsIn({ op: 'OR', children: [{ kind: 'segment', segmentId: 's1' }, leaf()] })).toEqual(['s1']);
    const refs = eventRefsIn({ triggerConfig: { eventName: 'login', filters: [] },
      steps: [{ type: 'wait_event', eventName: 'add_to_cart', filters: [{ key: 'item_id', op: 'eq', value: 'x' }] },
        { type: 'event_split', rule: leaf({ measure: { sum: 'price' } }) }] });
    expect([...refs.keys()].sort()).toEqual(['add_to_cart', 'login']);
    expect([...refs.get('add_to_cart')!].sort()).toEqual(['item_id', 'price']);
  });
});
