// ui-copy-migration: only literal UI copy and notification templates
import { Checkbox, Field, Hint, Input, Select, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { DynamicSegment, EventDefinition, EventTriggerConfig, ExitGoal, WorkflowInput, WorkflowStep } from '@cp/marketing-workflow';
import { EventRuleBuilder } from '../../marketing-events/EventRuleBuilder';
import { FilterEditor } from '../../marketing-events/FilterEditor';
import { liveAttributes } from '../../marketing-events/rule-helpers';

type Of<T extends WorkflowStep['type']> = Extract<WorkflowStep, { type: T }>;
const typesOf = (d: EventDefinition | undefined) => Object.fromEntries(liveAttributes(d).map((a) => [a.key, a.type]));
const pick = (defs: EventDefinition[], name: string) => defs.find((d) => d.name === name);

function EventSelect({ value, definitions, onChange }: { value: string; definitions: EventDefinition[]; onChange: (name: string) => void }) {
  __useUiLocale();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{__uiText('เลือกสิ่งที่ลูกค้าทำ')}</option>
      {definitions.filter((d) => d.status === 'active' || d.name === value).map((d) => <option key={d.name} value={d.name}>{d.label} ({d.name})</option>)}
    </Select>
  );
}

/** Entry = "เมื่อเกิด event": event, attribute filters, include guests (spec §7, §10). */
export function EventTriggerFields({ config, definitions, onChange }: { config: EventTriggerConfig; definitions: EventDefinition[]; onChange: (c: EventTriggerConfig) => void }) {
  __useUiLocale();
  const def = pick(definitions, config.eventName);
  return (
    <div className="space-y-3">
      <Field label={__uiText('สิ่งที่ลูกค้าทำ')}><EventSelect value={config.eventName} definitions={definitions} onChange={(eventName) => onChange({ ...config, eventName, filters: [] })} /></Field>
      {def?.evidence === 'browser' && <p className="text-[11px] text-warn">{__uiText('ข้อมูลนี้มาจากหน้าเว็บหรือแอป ผู้ใช้ปลอมได้ ถ้าแจกคูปองให้ตั้งเว้นระยะส่งซ้ำ และคูปองมูลค่าสูงควรเริ่มจากยอดสั่งซื้อแทน')}</p>}
      {def && <Field label={__uiText('เงื่อนไขเพิ่มเติม (ต้องตรงทุกข้อ)')}><FilterEditor filters={config.filters} types={typesOf(def)} onChange={(filters) => onChange({ ...config, filters })} /></Field>}
      <Checkbox checked={config.includeGuests} onChange={(e) => onChange({ ...config, includeGuests: e.target.checked })} label={__uiText('รวมลูกค้าที่ยังไม่เข้าสู่ระบบ')} />
      {config.includeGuests && <Hint>{__uiText('ลูกค้าที่ยังไม่เข้าสู่ระบบได้เฉพาะการแจ้งเตือนบนเครื่องที่กดรับไว้ ไม่เกินวันละ 1 ครั้ง ใช้ขั้นตอนคัดกลุ่มและแยกตามสิ่งที่ลูกค้าทำไม่ได้ และต้องให้เจ้าหน้าที่คุ้มครองข้อมูลยืนยันก่อนเปิดใช้งาน')}</Hint>}
    </div>
  );
}

export function WaitEventForm({ step, definitions, triggerDef, maxMinutes, onChange }: {
  step: Of<'wait_event'>; definitions: EventDefinition[]; triggerDef: EventDefinition | undefined; maxMinutes: number; onChange: (s: WorkflowStep) => void;
}) {
  __useUiLocale();
  const def = pick(definitions, step.eventName);
  const total = step.timeoutHours * 60 + (step.timeoutMinutes ?? 0);
  const int = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));
  return (
    <div className="space-y-3">
      <Field label={__uiText('รอให้ลูกค้าทำ')}><EventSelect value={step.eventName} definitions={definitions} onChange={(eventName) => onChange({ ...step, eventName, filters: [] })} /></Field>
      {def && <Field label={__uiText('เงื่อนไขเพิ่มเติม')}>
        <FilterEditor filters={step.filters} types={typesOf(def)} triggerTypes={triggerDef ? typesOf(triggerDef) : null} onChange={(filters) => onChange({ ...step, filters })} />
      </Field>}
      <div className="grid grid-cols-2 gap-2">
        <Field label={__uiText('หมดเวลา (ชั่วโมง)')}><Input type="number" min={0} value={step.timeoutHours} onChange={(e) => onChange({ ...step, timeoutHours: int(e.target.value) })} /></Field>
        <Field label={__uiText('นาที')}><Input type="number" min={0} max={59} value={step.timeoutMinutes ?? 0} onChange={(e) => onChange({ ...step, timeoutMinutes: Math.min(59, int(e.target.value)) })} /></Field>
      </div>
      {(total < 1 || total > maxMinutes) && <Hint>{__uiText('รอได้ 1 นาที ถึง 30 วัน')}</Hint>}
      <Hint>{__uiText('นับเฉพาะสิ่งที่ลูกค้าทำหลังมาถึงขั้นตอนนี้ ถ้าทำแล้วไปทางออกบน ถ้าครบเวลาไปทางออกล่าง')}</Hint>
    </div>
  );
}

