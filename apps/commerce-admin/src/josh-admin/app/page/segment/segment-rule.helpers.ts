import type { SegmentDefinition, UserSegmentRuleType } from '@josh/shared-api';
import type { ResolvedSegmentUser } from './segment-user-list.helpers';

export type SegmentRuleFormState = {
  roles: string;
  custypes: string;
  min: string;
  within_days: string;
  days: string;
  min_value: string;
  max_value: string;
  withinHours: string;
  cuisine_ids: string[];
  parent_ids: string[];
  registered_from: string;
  registered_to: string;
  manualUsers: ResolvedSegmentUser[];
};

export const EMPTY_RULE_FORM: SegmentRuleFormState = {
  roles: '',
  custypes: '',
  min: '1',
  within_days: '',
  days: '30',
  min_value: '0',
  max_value: '0',
  withinHours: '24',
  cuisine_ids: [],
  parent_ids: [],
  registered_from: '',
  registered_to: '',
  manualUsers: [],
};

export const RULE_TYPE_OPTIONS: Array<{
  value: UserSegmentRuleType;
  label: string;
  description: string;
}> = [
  { value: 'guest', label: 'ผู้เยี่ยมชม (Guest)', description: 'ผู้เยี่ยมชมที่ยังไม่ได้เข้าสู่ระบบ' },
  { value: 'member', label: 'สมาชิก (Member)', description: 'ผู้ใช้ที่เข้าสู่ระบบแล้ว' },
  { value: 'staff', label: 'พนักงาน (Staff)', description: 'พนักงานภายใน (role = staff)' },
  { value: 'role', label: 'บทบาทผู้ใช้ (Role)', description: 'กรองตาม role ของผู้ใช้ เช่น customer, staff' },
  { value: 'custype', label: 'ประเภทลูกค้า (Custype)', description: 'กรองตามประเภทลูกค้า (custype)' },
  { value: 'has_company', label: 'มีข้อมูลบริษัท (Has Company)', description: 'ผู้ใช้ที่มีข้อมูลบริษัท' },
  {
    value: 'min_order_count',
    label: 'จำนวนออเดอร์ขั้นต่ำ',
    description: 'จำนวนออเดอร์ขั้นต่ำ (เลือกช่วงวันย้อนหลังได้)',
  },
  {
    value: 'no_order_days',
    label: 'ไม่สั่งซื้อเกิน X วัน',
    description: 'ไม่มีออเดอร์ใหม่เกินจำนวนวันที่กำหนด',
  },
  {
    value: 'min_order_value',
    label: 'มูลค่าออเดอร์รวมขั้นต่ำ',
    description: 'มูลค่าออเดอร์รวมไม่ต่ำกว่าที่กำหนด',
  },
  {
    value: 'max_order_value',
    label: 'มูลค่าออเดอร์รวมไม่เกิน',
    description: 'มูลค่าออเดอร์รวมน้อยกว่าที่กำหนด',
  },
  {
    value: 'first_visit',
    label: 'เข้าเว็บครั้งแรก (First Visit)',
    description:
      'อุปกรณ์ที่เพิ่งเข้าเว็บครั้งแรกภายใน X ชม. (ใช้กับ Banner Targeting — guest ก็เข้าเงื่อนไขได้)',
  },
  { value: 'cuisine', label: 'ประเภทร้าน (Cuisine)', description: 'กรองตามประเภทร้านที่ขาย' },
  {
    value: 'cuisine_parent',
    label: 'ประเภทร้าน (Cuisine)',
    description: 'กรองตามกลุ่มประเภทร้าน (รูปแบบเดิม)',
  },
  {
    value: 'registered_between',
    label: 'วันที่สมัครอยู่ในช่วง (Registered Between)',
    description: 'วันที่สมัครอยู่ในช่วงที่กำหนด',
  },
  {
    value: 'manual_user_list',
    label: 'รายชื่อลูกค้า (Manual List)',
    description: 'ระบุลูกค้าเองด้วยไฟล์ CSV หรือวางรายชื่อ',
  },
];

/** "เงื่อนไขอื่นๆ" card's <select> options — cuisine/manual_user_list get their own dedicated cards. */
export const OTHER_RULE_TYPE_OPTIONS = RULE_TYPE_OPTIONS.filter(
  (option) =>
    option.value !== 'cuisine' &&
    option.value !== 'cuisine_parent' &&
    option.value !== 'manual_user_list',
);

export function getRuleTypeLabel(ruleType: string): string {
  return RULE_TYPE_OPTIONS.find((option) => option.value === ruleType)?.label ?? ruleType;
}

/** "Live" segments (guest/first_visit/member/staff/role/custype/has_company, no `definition`)
 * are matched live on every read and never frozen — everything else gets its membership
 * computed once and locked.
 * Mirrors `LIVE_RULE_TYPES`/`isLiveSegment` in apps/backend/src/app/user-segment/user-segment.service.ts. */
