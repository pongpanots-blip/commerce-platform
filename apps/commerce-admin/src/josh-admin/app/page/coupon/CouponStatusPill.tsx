import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
/** `coupons.status` (server-derived) → pill label/color. */
const COUPON_STATUS_PILLS: Record<string, { label: string; className: string }> = {
  scheduled: { get label() { return __uiText("รอใช้งาน"); }, className: 'bg-amber-50 text-amber-700' },
  active: { get label() { return __uiText("ใช้งานอยู่"); }, className: 'bg-green-50 text-green-700' },
  expired: { get label() { return __uiText("หมดเวลา"); }, className: 'bg-gray-100 text-gray-500' },
  disabled: { get label() { return __uiText("ปิดโดยแอดมิน"); }, className: 'bg-red-50 text-red-700' },
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
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${pill.className}`}
    >
      {pill.label}
    </span>
  );
}
