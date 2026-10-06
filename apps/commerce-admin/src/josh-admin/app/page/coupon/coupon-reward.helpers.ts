import { getCoupons } from '@josh/shared-api';

export type CouponGrantTiming = 'on_order_paid' | 'on_order_delivered';

export type CouponRewardForm = {
  reward_coupon_id: string;
  grant_timing: CouponGrantTiming;
  delay_days: string;
  reward_per_user_limit: string;
};

export type CouponOption = {
  id: string;
  coupon_code: string;
  title: string;
  status?: string;
  is_active?: boolean;
  start_date?: string;
  end_date?: string;
};

/** Shared coupon-picker fetch used by CreateCoupon's chain source select — one place for the
 * fetch + shape mapping. Also carries the fields CouponStatusPill needs so the picker can show
 * each coupon's status. (CouponDetail no longer uses this — it gets its reward-rule labels
 * directly from `rule.source_coupon`/`rule.reward_coupon` in the API response instead.) */
export async function loadCouponOptions(): Promise<CouponOption[]> {
  const options: CouponOption[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    // ponytail: pages through every coupon (200/page) into one dropdown — fine until the
    // catalog reaches thousands; switch to search-as-you-type if that happens.
    const response = await getCoupons(page, 200);
    const rows = response.data?.data?.data ?? [];
    options.push(
      ...(Array.isArray(rows) ? rows : []).map((row: CouponOption) => ({
        id: row.id,
        coupon_code: row.coupon_code,
        title: row.title,
        status: row.status,
        is_active: row.is_active,
        start_date: row.start_date,
        end_date: row.end_date,
      })),
    );
    totalPages = response.data?.data?.meta?.totalPages ?? 1;
    page += 1;
  } while (page <= totalPages);
  return options;
}

export const EMPTY_COUPON_REWARD_FORM: CouponRewardForm = {
  reward_coupon_id: '',
  grant_timing: 'on_order_paid',
  delay_days: '0',
  reward_per_user_limit: '1',
};

export const COUPON_GRANT_TIMING_OPTIONS: Array<{
  value: CouponGrantTiming;
  label: string;
}> = [
  { value: 'on_order_paid', label: 'เมื่อชำระเงินสำเร็จ' },
  { value: 'on_order_delivered', label: 'เมื่อจัดส่งสำเร็จ' },
];

/** Chain B is a normal coupon — its discount lives in "ประเภทและส่วนลด" like any coupon.
 * This form only defines acquisition (source A, timing, delay, per-user cap), so validation
 * covers only those fields. */
const PLAIN_INTEGER = /^\d+$/;

export function validateCouponRewardForm(form: CouponRewardForm): string | null {
  if (!PLAIN_INTEGER.test(form.delay_days.trim())) {
    return 'จำนวนวันหน่วงใช้ได้ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  }
  const limitTrimmed = form.reward_per_user_limit.trim();
  if (!PLAIN_INTEGER.test(limitTrimmed) || Number(limitTrimmed) < 1) {
    return 'จำนวนครั้งที่ได้รับสูงสุดต่อคนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป';
  }
  return null;
}

export function couponRewardFormToPayload(form: CouponRewardForm, rewardCouponId: string) {
  return {
    reward_type: 'coupon' as const,
    reward_coupon_id: rewardCouponId,
    grant_timing: form.grant_timing,
    delay_days: Number(form.delay_days) || 0,
    reward_per_user_limit: Number(form.reward_per_user_limit) || 1,
  };
}

/** Seeds the editable per-rule form on B's detail page (incoming chain rule) from the loaded
 * rule — `reward_coupon_id` is left blank since that endpoint (`updateCouponRewardRule`) can't
 * change A/B anyway, only timing/delay/limit. */
export function rewardFormFromRule(rule: {
  grant_timing: string;
  delay_days?: number | string | null;
  reward_per_user_limit?: number | string | null;
}): CouponRewardForm {
  return {
    reward_coupon_id: '',
    grant_timing:
      rule.grant_timing === 'on_order_delivered' ? 'on_order_delivered' : 'on_order_paid',
    delay_days: String(rule.delay_days ?? 0),
    reward_per_user_limit: String(rule.reward_per_user_limit ?? 1),
  };
}

export function describeGrantTiming(timing: string): string {
  return (
    COUPON_GRANT_TIMING_OPTIONS.find((option) => option.value === timing)
      ?.label ?? timing
  );
}

/** Summary is only timing + delay (+ per-user cap when >1) — the discount itself is
 * described by the reward coupon's own "ประเภทและส่วนลด", not this rule. */
export function formatRewardRuleSummary(
  rule: {
    grant_timing: string;
    delay_days?: number | string | null;
    reward_per_user_limit?: number | string | null;
  },
  couponLabel?: string | null,
): string {
  const delay =
    Number(rule.delay_days ?? 0) > 0
      ? ` · ใช้ได้หลัง ${rule.delay_days} วัน`
      : '';
  const limit = Number(rule.reward_per_user_limit ?? 1);
  const limitSuffix = limit > 1 ? ` · ได้สูงสุด ${limit} ครั้ง/คน` : '';
  const summary = `${describeGrantTiming(rule.grant_timing)}${delay}${limitSuffix}`;
  return couponLabel ? `${couponLabel} · ${summary}` : summary;
}
