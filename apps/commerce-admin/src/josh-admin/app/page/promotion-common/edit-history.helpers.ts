import { formatBangkokDateTime, type PromotionValue } from '@josh/shared-api';
import { summarizeMechanicValue } from '../campain/promotion-mechanic-form.helpers';

/** Thai names for the audit `action` values. */
export const ACTION_LABELS: Record<string, string> = {
  create: 'สร้าง',
  update: 'แก้ไข',
  delete: 'ลบ',
  set_coupons: 'ตั้งชุดคูปอง',
  refresh_product_sets: 'ใช้รายการ Product set ล่าสุด',
  upload_image: 'เปลี่ยนรูป',
  set_redemption_rules: 'แก้เงื่อนไขการแลกใช้',
};

/** Thai names for the fields worth naming; anything else is shown by its raw field name. */
const FIELD_LABELS: Record<string, string> = {
  name: 'ชื่อ',
  title: 'ชื่อ',
  title_th: 'ชื่อ (ไทย)',
  title_en: 'ชื่อ (EN)',
  description: 'คำอธิบาย',
  description_th: 'คำอธิบาย (ไทย)',
  description_en: 'คำอธิบาย (EN)',
  is_active: 'เปิดใช้งาน',
  isActive: 'เปิดใช้งาน',
  status: 'สถานะ',
  start_at: 'เริ่ม',
  end_at: 'สิ้นสุด',
  start_date: 'เริ่ม',
  end_date: 'สิ้นสุด',
  campaign_id: 'Campaign',
  coupon_ids: 'คูปองใน Campaign',
  coupon_code: 'รหัสคูปอง',
  coupon_type: 'ประเภทคูปอง',
  discount_type: 'ประเภทส่วนลด',
  discount_value: 'มูลค่าส่วนลด',
  discount_scope: 'ขอบเขตส่วนลด',
  minimum_order_amount: 'ยอดสั่งซื้อขั้นต่ำ',
  maximum_discount_amount: 'ส่วนลดสูงสุด',
  global_limit: 'จำนวนจำกัดทั้งระบบ',
  user_limit: 'จำกัดต่อผู้ใช้',
  usage_type: 'รูปแบบการใช้',
  distribution_type: 'กลุ่มเป้าหมาย',
  auto_apply: 'ใช้อัตโนมัติ',
  auto_grant_on_signup: 'แจกตอนสมัคร',
  audience_segment_id: 'Segment',
  image_url: 'รูปภาพ',
  rules: 'เงื่อนไขการแลกใช้',
  value: 'ส่วนลด',
  badge_text: 'ข้อความป้าย',
  badge_text_en: 'ข้อความป้าย (English)',
  promotion_mechanic_id: 'โปร (legacy)',
  max_units: 'จำกัดจำนวน',
  audience: 'กลุ่มลูกค้า',
  audience_company_ids: 'บริษัทที่เห็นโปร',
  applicable_products_th: 'สินค้าที่ร่วมรายการ (ไทย)',
  applicable_products_en: 'สินค้าที่ร่วมรายการ (EN)',
  code_generation: 'วิธีสร้างรหัส',
  enforce_audience_at_redemption: 'ตรวจกลุ่มเป้าหมายตอนแลกใช้',
  product_set_ids: 'Product set',
  product_set_snapshots: 'รายการสินค้าใน Product set (จำนวน SKU)',
  refreshed_product_set_ids: 'Product set ที่ใช้รายการล่าสุด',
  slug: 'slug',
  image_url_desktop: 'รูป desktop (ไทย)',
  image_url_mobile: 'รูป mobile (ไทย)',
  image_url_desktop_en: 'รูป desktop (EN)',
  image_url_mobile_en: 'รูป mobile (EN)',
  mobile_deeplink: 'Deeplink',
  show_on_home: 'แสดงบนหน้าแรก',
  home_banner_sort_order: 'ลำดับแบนเนอร์หน้าแรก',
  category_ids: 'หมวดหมู่',
  brand_ids: 'แบรนด์',
  item_count: 'จำนวนสินค้า',
};

