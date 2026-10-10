// ui-copy-migration: only literal UI copy and notification templates
import '../../workflow-editor/josh/josh-tailwind.css';
import { Field, Input, Select, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { EventDefinition, EventTriggerConfig, TriggerConfig, TriggerType, WorkflowInput } from '@cp/marketing-workflow';
import { EventTriggerFields, GoalFields } from './EventForms';
import { OrderMilestoneFields, ScheduledTriggerFields } from '../../workflow-editor/josh/TriggerRuleBuilder';
import { ScheduleEditor } from '../../workflow-editor/josh/MarketingWorkflowEditor';
import { PALETTE } from '../palette-items';

export const TRIGGER_DEFAULTS: Record<TriggerType, TriggerConfig> = {
  scheduled: { time: '18:00', daysOfWeek: [], timezone: 'Asia/Bangkok' },
  order_milestone: { metric: 'single_order_total', operator: '>=', value: 5000 },
  first_login: {}, app_login: {},
  event: { eventName: '', filters: [], includeGuests: false },
};

const METRIC_LABEL: Record<string, string> = {
  get single_order_total() { return __uiText('ออเดอร์เดียว'); },
  get lifetime_spend() { return __uiText('ยอดซื้อสะสม'); },
  get lifetime_order_count() { return __uiText('จำนวนออเดอร์สะสม'); },
};

export function describeTrigger(type: TriggerType, config: TriggerConfig): { title: string; subtitle: string } {
  const title = PALETTE[0].items.find((i) => i.id === type)?.label ?? type;
  const c = config as Record<string, unknown>;
  if (type === 'scheduled') {
    const days = (c.daysOfWeek as number[] | undefined)?.length ? __uiText('บางวัน') : __uiText('ทุกวัน');
    return { title, subtitle: `${days} ${String(c.time ?? '')}` };
  }
  if (type === 'event') return { title, subtitle: (c.eventName as string) || __uiText('ยังไม่เลือก event') };
  if (type === 'order_milestone') return { title, subtitle: `${METRIC_LABEL[String(c.metric)] ?? String(c.metric)} ${String(c.operator)} ${Number(c.value ?? 0).toLocaleString()}` };
  return { title, subtitle: __uiText('นับเฉพาะหลังกด Activate') };
}

/** Entry card: trigger type + its config, schedule window, cooldown / holdout / conversion / exit goal. */
export function TriggerForm({ input, definitions, onChange }: { input: WorkflowInput; definitions: EventDefinition[]; onChange: (patch: Partial<WorkflowInput>) => void }) {
  __useUiLocale();
  const num = (v: string) => (v === '' ? 0 : Math.trunc(Number(v)));
  return (
    <div className="space-y-4">
      <Field label={__uiText('เริ่มเมื่อ')}>
        <Select value={input.triggerType} onChange={(e) => { const t = e.target.value as TriggerType; onChange({ triggerType: t, triggerConfig: TRIGGER_DEFAULTS[t] }); }}>
          {PALETTE[0].items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </Select>
      </Field>
      {(input.triggerType === 'first_login' || input.triggerType === 'app_login') && (
        <p className="text-xs text-on-surface-variant">{__uiText('นับเฉพาะการเข้าแอปหลังกด Activate — ลูกค้าเดิมที่เคยเข้าแล้วจะไม่ถูกส่งย้อนหลัง')}</p>
      )}
      {input.triggerType === 'event' && <EventTriggerFields config={input.triggerConfig as EventTriggerConfig} definitions={definitions} onChange={(c) => onChange({ triggerConfig: c })} />}
      <div className="josh-tw">
        {input.triggerType === 'scheduled' && <ScheduledTriggerFields config={input.triggerConfig as never} onUpdateTrigger={(c) => onChange({ triggerConfig: c as never })} />}
        {input.triggerType === 'order_milestone' && <OrderMilestoneFields config={input.triggerConfig as never} onUpdateTrigger={(c) => onChange({ triggerConfig: c as never })} />}
      </div>
      <Field label={__uiText('ช่วงเวลาทำงาน')}>
        <div className="josh-tw"><ScheduleEditor schedule={(input.schedule ?? null) as never} onChange={(s) => onChange({ schedule: s as never })} /></div>
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label={__uiText('Cooldown (วัน)')}><Input type="number" min={0} max={365} value={input.cooldownDays} onChange={(e) => onChange({ cooldownDays: num(e.target.value) })} /></Field>
        <Field label={__uiText('Holdout %')}><Input type="number" min={0} max={50} value={input.holdoutPercent} onChange={(e) => onChange({ holdoutPercent: num(e.target.value) })} /></Field>
        <Field label={__uiText('วัด conversion (วัน)')}><Input type="number" min={1} max={90} value={input.conversionWindowDays} onChange={(e) => onChange({ conversionWindowDays: num(e.target.value) })} /></Field>
      </div>
      <GoalFields input={input} definitions={definitions} onChange={onChange} />
    </div>
  );
}
