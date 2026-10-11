// ui-copy-migration: only literal UI copy and notification templates
import { Button, Field, Hint, Input, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { evenPercents } from './form-helpers';

type Split = Extract<WorkflowStep, { type: 'split' }>;
const LETTERS = 'ABCD';

export function SplitForm({ step, limits, onChange }: { step: Split; limits: WorkflowMeta['limits']; onChange: (s: WorkflowStep) => void }) {
  __useUiLocale();
  const sum = step.branches.reduce((a, b) => a + (b.percent || 0), 0);
  const set = (i: number, patch: Partial<Split['branches'][number]>) => onChange({ ...step, branches: step.branches.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const even = () => { const p = evenPercents(step.branches.length); onChange({ ...step, branches: step.branches.map((b, i) => ({ ...b, percent: p[i] })) }); };
  return (
    <div className="space-y-3">
      {step.branches.map((b, i) => (
        <div key={b.id} className="flex items-end gap-2">
          <Field label={__uiText('ชื่อกลุ่ม')}><Input value={b.label} maxLength={40} onChange={(e) => set(i, { label: e.target.value })} /></Field>
          <Field label={__uiText('สัดส่วน (%)')}><Input type="number" min={1} max={99} value={b.percent} onChange={(e) => set(i, { percent: Math.trunc(Number(e.target.value) || 0) })} /></Field>
          {step.branches.length > limits.minSplitBranches && (
            <Button size="sm" variant="danger-ghost" icon="delete" aria-label={__uiText('ลบกลุ่มนี้')} title={__uiText('ลบกลุ่มนี้')}
              onClick={() => { if (window.confirm(__uiText('ลบกลุ่ม "{0}"? ขั้นตอนที่ต่อจากกลุ่มนี้จะไม่ถูกเชื่อมอีก', { 0: b.label }))) onChange({ ...step, branches: step.branches.filter((_, j) => j !== i) }); }} />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        {step.branches.length < limits.maxSplitBranches && (
          <Button size="sm" icon="add" onClick={() => onChange({ ...step, branches: [...step.branches, { id: crypto.randomUUID(), label: LETTERS[step.branches.length] ?? 'X', percent: 0, nextId: null }] })}>
            {__uiText('เพิ่มกลุ่ม')}
          </Button>
        )}
        <Button size="sm" onClick={even}>{__uiText('แบ่งเท่ากัน')}</Button>
      </div>
      {sum !== 100 && <p className="text-[11px] text-warn">{__uiText('สัดส่วนรวมตอนนี้ {0}% ต้องรวมได้ 100%', { 0: sum })}</p>}
      <Hint>{__uiText('ลูกค้าคนเดิมอยู่กลุ่มเดิมเสมอ ดูผลแต่ละกลุ่มได้ที่แท็บผลลัพธ์')}</Hint>
    </div>
  );
}
