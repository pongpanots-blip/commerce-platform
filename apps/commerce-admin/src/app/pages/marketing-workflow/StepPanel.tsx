// ui-copy-migration: only literal UI copy and notification templates
import { Button, Panel, PanelHead, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { DynamicSegment, EventDefinition, EventTriggerConfig, SegmentOption, WebhookSecretItem, WorkflowInput, WorkflowIssue, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { AudienceEventFields, EventSplitForm, WaitEventForm } from './forms/EventForms';
import { AudienceForm, ConditionForm, CouponForm, describeStep, NotifyForm, WaitForm, type CouponOption } from './forms/StepForms';
import { SplitForm } from './forms/SplitForm';
import { TriggerForm } from './forms/TriggerForm';
import { WebhookForm } from './forms/WebhookForm';
import { confirmRemoveStep } from './NodeCard';
import { TRIGGER } from './workflow-graph';

/** Right panel: the selected card's settings (Entry → trigger + workflow settings). */
export function StepPanel(p: {
  selection: string | null; input: WorkflowInput; meta: WorkflowMeta; issues: WorkflowIssue[]; segments: SegmentOption[]; coupons: CouponOption[];
  secrets: WebhookSecretItem[]; definitions: EventDefinition[]; dynamicSegments: DynamicSegment[]; onChangeInput: (patch: Partial<WorkflowInput>) => void; onChangeStep: (s: WorkflowStep) => void;
  onRemoveStep: (id: string) => void; onSecretsChanged: () => void;
}) {
  __useUiLocale();
  const step = p.input.steps.find((s) => s.id === p.selection);
  if (!p.selection || (p.selection !== TRIGGER && !step)) {
    return <Panel><PanelHead title={__uiText('ตั้งค่า')} /><p className="p-4 text-sm text-on-surface-variant">{__uiText('เลือกการ์ดในแผนภาพเพื่อตั้งค่า')}</p></Panel>;
  }
  const issues = p.issues.filter((i) => (p.selection === TRIGGER ? i.stepId === null : i.stepId === p.selection));
  const title = p.selection === TRIGGER ? __uiText('จุดเริ่ม') : describeStep(step!, p).title;
  return (
    <Panel>
      <PanelHead title={title} />
      <div className="space-y-4 p-4">
        {issues.map((i) => <p key={i.code} className="rounded bg-danger-container px-2 py-1 text-xs text-danger">{i.message}</p>)}
        {p.selection === TRIGGER && <TriggerForm input={p.input} definitions={p.definitions} onChange={p.onChangeInput} />}
        {step?.type === 'audience' && <><AudienceForm step={step} segments={p.segments} onChange={p.onChangeStep} />
          <AudienceEventFields step={step} definitions={p.definitions} segments={p.dynamicSegments} onChange={p.onChangeStep} /></>}
        {step?.type === 'wait_event' && <WaitEventForm step={step} definitions={p.definitions} maxMinutes={p.meta.limits.maxWaitMinutes} onChange={p.onChangeStep}
          triggerDef={p.input.triggerType === 'event' ? p.definitions.find((d) => d.name === (p.input.triggerConfig as EventTriggerConfig).eventName) : undefined} />}
        {step?.type === 'event_split' && <EventSplitForm step={step} definitions={p.definitions} segments={p.dynamicSegments} onChange={p.onChangeStep} />}
        {step?.type === 'wait' && <WaitForm step={step} maxMinutes={p.meta.limits.maxWaitMinutes} onChange={p.onChangeStep} />}
        {step?.type === 'condition' && <ConditionForm step={step} meta={p.meta} onChange={p.onChangeStep} />}
        {step?.type === 'split' && <SplitForm step={step} limits={p.meta.limits} onChange={p.onChangeStep} />}
        {step?.type === 'webhook' && <WebhookForm step={step} meta={p.meta} secrets={p.secrets} onChange={p.onChangeStep} onSecretsChanged={p.onSecretsChanged} />}
        {step?.type === 'action' && step.action.kind === 'notify' && <NotifyForm step={step} onChange={p.onChangeStep} />}
        {step?.type === 'action' && step.action.kind === 'grant_coupon' && <CouponForm step={step} coupons={p.coupons} onChange={p.onChangeStep} />}
        {step && (
          <div className="border-t border-outline-variant/60 pt-3">
            <Button variant="danger-ghost" size="sm" icon="delete" onClick={() => { if (confirmRemoveStep()) p.onRemoveStep(step.id); }}>{__uiText('ลบขั้นตอนนี้')}</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
