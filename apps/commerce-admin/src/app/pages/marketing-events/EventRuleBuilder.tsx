// ui-copy-migration: only literal UI copy and notification templates
import { Button, Input, Select, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { DynamicSegment, EventDefinition, EventRule } from '@cp/marketing-workflow';
import { FilterEditor } from './FilterEditor';
import { liveAttributes, newEventLeaf } from './rule-helpers';

type Group = Extract<EventRule, { children: EventRule[] }>;
const isGroup = (r: EventRule): r is Group => 'children' in r;

/** Recursive AND/OR builder for event rules (spec §11). Depth ≤ 4 is enforced by the server; the UI stops offering groups at depth 3. */
export function EventRuleBuilder({ rule, definitions, segments = [], allowSegments, onChange, depth = 1 }: {
  rule: EventRule; definitions: EventDefinition[]; segments?: DynamicSegment[]; allowSegments: boolean; onChange: (r: EventRule) => void; depth?: number;
}) {
  __useUiLocale();
  const active = definitions.filter((d) => d.status === 'active');
  if (isGroup(rule)) {
    const setChild = (i: number, c: EventRule) => onChange({ ...rule, children: rule.children.map((x, j) => (j === i ? c : x)) });
    return (
      <div className="space-y-2 rounded-lg border border-outline-variant p-2">
        <Select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as Group['op'] })} aria-label={__uiText('รวมเงื่อนไขแบบ')}>
          <option value="AND">{__uiText('ทุกข้อ (AND)')}</option><option value="OR">{__uiText('ข้อใดข้อหนึ่ง (OR)')}</option>
        </Select>
        {rule.children.map((c, i) => (
          <div key={i} className="flex items-start gap-1">
            <div className="min-w-0 flex-1"><EventRuleBuilder rule={c} definitions={definitions} segments={segments} allowSegments={allowSegments} depth={depth + 1} onChange={(x) => setChild(i, x)} /></div>
            <Button size="sm" variant="ghost" icon="close" aria-label={__uiText('ลบเงื่อนไข')} onClick={() => onChange({ ...rule, children: rule.children.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <div className="flex flex-wrap gap-1">
          <Button size="sm" icon="add" onClick={() => onChange({ ...rule, children: [...rule.children, newEventLeaf(active[0])] })}>{__uiText('เงื่อนไข event')}</Button>
          {allowSegments && segments.length > 0 && (
            <Button size="sm" icon="add" onClick={() => onChange({ ...rule, children: [...rule.children, { kind: 'segment', segmentId: segments[0].id }] })}>{__uiText('กลุ่มลูกค้าอัตโนมัติ')}</Button>
          )}
          {depth < 3 && <Button size="sm" icon="add" onClick={() => onChange({ ...rule, children: [...rule.children, { op: 'AND', children: [newEventLeaf(active[0])] }] })}>{__uiText('กลุ่ม')}</Button>}
        </div>
      </div>
    );
  }
  if (rule.kind === 'segment') {
    return <Select value={rule.segmentId} onChange={(e) => onChange({ kind: 'segment', segmentId: e.target.value })}>{segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>;
  }
  const def = definitions.find((d) => d.name === rule.name);
  const types = Object.fromEntries(liveAttributes(def).map((a) => [a.key, a.type]));
  const numbers = liveAttributes(def).filter((a) => a.type === 'number');
  const windowDays = 'lastDays' in rule.window ? rule.window.lastDays : null;
  return (
    <div className="space-y-2 rounded-lg bg-surface-container-low p-2">
      <div className="grid grid-cols-2 gap-1">
        <Select value={rule.name} onChange={(e) => onChange({ ...rule, name: e.target.value, filters: [], measure: 'count' })} aria-label={__uiText('event')}>
          {active.map((d) => <option key={d.name} value={d.name}>{d.label} ({d.name})</option>)}
        </Select>
        <Select value={rule.measure === 'count' ? 'count' : rule.measure.sum} aria-label={__uiText('นับ')}
          onChange={(e) => onChange({ ...rule, measure: e.target.value === 'count' ? 'count' : { sum: e.target.value } })}>
          <option value="count">{__uiText('จำนวนครั้ง')}</option>
          {numbers.map((a) => <option key={a.key} value={a.key}>{__uiText('ผลรวมของ {0}', { 0: a.key })}</option>)}
        </Select>
      </div>
      <div className="grid grid-cols-[80px_1fr_1fr] gap-1">
        <Select value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as 'gte' | 'eq' | 'lte' })} aria-label={__uiText('เปรียบเทียบ')}>
          <option value="gte">≥</option><option value="eq">=</option><option value="lte">≤</option>
        </Select>
        <Input type="number" value={rule.value} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} aria-label={__uiText('ค่า')} />
        <div className="flex items-center gap-1">
          <Input type="number" min={1} max={90} value={windowDays ?? 7} onChange={(e) => onChange({ ...rule, window: { lastDays: Math.trunc(Number(e.target.value) || 1) } })} aria-label={__uiText('วันล่าสุด')} />
          <span className="text-xs">{__uiText('วันล่าสุด')}</span>
        </div>
      </div>
      {Object.keys(types).length > 0 && <FilterEditor filters={rule.filters} types={types} onChange={(filters) => onChange({ ...rule, filters })} />}
    </div>
  );
}
