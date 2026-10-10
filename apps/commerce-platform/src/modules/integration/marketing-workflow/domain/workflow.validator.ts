import { checkExpression } from './expression.fields';
import { SECRET_REF } from './template';
import { LIMITS, NOTIFY_CHANNELS, nextIdsOf, WEBHOOK_METHODS } from './workflow.types';
import type { WorkflowInput, WorkflowIssue, WorkflowStep } from './workflow.types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const TEMPLATE_KEY = /^[A-Za-z0-9_.-]{1,100}$/;
const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
type Add = (stepId: string | null, code: string, message: string) => void;

/** Everything that blocks activation (a draft may be saved with issues). Messages are shown to staff. */
export function validateWorkflow(w: WorkflowInput): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const add: Add = (stepId, code, message) => issues.push({ stepId, code, message });

  if (!w.name?.trim() || w.name.length > 200) add(null, 'name', 'ตั้งชื่อ workflow (ไม่เกิน 200 ตัวอักษร)');
  if (!isInt(w.cooldownDays, 0, 365)) add(null, 'cooldown', 'cooldown ต้องเป็น 0–365 วัน');
  if (!isInt(w.holdoutPercent, 0, 50)) add(null, 'holdout', 'holdout ต้องเป็น 0–50%');
  if (!isInt(w.conversionWindowDays, 1, 90)) add(null, 'conversion_window', 'ช่วงวัด conversion ต้องเป็น 1–90 วัน');
  validateTrigger(w, add);

  const ids = new Set<string>();
  for (const s of w.steps) {
    if (!UUID.test(s.id)) add(s.id, 'bad_id', 'รหัส step ไม่ถูกต้อง');
    if (ids.has(s.id)) add(s.id, 'duplicate_id', 'รหัส step ซ้ำ');
    ids.add(s.id);
  }
  if (!w.entryStepId) add(null, 'no_entry', 'ยังไม่ได้ต่อ Entry เข้ากับ step แรก');
  else if (!ids.has(w.entryStepId)) add(null, 'bad_entry', 'Entry ชี้ไปที่ step ที่ไม่มีอยู่');
  for (const s of w.steps) if (nextIdsOf(s).some((n) => n !== null && !ids.has(n))) add(s.id, 'bad_next', 'เส้นทางชี้ไปที่ step ที่ไม่มีอยู่');
  if (hasCycle(w.steps)) add(null, 'cycle', 'flow วนกลับมาที่เดิม');

  const count = (t: WorkflowStep['type']) => w.steps.filter((s) => s.type === t).length;
  if (count('audience') > LIMITS.maxAudienceSteps) add(null, 'too_many_audiences', 'มี Audience filter ได้ 1 อัน');
  if (count('wait') > LIMITS.maxWaitSteps) add(null, 'too_many_waits', `มี Time Delay ได้ไม่เกิน ${LIMITS.maxWaitSteps} อัน`);
  if (count('condition') > LIMITS.maxConditionSteps) add(null, 'too_many_conditions', `มี Condition ได้ไม่เกิน ${LIMITS.maxConditionSteps} อัน`);

  for (const s of w.steps) validateStep(s, (code, message) => add(s.id, code, message));
  return issues;
}

function validateTrigger(w: WorkflowInput, add: Add) {
  const c = (w.triggerConfig ?? {}) as Record<string, unknown>;
  if (w.triggerType === 'scheduled') {
    const days = c.daysOfWeek;
    if (typeof c.time !== 'string' || !HHMM.test(c.time) || (days !== undefined && (!Array.isArray(days) || !days.every((d) => isInt(d, 0, 6)))))
      add(null, 'trigger_config', 'ตั้งเวลา (HH:mm) และวันให้ถูกต้อง');
  } else if (w.triggerType === 'order_milestone') {
    if (!['single_order_total', 'lifetime_spend', 'lifetime_order_count'].includes(c.metric as string) || !['>=', '>'].includes(c.operator as string)
      || typeof c.value !== 'number' || !(c.value > 0)) add(null, 'trigger_config', 'ตั้งเงื่อนไขยอดสั่งซื้อให้ครบ');
  } else if (w.triggerType !== 'first_login' && w.triggerType !== 'app_login') add(null, 'trigger_type', 'ประเภท trigger นี้ยังไม่รองรับ');
}