export function EventSplitForm({ step, definitions, segments, onChange }: { step: Of<'event_split'>; definitions: EventDefinition[]; segments: DynamicSegment[]; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  return (
    <div className="space-y-2">
      <EventRuleBuilder rule={step.rule} definitions={definitions} segments={segments} allowSegments onChange={(rule) => onChange({ ...step, rule })} />
      <Hint>{__uiText('ไปทาง ใช่ เมื่อเงื่อนไขเป็นจริงตอนที่ลูกค้ามาถึงขั้นตอนนี้')}</Hint>
    </div>
  );
}

/** Audience add-ons: dynamic segments (any of / none of) and an inline event rule (spec §11). */
export function AudienceEventFields({ step, definitions, segments, onChange }: { step: Of<'audience'>; definitions: EventDefinition[]; segments: DynamicSegment[]; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const toggle = (key: 'dynamicSegmentIds' | 'excludeDynamicSegmentIds', id: string) => {
    const cur = step[key] ?? [];
    onChange({ ...step, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  return (
    <div className="space-y-4">
      {(['dynamicSegmentIds', 'excludeDynamicSegmentIds'] as const).map((key) => (
        <Field key={key} label={key === 'dynamicSegmentIds' ? __uiText('อยู่ในกลุ่มตามสิ่งที่ลูกค้าทำกลุ่มใดก็ได้') : __uiText('ยกเว้นกลุ่มตามสิ่งที่ลูกค้าทำ')}>
          <div className="space-y-1">{segments.map((s) => <Checkbox key={s.id} checked={(step[key] ?? []).includes(s.id)} onChange={() => toggle(key, s.id)} label={s.name} />)}</div>
        </Field>
      ))}
      <Checkbox checked={!!step.eventRule} onChange={(e) => onChange({ ...step, eventRule: e.target.checked ? { op: 'AND', children: [] } : null })} label={__uiText('เพิ่มเงื่อนไขจากสิ่งที่ลูกค้าทำ')} />
      {step.eventRule && <EventRuleBuilder rule={step.eventRule} definitions={definitions} segments={segments} allowSegments onChange={(eventRule) => onChange({ ...step, eventRule })} />}
    </div>
  );
}

/** Exit goal: none / order placed (server) / an event (spec §9). */
export function GoalFields({ input, definitions, onChange }: { input: WorkflowInput; definitions: EventDefinition[]; onChange: (p: Partial<WorkflowInput>) => void }) {
  __useUiLocale();
  const g = input.exitOnGoal;
  const triggerDef = input.triggerType === 'event' ? pick(definitions, (input.triggerConfig as EventTriggerConfig).eventName) : undefined;
  const set = (exitOnGoal: ExitGoal) => onChange({ exitOnGoal });
  return (
    <div className="space-y-2">
      <Field label={__uiText('หยุดส่งเมื่อ')}>
        <Select value={g?.kind ?? 'none'} onChange={(e) => set(e.target.value === 'none' ? null : e.target.value === 'order_placed' ? { kind: 'order_placed' } : { kind: 'event', eventName: '', filters: [] })}>
          <option value="none">{__uiText('ไม่หยุด')}</option>
          <option value="order_placed">{__uiText('ลูกค้าสั่งซื้อแล้ว (จากระบบ)')}</option>
          <option value="event">{__uiText('ลูกค้าทำสิ่งที่กำหนด')}</option>
        </Select>
      </Field>
      {g?.kind === 'event' && (
        <>
          <EventSelect value={g.eventName} definitions={definitions} onChange={(eventName) => set({ kind: 'event', eventName, filters: [] })} />
          {pick(definitions, g.eventName)?.evidence === 'browser' && <Hint>{__uiText('ข้อมูลจากหน้าเว็บไม่ใช่หลักฐานการซื้อ ถ้าเป้าหมายคือการสั่งซื้อ ให้เลือก "ลูกค้าสั่งซื้อแล้ว"')}</Hint>}
          {pick(definitions, g.eventName) && <FilterEditor filters={g.filters} types={typesOf(pick(definitions, g.eventName))}
            triggerTypes={triggerDef ? typesOf(triggerDef) : null} onChange={(filters) => set({ ...g, filters })} />}
        </>
      )}
    </div>
  );
}
