// ui-copy-migration: only literal UI copy and notification templates
import { useState } from 'react';
import { Button, Checkbox, Field, Hint, Input, Select, Textarea, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
import type { WebhookSecretItem, WebhookTestResult, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import { flowsApi } from '../../../../lib/api';
import { urlWarning } from './form-helpers';

type Webhook = Extract<WorkflowStep, { type: 'webhook' }>;
const SECRET_REF = /^\{\{secret:([0-9a-f-]{36})\}\}$/i;

/**
 * Webhook step: method, URL, headers (a row can be a stored secret), body template, test send. A typed secret lives
 * only in this component's state until "บันทึกค่าลับ"; the step keeps `{{secret:<id>}}`, never the value.
 */
export function WebhookForm({ step, meta, secrets, onChange, onSecretsChanged }: {
  step: Webhook; meta: WorkflowMeta; secrets: WebhookSecretItem[]; onChange: (s: WorkflowStep) => void; onSecretsChanged: () => void;
}) {
  __useUiLocale();
  const [draftSecret, setDraftSecret] = useState<Record<number, string>>({});
  const [result, setResult] = useState<WebhookTestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setHeader = (i: number, patch: Partial<Webhook['headers'][number]>) => onChange({ ...step, headers: step.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const warning = urlWarning(step.url);
  let host = '';
  try { host = new URL(step.url).hostname; } catch { /* not a URL yet */ }

  const saveSecret = async (i: number) => {
    const value = draftSecret[i];
    if (!value) return;
    setBusy(true); setError(null);
    try {
      const ref = SECRET_REF.exec(step.headers[i].value)?.[1];
      const item = ref ? await flowsApi.secrets.replace(ref, value) : await flowsApi.secrets.create(`${step.headers[i].key || 'header'} · ${host || 'webhook'}`, value);
      setHeader(i, { value: `{{secret:${item.id}}}` });
      setDraftSecret((d) => { const next = { ...d }; delete next[i]; return next; });
      onSecretsChanged();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setError(null); setResult(null);
    try { setResult(await flowsApi.webhookTest(step)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="w-28 shrink-0"><Select aria-label="Method" value={step.method} onChange={(e) => onChange({ ...step, method: e.target.value as Webhook['method'], ...(e.target.value === 'GET' ? { body: '' } : {}) })}>
          {['POST', 'PUT', 'PATCH', 'GET'].map((m) => <option key={m}>{m}</option>)}
        </Select></div>
        <Input className="min-w-0 flex-1" placeholder="https://" value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} aria-label="URL" />
      </div>
      {warning === 'scheme' && <Hint>{__uiText('URL ต้องขึ้นต้นด้วย http:// หรือ https://')}</Hint>}
      {warning === 'internal' && <Hint>{__uiText('URL นี้ชี้ไปที่เครือข่ายภายใน ระบบจะไม่ยิงให้')}</Hint>}

      <Field label={__uiText('Headers')}>
        {step.headers.map((h, i) => {
          const ref = SECRET_REF.exec(h.value)?.[1];
          const isSecret = !!ref || draftSecret[i] !== undefined;
          const name = ref ? secrets.find((s) => s.id === ref)?.name ?? __uiText('ค่าลับถูกลบแล้ว') : '';
          return (
            <div key={i} className="mb-2 space-y-1 rounded-lg border border-outline-variant p-2">
              <div className="flex gap-2">
                <Input placeholder="Header" aria-label={__uiText('ชื่อ header')} value={h.key} onChange={(e) => setHeader(i, { key: e.target.value })} />
                {isSecret
                  ? <Input type="password" autoComplete="off" aria-label={__uiText('ค่าลับ')} placeholder={ref ? `•••• (${name})` : __uiText('ใส่ค่าลับ')} value={draftSecret[i] ?? ''}
                      onChange={(e) => setDraftSecret((d) => ({ ...d, [i]: e.target.value }))} />
                  : <Input placeholder={__uiText('ค่า')} aria-label={__uiText('ค่า header')} value={h.value} onChange={(e) => setHeader(i, { value: e.target.value })} />}
                <Button size="sm" variant="ghost" icon="close" aria-label={__uiText('ลบ header')} title={__uiText('ลบ header')}
                  onClick={() => onChange({ ...step, headers: step.headers.filter((_, j) => j !== i) })} />
              </div>
              <div className="flex items-center gap-3">
                <Checkbox checked={isSecret} disabled={!!ref} label={__uiText('ความลับ (เก็บเข้ารหัส ดูย้อนหลังไม่ได้)')}
                  onChange={(e) => setDraftSecret((d) => { const next = { ...d }; if (e.target.checked) next[i] = ''; else delete next[i]; return next; })} />
                {isSecret && <Button size="sm" disabled={busy || !draftSecret[i]} onClick={() => saveSecret(i)}>{ref ? __uiText('เปลี่ยนค่า') : __uiText('บันทึกค่าลับ')}</Button>}
              </div>
            </div>
          );
        })}
        {step.headers.length < meta.limits.maxHeaders && (
          <Button size="sm" icon="add" onClick={() => onChange({ ...step, headers: [...step.headers, { key: '', value: '' }] })}>{__uiText('เพิ่ม header')}</Button>
        )}
      </Field>

      {step.method !== 'GET' && (
        <Field label={__uiText('Body')}>
          <Textarea rows={6} className="font-mono text-xs" value={step.body ?? ''} placeholder={'{"email":"{{user_email}}"}'} onChange={(e) => onChange({ ...step, body: e.target.value })} />
          <div className="mt-1 flex flex-wrap gap-1">
            {meta.templateVars.map((v) => (
              <button key={v.key} type="button" title={v.label} className="rounded border border-outline-variant px-1.5 py-0.5 font-mono text-[11px]"
                onClick={() => onChange({ ...step, body: `${step.body ?? ''}{{${v.key}}}` })}>{`{{${v.key}}}`}</button>
            ))}
          </div>
        </Field>
      )}

      <Button disabled={busy || !step.url} onClick={test}>{__uiText('ส่งทดสอบ (ข้อมูลตัวอย่าง)')}</Button>
      {result && (
        <div className="rounded-lg bg-surface-container p-2 text-xs">
          <div>{result.error ? __uiText('ไม่สำเร็จ: {0}', { 0: result.error }) : __uiText('ตอบกลับ {0}', { 0: result.status ?? '-' })}</div>
          {result.body && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{result.body}</pre>}
        </div>
      )}
      {error && <Hint>{error}</Hint>}
    </div>
  );
}