function validateStep(s: WorkflowStep, add: (code: string, message: string) => void) {
  switch (s.type) {
    case 'audience':
      if (![...(s.segmentIds ?? []), ...(s.excludeSegmentIds ?? [])].every((x) => UUID.test(x))) add('audience_segment', 'segment ไม่ถูกต้อง');
      return;
    case 'wait': {
      const total = (s.hours ?? 0) * 60 + (s.minutes ?? 0);
      if (!isInt(s.hours, 0, LIMITS.maxWaitMinutes) || !isInt(s.minutes ?? 0, 0, 59) || total < 1 || total > LIMITS.maxWaitMinutes)
        add('wait_duration', 'รอได้ 1 นาที ถึง 30 วัน');
      return;
    }
    case 'condition': {
      const r = checkExpression(s.expression ?? '');
      if ('error' in r) add('condition_expression', r.error);
      return;
    }
    case 'split': {
      if (s.branches.length < LIMITS.minSplitBranches || s.branches.length > LIMITS.maxSplitBranches) add('split_count', 'A/B Split มีได้ 2–4 กิ่ง');
      if (!s.branches.every((b) => isInt(b.percent, 1, 99))) add('split_percent', 'สัดส่วนแต่ละกิ่งต้องเป็นจำนวนเต็ม 1–99');
      if (s.branches.reduce((a, b) => a + (b.percent ?? 0), 0) !== 100) add('split_sum', 'สัดส่วนรวมต้องเท่ากับ 100%');
      if (new Set(s.branches.map((b) => b.id)).size !== s.branches.length || s.branches.some((b) => !b.id || !b.label?.trim() || b.label.length > 40))
        add('split_branch', 'แต่ละกิ่งต้องมีชื่อ (ไม่เกิน 40 ตัวอักษร) และไม่ซ้ำกัน');
      return;
    }
    case 'action':
      if (s.action.kind === 'notify') {
        if (!TEMPLATE_KEY.test(s.action.templateKey ?? '')) add('notify_template', 'เลือก template ข้อความ');
        if (!s.action.channels?.length || new Set(s.action.channels).size !== s.action.channels.length
          || !s.action.channels.every((c) => (NOTIFY_CHANNELS as readonly string[]).includes(c))) add('notify_channels', 'เลือกช่องทางส่งอย่างน้อย 1 ช่องทาง');
      } else if (!UUID.test(s.action.couponId ?? '')) add('coupon', 'เลือกคูปอง');
      return;
    case 'webhook': {
      if (!(WEBHOOK_METHODS as readonly string[]).includes(s.method)) add('webhook_method', 'method ไม่ถูกต้อง');
      if (!/^https?:\/\//i.test(s.url ?? '') || s.url.length > LIMITS.maxUrlLength) add('webhook_url', 'URL ต้องขึ้นต้นด้วย http:// หรือ https:// และยาวไม่เกิน 1024');
      if (s.headers.length > LIMITS.maxHeaders || s.headers.some((h) => !TOKEN.test(h.key) || /[\r\n]/.test(h.value) || h.value.length > 2000))
        add('webhook_header', 'header ไม่ถูกต้อง (ไม่เกิน 20 แถว, ชื่อไม่มีช่องว่าง)');
      if (s.headers.some((h) => h.value.includes('{{secret:') && !SECRET_REF.test(h.value))) add('webhook_secret_ref', 'ค่าลับต้องเป็นค่าทั้งช่อง');
      if (s.method === 'GET' && s.body) add('webhook_get_body', 'GET ส่ง body ไม่ได้');
      if (s.body && Buffer.byteLength(s.body, 'utf8') > LIMITS.maxBodyBytes) add('webhook_body', 'body ยาวเกิน 16 KB');
      return;
    }
  }
}

function hasCycle(steps: WorkflowStep[]): boolean {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    const s = byId.get(id);
    if (s) for (const n of nextIdsOf(s)) if (n && visit(n)) return true;
    state.set(id, 2);
    return false;
  };
  return steps.some((s) => visit(s.id));
}
