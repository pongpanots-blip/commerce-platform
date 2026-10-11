// ui-copy-migration: only literal UI copy and notification templates
import { Button, Input, Select, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { EventAttributeType, EventFilter, FilterOp } from '@cp/marketing-workflow';
import { OP_LABEL, OPS_BY_TYPE } from './rule-helpers';

type Types = Record<string, EventAttributeType>;
const FROM_TRIGGER_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'before', 'after'];

/** AND list of attribute filters. `triggerTypes` given → a value may come from the event that started the workflow (spec §6). */
export function FilterEditor({ filters, types, triggerTypes, onChange }: { filters: EventFilter[]; types: Types; triggerTypes?: Types | null; onChange: (f: EventFilter[]) => void }) {
  __useUiLocale();
  const keys = Object.keys(types);
  const set = (i: number, f: EventFilter) => onChange(filters.map((x, j) => (j === i ? f : x)));
  const valueInput = (f: EventFilter, i: number) => {
    const type = types[f.key];
    if (typeof f.value === 'object' && f.value && !Array.isArray(f.value)) {
      const same = Object.entries(triggerTypes ?? {}).filter(([, t]) => t === type).map(([k]) => k);
      return <Select value={f.value.fromTrigger} onChange={(e) => set(i, { ...f, value: { fromTrigger: e.target.value } })}>{same.map((k) => <option key={k} value={k}>{k}</option>)}</Select>;
    }
    if (f.op === 'in') return <Input value={(f.value as string[]).join(',')} placeholder="A,B" onChange={(e) => set(i, { ...f, value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />;
    if (type === 'boolean') return <Select value={String(f.value)} onChange={(e) => set(i, { ...f, value: e.target.value === 'true' })}><option value="true">{__uiText('ใช่')}</option><option value="false">{__uiText('ไม่ใช่')}</option></Select>;
    if (type === 'number' || f.op === 'within_last_days' || f.op === 'within_next_days')
      return <Input type="number" value={Number(f.value)} onChange={(e) => set(i, { ...f, value: Number(e.target.value) })} />;
    if (type === 'date') return <Input type="date" value={String(f.value).slice(0, 10)} onChange={(e) => set(i, { ...f, value: e.target.value })} />;
    return <Input value={String(f.value)} onChange={(e) => set(i, { ...f, value: e.target.value })} />;
  };
  return (
    <div className="space-y-2">
      {filters.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1.2fr_auto] items-center gap-1">
          <Select value={f.key} onChange={(e) => { const t = types[e.target.value]; set(i, { key: e.target.value, op: OPS_BY_TYPE[t][0], value: t === 'number' ? 0 : t === 'boolean' ? true : '' }); }}>
            {keys.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
          <Select value={f.op} onChange={(e) => set(i, { ...f, op: e.target.value as FilterOp, value: e.target.value === 'in' ? [] : f.value })}>
            {OPS_BY_TYPE[types[f.key] ?? 'string'].map((op) => <option key={op} value={op}>{__uiText(OP_LABEL[op])}</option>)}
          </Select>
          <div className="flex items-center gap-1">
            {valueInput(f, i)}
            {triggerTypes && FROM_TRIGGER_OPS.includes(f.op) && (
              <Button size="sm" variant="ghost" title={__uiText('ใช้ค่าจาก event ที่เริ่ม workflow')}
                onClick={() => set(i, { ...f, value: typeof f.value === 'object' && !Array.isArray(f.value) ? '' : { fromTrigger: f.key } })}>⇄</Button>
            )}
          </div>
          <Button size="sm" variant="ghost" icon="close" aria-label={__uiText('ลบเงื่อนไข')} onClick={() => onChange(filters.filter((_, j) => j !== i))} />
        </div>
      ))}
      {keys.length > 0 && filters.length < 10 && (
        <Button size="sm" icon="add" onClick={() => { const t = types[keys[0]]; onChange([...filters, { key: keys[0], op: OPS_BY_TYPE[t][0], value: t === 'number' ? 0 : t === 'boolean' ? true : '' }]); }}>
          {__uiText('เพิ่มเงื่อนไข attribute')}
        </Button>
      )}
    </div>
  );
}
