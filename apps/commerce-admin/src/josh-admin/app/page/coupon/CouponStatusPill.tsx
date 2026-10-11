import { Chip, type Tone, uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
/** `coupons.status` (server-derived) → chip label/tone. */
const COUPON_STATUS_PILLS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { get label() { return __uiText("รอใช้งาน"); }, tone: 'warn' },
  active: { get label() { return __uiText("ใช้งานอยู่"); }, tone: 'ok' },
  expired: { get label() { return __uiText("หมดเวลา"); }, tone: 'muted' },
  disabled: { get label() { return __uiText("ปิดโดยแอดมิน"); }, tone: 'danger' },
};

/**
 * Fallback only — rows served from the 24h per-entity Redis cache written before the
 * `status` column existed have no `status` field at all (see docs/coupon-api.md).
 * Same precedence as the backend's `resolveCouponStatus()`: disabled wins, then
 * scheduled/expired by date, else active. Once that cache entry is invalidated
 * (any edit) the row carries a real `status` and this never runs for it again.
 */
function fallbackCouponStatus(coupon: {
  is_active?: boolean;
  start_date?: string;
  end_date?: string;
}) {
  if (!coupon.is_active) return 'disabled';
  const now = Date.now();
  if (coupon.start_date && now < new Date(coupon.start_date).getTime()) return 'scheduled';
  if (coupon.end_date && now > new Date(coupon.end_date).getTime()) return 'expired';
  return 'active';
}

export type CouponStatusPillCoupon = {
  status?: string;
  is_active?: boolean;
  start_date?: string;
  end_date?: string;
};

export default function CouponStatusPill({ coupon }: { coupon: CouponStatusPillCoupon }) {
  __useUiLocale();
  const status = coupon.status ?? fallbackCouponStatus(coupon);
  const pill = COUPON_STATUS_PILLS[status] ?? COUPON_STATUS_PILLS.active;
  return <Chip tone={pill.tone} statusCode={status} dot>{pill.label}</Chip>;
}
