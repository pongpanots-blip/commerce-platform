// ui-copy-migration: only literal UI copy and notification templates
import '../../workflow-editor/josh/josh-tailwind.css';
import { useState } from 'react';
import { Button, Checkbox, Chip, Field, Hint, Input, Textarea, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { NotifyChannel, SegmentOption, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { flowsApi } from '../../../../lib/api';
import { CouponPicker, NotifyTemplatePicker } from '../../workflow-editor/josh/MarketingStepSidePanel';
import { marketingChannelLabel } from '../../workflow-editor/josh/trigger-rule.helpers';
import { itemOf } from '../palette-items';
import { describeRule } from '../../marketing-events/rule-helpers';

type Of<T extends WorkflowStep['type']> = Extract<WorkflowStep, { type: T }>;
export interface CouponOption { id: string; coupon_code: string; title: string }
const CHANNELS: NotifyChannel[] = ['push', 'email', 'in_app'];

export function describeStep(step: WorkflowStep, ctx: { segments: SegmentOption[]; coupons: CouponOption[] }): { title: string; subtitle: string } {
  const label = (id: string) => itemOf(id)?.label ?? id;
  switch (step.type) {
    case 'audience': return { title: label('audience'), subtitle: (step.segmentIds ?? []).map((id) => ctx.segments.find((s) => s.id === id)?.name ?? id).join(', ') || __uiText('ทุกคน') };
    case 'wait': return { title: label('wait'), subtitle: __uiText('{0} ชม. {1} นาที', { 0: step.hours, 1: step.minutes ?? 0 }) };
    case 'condition': return { title: label('condition'), subtitle: step.expression };
    case 'split': return { title: label('split'), subtitle: step.branches.map((b) => `${b.label} ${b.percent}%`).join(' / ') };
    case 'webhook': return { title: label('webhook'), subtitle: `${step.method} ${step.url || '—'}` };
    case 'wait_event': return { title: label('wait_event'), subtitle: `${step.eventName || '—'} · ${step.timeoutHours} ${__uiText('ชม.')}` };
    case 'event_split': return { title: label('event_split'), subtitle: describeRule(step.rule, new Map()) };
    case 'action': {
      const a = step.action;
      if (a.kind === 'notify') return { title: a.channels.map((c) => label(c)).join(' + ') || label('push'), subtitle: a.templateKey || __uiText('ยังไม่ได้เลือกเทมเพลต') };
      return { title: label('grant_coupon'), subtitle: ctx.coupons.find((c) => c.id === a.couponId)?.coupon_code ?? __uiText('ยังไม่เลือกคูปอง') };
    }
  }
}

export function AudienceForm({ step, segments, onChange }: { step: Of<'audience'>; segments: SegmentOption[]; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const toggle = (key: 'segmentIds' | 'excludeSegmentIds', id: string) => {
    const cur = step[key] ?? [];
    onChange({ ...step, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  return (
    <div className="space-y-4">
      {(['segmentIds', 'excludeSegmentIds'] as const).map((key) => (
        <Field key={key} label={key === 'segmentIds' ? __uiText('อยู่ในกลุ่มลูกค้าใดก็ได้') : __uiText('ยกเว้นกลุ่มลูกค้า')}>
          {!segments.length && <Hint>{__uiText('ยังไม่มีกลุ่มลูกค้าที่ใช้กับข้อความอัตโนมัตินี้ได้')}</Hint>}
          <div className="space-y-1">
            {segments.map((s) => (
              <Checkbox key={s.id} checked={(step[key] ?? []).includes(s.id)} onChange={() => toggle(key, s.id)}
                label={`${s.name}${s.memberCount != null ? ` (${s.memberCount})` : ''}`} />
            ))}
          </div>
        </Field>
      ))}
    </div>
  );
}

export function WaitForm({ step, maxMinutes, onChange }: { step: Of<'wait'>; maxMinutes: number; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const total = step.hours * 60 + (step.minutes ?? 0);
  const int = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Field label={__uiText('ชั่วโมง')}><Input type="number" min={0} value={step.hours} onChange={(e) => onChange({ ...step, hours: int(e.target.value) })} /></Field>
        <Field label={__uiText('นาที')}><Input type="number" min={0} max={59} value={step.minutes ?? 0} onChange={(e) => onChange({ ...step, minutes: Math.min(59, int(e.target.value)) })} /></Field>
      </div>
      {(total < 1 || total > maxMinutes) && <Hint>{__uiText('รอได้ 1 นาที ถึง 30 วัน')}</Hint>}
    </div>
  );
}

export function ConditionForm({ step, meta, onChange }: { step: Of<'condition'>; meta: WorkflowMeta; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);
  const sample = (type: string) => (type === 'number' ? '>= 1' : type === 'segment' ? '== "<segment-id>"' : '== true');
  return (
    <div className="space-y-3">
      <Field label={__uiText('เงื่อนไข')}>
        <Textarea rows={3} value={step.expression} className="font-mono text-xs" onChange={(e) => { setCheck(null); onChange({ ...step, expression: e.target.value }); }} />
      </Field>
      <div className="flex flex-wrap gap-1">
        {meta.expressionFields.map((f) => (
          <button key={f.field} type="button" title={f.label} className="rounded border border-outline-variant px-2 py-0.5 font-mono text-xs"
            onClick={() => onChange({ ...step, expression: `${step.expression}${step.expression ? ' AND ' : ''}${f.field} ${sample(f.type)}` })}>
            {f.field}
          </button>
        ))}
      </div>
      <Hint>{__uiText('ตัวอย่าง: still_no_order == true AND user.order_count >= 2 ถ้าเงื่อนไขเป็นจริงไปทาง ใช่ ถ้าไม่จริงไปทาง ไม่ใช่')}</Hint>
      <Button size="sm" onClick={async () => setCheck(await flowsApi.validateExpression(step.expression))}>{__uiText('ตรวจเงื่อนไข')}</Button>
      {check && (check.ok ? <Chip tone="ok" dot>{__uiText('เงื่อนไขถูกต้อง')}</Chip> : <p className="text-[11px] text-danger">{check.error}</p>)}
    </div>
  );
}

export function NotifyForm({ step, onChange }: { step: Of<'action'>; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const a = step.action;
  if (a.kind !== 'notify') return null;
  const toggle = (c: NotifyChannel) => onChange({ ...step, action: { ...a, channels: a.channels.includes(c) ? a.channels.filter((x) => x !== c) : [...a.channels, c] } });
  return (
    <div className="space-y-3">
      <Field label={__uiText('ช่องทาง')}>
        <div className="flex gap-3">{CHANNELS.map((c) => <Checkbox key={c} checked={a.channels.includes(c)} onChange={() => toggle(c)} label={marketingChannelLabel(c)} />)}</div>
      </Field>
      {/* The picker carries its own label (and a link), so it is not wrapped in another <label>. */}
      <div className="josh-tw"><NotifyTemplatePicker templateKey={a.templateKey} onSelect={(key) => onChange({ ...step, action: { ...a, templateKey: key } })} /></div>
      <Hint>{__uiText('ระบบร้านค้าเป็นผู้ส่งจริง และไม่ส่งให้ลูกค้าที่ปิดรับข่าวสาร')}</Hint>
    </div>
  );
}

export function CouponForm({ step, coupons, onChange }: { step: Of<'action'>; coupons: CouponOption[]; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const a = step.action;
  if (a.kind !== 'grant_coupon') return null;
  // CouponPicker carries its own "คูปอง" label.
  return <div className="josh-tw"><CouponPicker coupons={coupons} value={a.couponId || undefined} onChange={(couponId) => onChange({ ...step, action: { kind: 'grant_coupon', couponId } })} /></div>;
}
