import { Chip, toneOf, uiText, useUiLocale, type Tone } from '@cp/ui';

/** Display labels for commerce order, payment, fulfillment and reservation codes. Filters and requests keep the raw code. */
const STATUS: Record<string, string> = {
  draft: 'ร่าง',
  reserving: 'กำลังจองสต็อก',
  pending_payment: 'รอชำระเงิน',
  pending: 'รอดำเนินการ',
  paid: 'ชำระแล้ว',
  confirmed: 'ยืนยันแล้ว',
  held: 'จองไว้',
  reserved: 'จองแล้ว',
  released: 'ปล่อยการจองแล้ว',
  expired: 'หมดอายุ',
  failed: 'ไม่สำเร็จ',
  reconcile: 'รอตรวจสอบ',
  cancelled: 'ยกเลิก',
};
const TONE: Record<string, Tone> = { held: 'info', reserved: 'info', reconcile: 'warn', released: 'muted' };
const MODE: Record<string, string> = { on_hand: 'มีของในสต็อก', to_order: 'สั่งจากซัพพลายเออร์' };
const SOURCE: Record<string, string> = { erp: 'ระบบหลัก (ERP)' };

const label = (map: Record<string, string>, code: string | null | undefined) => (code ? (map[code] ? uiText(map[code]) : code) : '—');

export const orderStatusLabel = (code: string | null | undefined) => label(STATUS, code);
export const fulfillmentModeLabel = (code: string | null | undefined) => label(MODE, code);
export const fulfillmentSourceLabel = (code: string | null | undefined) => label(SOURCE, code);

export function OrderStatusChip({ status }: { status: string | null | undefined }) {
  useUiLocale();
  return <Chip tone={(status && TONE[status]) || toneOf(status)} statusCode={status} dot>{orderStatusLabel(status)}</Chip>;
}
