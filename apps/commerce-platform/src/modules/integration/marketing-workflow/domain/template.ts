import type { TriggerEvent, WebhookHeader, WebhookMethod, WorkflowStep } from './workflow.types';

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
/** A header value that is exactly a secret reference; the sender swaps in the stored value. */
export const SECRET_REF = /^\{\{secret:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}\}$/i;
export type RenderMode = 'url' | 'json' | 'header' | 'text';

/** josh's `{{name}}` syntax; unknown names stay visible so typos show up in tests. Escapes for where it lands. */
export function renderTemplate(text: string, vars: Record<string, string>, mode: RenderMode): string {
  return text.replace(VAR_RE, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) return match;
    if (mode === 'url') return encodeURIComponent(value);
    if (mode === 'json') return JSON.stringify(value).slice(1, -1);
    if (mode === 'header') return value.replace(/[\r\n]+/g, ' ');
    return value;
  });
}

export const TEMPLATE_VARS = [
  { key: 'user_name', label: 'ชื่อลูกค้า' }, { key: 'user_first_name', label: 'ชื่อจริงลูกค้า' }, { key: 'user_last_name', label: 'นามสกุลลูกค้า' },
  { key: 'user_email', label: 'อีเมลลูกค้า' }, { key: 'user_phone', label: 'เบอร์โทรลูกค้า' }, { key: 'user_custype', label: 'ประเภทลูกค้า (custype)' },
  { key: 'cuisine_name', label: 'ประเภทร้าน (Cuisine)' }, { key: 'today', label: 'วันที่วันนี้' }, { key: 'user_id', label: 'รหัสลูกค้า' },
  { key: 'workflow_id', label: 'รหัส workflow' }, { key: 'workflow_name', label: 'ชื่อ workflow' }, { key: 'enrollment_id', label: 'รหัสการเข้า workflow' },
  { key: 'step_id', label: 'รหัส step' }, { key: 'event.name', label: 'ชื่อ event ที่เริ่ม workflow' }, { key: 'device.id', label: 'รหัสอุปกรณ์' },
  { key: 'device.platform', label: 'แพลตฟอร์มของอุปกรณ์' },
] as const;

export interface VarContext { userId: string; workflowId: string; workflowName: string; enrollmentId: string; stepId: string }

/** Variables from the josh customer copy (`josh_customers.data`) plus workflow ids. */
export function webhookVars(customer: Record<string, unknown> | null, ctx: VarContext, now = new Date()): Record<string, string> {
  const s = (k: string) => (typeof customer?.[k] === 'string' ? (customer[k] as string).trim() : '');
  const first = s('first_name'); const last = s('last_name');
  return {
    user_id: ctx.userId, user_name: [first, last].filter(Boolean).join(' ') || s('nickname'), user_first_name: first, user_last_name: last,
    user_email: s('email'), user_phone: s('mobile_phone'), user_custype: s('custype'), cuisine_name: s('cuisine_name'),
    today: now.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' }),
    workflow_id: ctx.workflowId, workflow_name: ctx.workflowName, enrollment_id: ctx.enrollmentId, step_id: ctx.stepId,
  };
}

export interface RenderedWebhook { method: WebhookMethod; url: string; headers: WebhookHeader[]; body: string | null }

export function renderWebhook(step: Extract<WorkflowStep, { type: 'webhook' }>, vars: Record<string, string>): RenderedWebhook {
  const contentType = step.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? '';
  const bodyMode: RenderMode = !contentType || /json/i.test(contentType) ? 'json' : 'text';
  return {
    method: step.method,
    url: renderTemplate(step.url, vars, 'url'),
    headers: step.headers.map((h) => ({ key: h.key, value: SECRET_REF.test(h.value) ? h.value : renderTemplate(h.value, vars, 'header') })),
    body: step.method === 'GET' || !step.body ? null : renderTemplate(step.body, vars, bodyMode),
  };
}

export const secretIdsOf = (headers: WebhookHeader[]): string[] =>
  headers.map((h) => SECRET_REF.exec(h.value)?.[1]).filter((v): v is string => !!v);


/** `{{event.name}}`, `{{event.<attribute>}}`, `{{device.id}}`, `{{device.platform}}` (spec §12). */
export function eventVars(ev: TriggerEvent | null, device: { id: string; platform: string } | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (ev) {
    out['event.name'] = ev.name;
    for (const [k, v] of Object.entries(ev.attributes ?? {})) if (v !== null && v !== undefined) out[`event.${k}`] = String(v);
  }
  if (device) { out['device.id'] = device.id; out['device.platform'] = device.platform; }
  return out;
}