export function isLiveSegment(
  ruleType: UserSegmentRuleType,
  definition?: SegmentDefinition | null,
): boolean {
  return (
    (ruleType === 'guest' ||
      ruleType === 'first_visit' ||
      ruleType === 'member' ||
      ruleType === 'staff' ||
      ruleType === 'role' ||
      ruleType === 'custype' ||
      ruleType === 'has_company') &&
    !definition
  );
}

export type SegmentRuleCard = 'cuisine' | 'manual_user_list' | 'other';

/** Which of the three create/edit-form option cards a rule type belongs to. A legacy
 * `cuisine_parent` segment opens in the same "ประเภทร้าน" card as `cuisine`. */
export function getSegmentCard(ruleType: UserSegmentRuleType): SegmentRuleCard {
  if (ruleType === 'cuisine' || ruleType === 'cuisine_parent') return 'cuisine';
  if (ruleType === 'manual_user_list') return 'manual_user_list';
  return 'other';
}

export type ManualUsersLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** Save must wait for a manual_user_list segment's stored membership to finish resolving —
 * saving while it's still loading (or failed to load) would overwrite the stored `user_ids`
 * with an empty or partial list. */
export function canSaveManualUserList(status: ManualUsersLoadStatus): boolean {
  return status === 'loaded';
}

/** Warning shown when some stored ids came back in `resolveSegmentUsers`' `not_found` (stale/
 * deleted users) — they'll be silently dropped from `user_ids` on save unless the admin knows. */
export function manualUsersNotFoundWarning(notFoundCount: number): string | null {
  return notFoundCount > 0
    ? `มี ${notFoundCount} รายการที่ไม่พบผู้ใช้แล้ว — จะถูกนำออกเมื่อบันทึก`
    : null;
}

export function randomSlugSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

const THAI_RE = /[฀-๿]/;

/** Auto-slug for the create form: Latin name → kebab-case; Thai or empty → `segment-<suffix>`.
 * `randomSuffix` is generated once per create session (stable across keystrokes) so the slug
 * doesn't keep changing while the admin is still typing a Thai name. */
export function generateSegmentSlug(name: string, randomSuffix: string): string {
  const trimmed = name.trim();
  const fallback = `segment-${randomSuffix}`;
  if (!trimmed || THAI_RE.test(trimmed)) return fallback;

  const kebab = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return (kebab || fallback).slice(0, 80);
}