/**
 * Internal columns with nothing an admin can read or set — hidden here (not in the backend
 * diff) so rows stored before this list existed are cleaned up too.
 */
const HIDDEN_FIELDS = new Set([
  'apply_to',
  'promo_type',
  'predicate',
  'sold_units',
  'global_used_count',
  'home_banner_id',
]);

export const isHiddenField = (field: string): boolean => HIDDEN_FIELDS.has(field);

export const actionLabel = (action: string): string => ACTION_LABELS[action] ?? action;
export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? field;

const MAX_SHOWN_CHARS = 120;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const clip = (text: string): string =>
  text.length > MAX_SHOWN_CHARS ? `${text.slice(0, MAX_SHOWN_CHARS)}…` : text;

/** Every UUID in `text` → its name from `names`; unknown ones shrink to the first 8 characters. */
const nameIds = (text: string, names?: Record<string, string>): string =>
  text.replace(UUID, (id) => names?.[id] ?? id.slice(0, 8));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Wording shared with the mechanic list (`PromotionMechanic.tsx`). */
const AUDIENCE_LABELS: Record<string, string> = { all: 'ทุกคน', companies: 'เฉพาะบริษัท' };

/** Fields whose raw value is meaningless to read; null when the value has no special reading. */
function formatKnownField(field: string, value: unknown): string | null {
  switch (field) {
    case 'max_units':
      return value == null ? 'ไม่จำกัด' : null;
    case 'audience':
      return typeof value === 'string' ? (AUDIENCE_LABELS[value] ?? null) : null;
    case 'audience_company_ids':
      return Array.isArray(value) ? `${value.length} บริษัท` : null;
    case 'value': {
      // a mechanic's PromotionValue → "ลด 15%"; anything unrecognised falls through to JSON
      const text = isRecord(value) ? summarizeMechanicValue(value as PromotionValue) : '-';
      return text === '-' ? null : text;
    }
    case 'product_set_snapshots':
      // `{ set name (older rows: set id): SKU count }`
      return isRecord(value)
        ? Object.entries(value)
            .map(([set, count]) => `${set}: ${String(count)}`)
            .join(', ')
        : null;
    default:
      return null;
  }
}

/**
 * One side of a change as text: dates in Bangkok time, booleans as ใช่/ไม่ใช่, known fields in
 * words, ids swapped for `names` (unknown → short id), long values clipped.
 */
export function formatChangeValue(
  value: unknown,
  field?: string,
  names?: Record<string, string>,
): string {
  const known = field ? formatKnownField(field, value) : null;
  if (known !== null) return clip(nameIds(known, names));
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
  if (typeof value === 'string') {
    return ISO_DATE.test(value) ? formatBangkokDateTime(value, 'th') : clip(nameIds(value, names));
  }
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.length === 0) return '—';
  // a list of plain strings (ids) reads as names, anything else as compact JSON
  const text =
    Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? value.join(', ')
      : JSON.stringify(value);
  return clip(nameIds(text, names));
}

/** Ids added to / removed from a list (only meaningful when both sides are string arrays). */
function idDiff(before: unknown, after: unknown): { added: number; removed: number } | null {
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  return {
    added: after.filter((id) => !before.includes(id)).length,
    removed: before.filter((id) => !after.includes(id)).length,
  };
}

/**
 * Both sides of a change as text. Same as `formatChangeValue` per side, except a company list
 * also says how many were added / removed — "1 บริษัท → 1 บริษัท" alone hides a swap.
 */
export function formatChange(
  change: { field: string; before: unknown; after: unknown },
  names?: Record<string, string>,
): { before: string; after: string } {
  const before = formatChangeValue(change.before, change.field, names);
  const after = formatChangeValue(change.after, change.field, names);
  const diff = change.field === 'audience_company_ids' ? idDiff(change.before, change.after) : null;
  return {
    before,
    after: diff && (diff.added || diff.removed) ? `${after} (+${diff.added} / −${diff.removed})` : after,
  };
}
