import type { EventDefinition, EventDefinitionInput } from '@cp/marketing-workflow';

export const EVENT_NAME = /^[a-z][a-z0-9_]{1,63}$/;
export const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
/** josh `user_devices.individual_id` (varchar 64): web = 32 hex chars, mobile = OneSignal subscription id. */
export const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_ATTRIBUTES = 20;
export const MAX_ATTRIBUTE_BYTES = 2048;
export const MAX_STRING = 500;
export const MAX_FUTURE_MS = 5 * 60_000;
export const MAX_AGE_MS = 7 * 86_400_000;
const TYPES = ['string', 'number', 'boolean', 'date'];
const PII = new Set(['email', 'phone', 'tel', 'mobile', 'name', 'first_name', 'last_name', 'address', 'id_card', 'citizen_id', 'password', 'token']);

export const isPiiKey = (key: string) => PII.has(key.toLowerCase().replace(/-/g, '_'));

/** Why a definition can't be saved (spec §14). `existing` = the stored one: name and attribute types never change. */
export function definitionIssues(d: EventDefinitionInput, existing?: EventDefinition): string[] {
  const out: string[] = [];
  if (!EVENT_NAME.test(d.name ?? '')) out.push('ชื่อ event ใช้ a-z 0-9 _ ขึ้นต้นด้วยตัวอักษร (2–64 ตัว)');
  if (!d.label?.trim() || d.label.length > 120) out.push('ตั้งชื่อที่แสดง (ไม่เกิน 120 ตัวอักษร)');
  if (d.evidence !== 'browser' && d.evidence !== 'server') out.push('evidence ต้องเป็น browser หรือ server');
  if (!Array.isArray(d.attributes) || d.attributes.length > MAX_ATTRIBUTES) out.push(`attribute ได้ไม่เกิน ${MAX_ATTRIBUTES} ตัว`);
  const keys = new Set<string>();
  for (const a of d.attributes ?? []) {
    if (!ATTRIBUTE_KEY.test(a.key ?? '')) out.push(`attribute "${a.key}": ใช้ a-z 0-9 _ (ไม่เกิน 40 ตัว)`);
    else if (isPiiKey(a.key)) out.push(`attribute "${a.key}": ห้ามเก็บข้อมูลส่วนบุคคล`);
    if (!TYPES.includes(a.type)) out.push(`attribute "${a.key}": ชนิดไม่ถูกต้อง`);
    if (keys.has(a.key)) out.push(`attribute "${a.key}" ซ้ำ`);
    keys.add(a.key);
  }
  if (existing) {
    if (existing.name !== d.name) out.push('เปลี่ยนชื่อ event ไม่ได้');
    for (const old of existing.attributes) {
      const next = d.attributes.find((a) => a.key === old.key);
      if (!next) out.push(`ลบ attribute "${old.key}" ไม่ได้ (archive แทน)`);
      else if (next.type !== old.type) out.push(`เปลี่ยนชนิดของ "${old.key}" ไม่ได้`);
    }
  }
  return out;
}

export type Rejection = 'unknown_event' | 'archived_event' | 'bad_attribute_type' | 'too_large' | 'in_future' | 'too_old';
export type Normalized = { ok: true; occurredAt: Date; attributes: Record<string, string | number | boolean> } | { ok: false; reason: Rejection };

/** One incoming event against its definition (spec §3): declared, non-archived attributes only, types checked, dates as ISO UTC. */
export function normalizeEvent(def: EventDefinition | undefined, raw: { occurredAt: string; attributes?: Record<string, unknown> }, now: Date): Normalized {
  if (!def) return { ok: false, reason: 'unknown_event' };
  if (def.status !== 'active') return { ok: false, reason: 'archived_event' };
  const at = new Date(raw.occurredAt);
  if (at.getTime() > now.getTime() + MAX_FUTURE_MS) return { ok: false, reason: 'in_future' };
  if (at.getTime() < now.getTime() - MAX_AGE_MS) return { ok: false, reason: 'too_old' };
  const input = raw.attributes ?? {};
  if (Object.keys(input).length > MAX_ATTRIBUTES || Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_ATTRIBUTE_BYTES) return { ok: false, reason: 'too_large' };
  const attributes: Record<string, string | number | boolean> = {};
  for (const a of def.attributes) {
    if (a.archived || !Object.prototype.hasOwnProperty.call(input, a.key) || input[a.key] === null) continue;
    const v = input[a.key];
    if (a.type === 'string' && typeof v === 'string' && v.length <= MAX_STRING) attributes[a.key] = v;
    else if (a.type === 'number' && typeof v === 'number' && Number.isFinite(v)) attributes[a.key] = v;
    else if (a.type === 'boolean' && typeof v === 'boolean') attributes[a.key] = v;
    else if (a.type === 'date' && typeof v === 'string' && !Number.isNaN(Date.parse(v))) attributes[a.key] = new Date(v).toISOString();
    else return { ok: false, reason: 'bad_attribute_type' };
  }
  return { ok: true, occurredAt: at, attributes };
}