function splitComma(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ruleConfigToForm(
  ruleType: UserSegmentRuleType,
  config: Record<string, unknown> = {},
): SegmentRuleFormState {
  const form = { ...EMPTY_RULE_FORM };

  switch (ruleType) {
    case 'role':
      form.roles = Array.isArray(config.roles)
        ? config.roles.map(String).join(', ')
        : '';
      break;
    case 'custype':
      form.custypes = Array.isArray(config.custypes)
        ? config.custypes.map(String).join(', ')
        : '';
      break;
    case 'min_order_count':
      form.min = config.min != null ? String(config.min) : '1';
      form.within_days =
        config.within_days != null ? String(config.within_days) : '';
      break;
    case 'no_order_days':
      form.days = config.days != null ? String(config.days) : '30';
      break;
    case 'min_order_value':
      form.min_value = config.min_value != null ? String(config.min_value) : '0';
      form.within_days =
        config.within_days != null ? String(config.within_days) : '';
      break;
    case 'max_order_value':
      form.max_value = config.max_value != null ? String(config.max_value) : '0';
      form.within_days =
        config.within_days != null ? String(config.within_days) : '';
      break;
    case 'first_visit':
      form.withinHours = config.withinHours != null ? String(config.withinHours) : '24';
      break;
    case 'cuisine':
      form.cuisine_ids = Array.isArray(config.cuisine_ids)
        ? config.cuisine_ids.map(String)
        : [];
      form.parent_ids = Array.isArray(config.parent_ids)
        ? config.parent_ids.map(String)
        : [];
      break;
    case 'cuisine_parent':
      // Legacy rule type — loads into the same "ประเภทร้าน" card as `cuisine`.
      form.parent_ids = Array.isArray(config.parent_ids)
        ? config.parent_ids.map(String)
        : [];
      break;
    case 'registered_between':
      form.registered_from = config.from ? String(config.from).slice(0, 10) : '';
      form.registered_to = config.to ? String(config.to).slice(0, 10) : '';
      break;
    case 'manual_user_list':
      // user_ids are resolved to {id, email, name} asynchronously by the caller
      // (needs an API round trip) and patched into manualUsers afterwards.
      break;
    default:
      break;
  }

  return form;
}

export function formToRuleConfig(
  ruleType: UserSegmentRuleType,
  form: SegmentRuleFormState,
): Record<string, unknown> {
  switch (ruleType) {
    case 'role':
      return { roles: splitComma(form.roles) };
    case 'custype':
      return { custypes: splitComma(form.custypes) };
    case 'min_order_count': {
      const config: Record<string, unknown> = {
        min: Number(form.min) || 1,
      };
      if (form.within_days.trim()) {
        config.within_days = Number(form.within_days);
      }
      return config;
    }
    case 'no_order_days':
      return { days: Number(form.days) || 30 };
    case 'min_order_value': {
      const config: Record<string, unknown> = {
        min_value: Number(form.min_value) || 0,
      };
      if (form.within_days.trim()) {
        config.within_days = Number(form.within_days);
      }
      return config;
    }
    case 'max_order_value': {
      const config: Record<string, unknown> = {
        max_value: Number(form.max_value) || 0,
      };
      if (form.within_days.trim()) {
        config.within_days = Number(form.within_days);
      }
      return config;
    }
    case 'first_visit':
      return { withinHours: Number(form.withinHours) || 24 };
    case 'cuisine': {
      const config: Record<string, unknown> = {};
      if (form.cuisine_ids.length > 0) config.cuisine_ids = form.cuisine_ids;
      if (form.parent_ids.length > 0) config.parent_ids = form.parent_ids;
      return config;
    }
    case 'registered_between': {
      const config: Record<string, unknown> = {};
      if (form.registered_from) config.from = form.registered_from;
      if (form.registered_to) config.to = form.registered_to;
      return config;
    }
    case 'manual_user_list':
      return { user_ids: form.manualUsers.map((user) => user.id) };
    default:
      return {};
  }
}

export function validateRuleForm(
  ruleType: UserSegmentRuleType,
  form: SegmentRuleFormState,
): string | null {
  switch (ruleType) {
    case 'role':
      return splitComma(form.roles).length > 0 ? null : 'กรุณาระบุ role อย่างน้อย 1 ค่า';
    case 'custype':
      return splitComma(form.custypes).length > 0
        ? null
        : 'กรุณาระบุ custype อย่างน้อย 1 ค่า';
    case 'cuisine':
      return form.cuisine_ids.length > 0 || form.parent_ids.length > 0
        ? null
        : 'กรุณาเลือกประเภทร้านหรือกลุ่มอย่างน้อย 1 รายการ';
    case 'registered_between':
      return form.registered_from || form.registered_to
        ? null
        : 'กรุณาระบุวันที่เริ่มหรือสิ้นสุด';
    case 'manual_user_list':
      return form.manualUsers.length > 0
        ? null
        : 'กรุณาเพิ่มรายชื่อลูกค้าอย่างน้อย 1 คน';
    default:
      return null;
  }
}

export function summarizeRuleConfig(
  ruleType: UserSegmentRuleType,
  config: Record<string, unknown> = {},
): string {
  switch (ruleType) {
    case 'guest':
    case 'member':
    case 'staff':
    case 'has_company':
      return '—';
    case 'role':
      return `roles: ${(config.roles as string[] | undefined)?.join(', ') ?? '-'}`;
    case 'custype':
      return `custypes: ${(config.custypes as string[] | undefined)?.join(', ') ?? '-'}`;
    case 'min_order_count':
      return `min ${config.min ?? 1}${
        config.within_days ? ` ภายใน ${config.within_days} วัน` : ''
      }`;
    case 'no_order_days':
      return `ไม่สั่งเกิน ${config.days ?? 30} วัน`;
    case 'min_order_value':
      return `มูลค่ารวม ≥ ${config.min_value ?? 0}${
        config.within_days ? ` ภายใน ${config.within_days} วัน` : ''
      }`;
    case 'max_order_value':
      return `มูลค่ารวม < ${config.max_value ?? 0}${
        config.within_days ? ` ภายใน ${config.within_days} วัน` : ''
      }`;
    case 'first_visit':
      return `เพิ่งเข้าครั้งแรกภายใน ${config.withinHours ?? 24} ชม.`;
    case 'cuisine': {
      const cuisineCount = (config.cuisine_ids as string[] | undefined)?.length ?? 0;
      const parentCount = (config.parent_ids as string[] | undefined)?.length ?? 0;
      return `${parentCount} กลุ่ม, ${cuisineCount} ประเภทร้าน`;
    }
    case 'cuisine_parent':
      return `${(config.parent_ids as string[] | undefined)?.length ?? 0} กลุ่มประเภทร้าน`;
    case 'registered_between':
      return `${config.from ?? '…'} → ${config.to ?? '…'}`;
    case 'manual_user_list':
      return `${(config.user_ids as string[] | undefined)?.length ?? 0} คน`;
    default:
      return '—';
  }
}
