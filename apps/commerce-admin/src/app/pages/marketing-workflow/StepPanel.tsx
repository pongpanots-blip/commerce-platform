// ui-copy-migration: only literal UI copy and notification templates
import { Button, Panel, PanelHead, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { SegmentOption, WebhookSecretItem, WorkflowInput, WorkflowIssue, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { AudienceForm, ConditionForm, CouponForm, describeStep, NotifyForm, WaitForm, type CouponOption } from './forms/StepForms';
import { SplitForm } from './forms/SplitForm';
import { TriggerForm } from './forms/TriggerForm';
import { WebhookForm } from './forms/WebhookForm';
import { TRIGGER } from './workflow-graph';

/** Right panel: the selected card's settings (Entry → trigger + workflow settings). */
export function StepPanel(p: {
  selection: string | null; input: WorkflowInput; meta: WorkflowMeta; issues: WorkflowIssue[]; segments: SegmentOption[]; coupons: CouponOption[];
  secrets: WebhookSecretItem[]; onChangeInput: (patch: Partial<WorkflowInput>) => void; onChangeStep: (s: WorkflowStep) => void;
  onRemoveStep: (id: string) => void; onSecretsChanged: () => void;
}) {
  __useUiLocale();
  const step = p.input.steps.find((s) => s.id === p.selection);
  if (!p.selection || (p.selection !== TRIGGER && !step)) {
    return <Panel><PanelHead title={__uiText('ตั้งค่า')} /><p className="p-4 text-sm text-on-surface-variant">{__uiText('เลือกการ์ดบน canvas เพื่อตั้งค่า')}</p></Panel>;
  }
  const issues = p.issues.filter((i) => (p.selection === TRIGGER ? i.stepId === null : i.stepId === p.selection));
  const title = p.selection === TRIGGER ? __uiText('Entry') : describeStep(step!, p).title;
  return (
    <Panel>
      <PanelHead title={title} />
      <div className="space-y-4 p-4">
        {issues.map((i) => <p key={i.code} className="rounded bg-error-container px-2 py-1 text-xs text-on-error-container">{i.message}</p>)}
        {p.selection === TRIGGER && <TriggerForm input={p.input} onChange={p.onChangeInput} />}
        {step?.type === 'audience' && <AudienceForm step={step} segments={p.segments} onChange={p.onChangeStep} />}
        {step?.type === 'wait' && <WaitForm step={step} maxMinutes={p.meta.limits.maxWaitMinutes} onChange={p.onChangeStep} />}
        {step?.type === 'condition' && <ConditionForm step={step} meta={p.meta} onChange={p.onChangeStep} />}
        {step?.type === 'split' && <SplitForm step={step} limits={p.meta.limits} onChange={p.onChangeStep} />}
        {step?.type === 'webhook' && <WebhookForm step={step} meta={p.meta} secrets={p.secrets} onChange={p.onChangeStep} onSecretsChanged={p.onSecretsChanged} />}
        {step?.type === 'action' && step.action.kind === 'notify' && <NotifyForm step={step} onChange={p.onChangeStep} />}
        {step?.type === 'action' && step.action.kind === 'grant_coupon' && <CouponForm step={step} coupons={p.coupons} onChange={p.onChangeStep} />}
        {step && <Button variant="danger-ghost" icon="close" onClick={() => p.onRemoveStep(step.id)}>{__uiText('ลบขั้นตอนนี้')}</Button>}
      </div>
    </Panel>
  );
}
