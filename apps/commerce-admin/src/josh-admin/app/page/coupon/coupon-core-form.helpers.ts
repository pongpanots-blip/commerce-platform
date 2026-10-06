import {
  fromBangkokInputValue,
  toBangkokInputValue,
  type CouponDiscountScope,
} from '@josh/shared-api';
import { isRichTextEmpty } from '../../components/rich-text/RichTextEditor';
import { isNewSignupAudience, type CouponAudienceMode } from './coupon-audience.helpers';

export type { CouponDiscountScope };

export type CouponDistributionType = 'public' | 'assigned';

export type CouponCoreForm = {
  coupon_code: string;
  title: string;
  title_en: string;
  description: string;
  description_en: string;
  applicable_products_th: string;
  applicable_products_en: string;
  coupon_type: 'discount' | 'cashback';
  code_generation: 'shared' | 'unique_suffix';
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discount_value: string;
  maximum_discount_amount: string;
  /** Which slice of the cart the discount applies to — 'all' or Promotion Product Set
   * restricted by product/brand/category. Drives eligible_scope in the redemption rules
   * (see coupon-redemption.helpers) and the ineligible-cart message customers see. */
  discount_scope: CouponDiscountScope;
  user_limit: string;
  global_limit: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  /** ใช้อัตโนมัติ (ไม่ต้องกรอกโค้ด) — backend รับเฉพาะคูปอง public; ส่งเป็น false เสมอเมื่อกลุ่มเป้าหมายไม่ใช่ทุกคน */
  auto_apply: boolean;
};

export const LIMIT_VALIDATION_MESSAGE =
  'ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป — ใส่ 0 หรือค่าติดลบไม่ได้';

export const COUPON_CODE_MAX_LENGTH = 8;
export const COUPON_CODE_MAX_LENGTH_MESSAGE = `รหัสคูปองต้องไม่เกิน ${COUPON_CODE_MAX_LENGTH} ตัวอักษร`;

/** Auto-fill: starts now, ends in 30 days at 23:59 — both in Thai time. */
export function defaultCouponDateRange() {
  const start = toBangkokInputValue(new Date());
  const endDay = toBangkokInputValue(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).slice(0, 10);
  return { start_date: start, end_date: `${endDay}T23:59` };
}

export function emptyCouponCoreForm(): CouponCoreForm {
  const defaultDates = defaultCouponDateRange();
  return {
    coupon_code: '',
    title: '',
    title_en: '',
    description: '',
    description_en: '',
    applicable_products_th: '',
    applicable_products_en: '',
    coupon_type: 'discount',
    code_generation: 'shared',
    discount_type: 'PERCENTAGE',
    discount_value: '10',
    maximum_discount_amount: '',
    discount_scope: 'all',
    user_limit: '1',
    global_limit: '',
    start_date: defaultDates.start_date,
    end_date: defaultDates.end_date,
    is_active: true,
    auto_apply: false,
  };
}

const DISCOUNT_SCOPES: CouponDiscountScope[] = ['all', 'product', 'brand', 'category'];

/**
 * Coupons created before `discount_scope` existed have it missing/'all' on the API but may
 * already carry an include-mode eligible_scope (product sets / legacy category / legacy SKU
 * picks) from the redemption rules — show those as 'product' so the picker they already
 * filled in stays visible instead of silently reverting to "all products".
 */
function inferDiscountScope(
  coupon: any,
  redemptionRules?: Record<string, unknown> | null,
): CouponDiscountScope {
  const apiScope = coupon?.discount_scope;
  if (DISCOUNT_SCOPES.includes(apiScope) && apiScope !== 'all') return apiScope;

  const scope = (redemptionRules?.eligible_scope ?? {}) as Record<string, unknown>;
  const hasLegacyInclude =
    scope.mode === 'include' &&
    [scope.product_set_ids, scope.category_ids, scope.product_inventory_ids].some(
      (ids) => Array.isArray(ids) && ids.length > 0,
    );
  return hasLegacyInclude ? 'product' : 'all';
}

/** Pre-fills the shared form from a loaded coupon record (edit / CouponDetail).
 * `redemptionRules` (optional) is the raw GET .../redemption-rules payload — only used to
 * infer discount_scope for legacy coupons that predate the field (see inferDiscountScope). */
export function formFromCoupon(
  coupon: any,
  redemptionRules?: Record<string, unknown> | null,
): CouponCoreForm {
  // Legacy SINGLE_USE coupons show/save as user_limit 1 — behaviourally equivalent
  // (effectiveUserLimit), and the admin form no longer has a usage-type choice.
  const isLegacySingleUse = coupon?.usage_type === 'SINGLE_USE';
  return {
    coupon_code: coupon?.coupon_code ?? '',
    title: coupon?.title_th ?? coupon?.title ?? '',
    title_en: coupon?.title_en ?? '',
    description: coupon?.description_th ?? coupon?.description ?? '',
    description_en: coupon?.description_en ?? '',
    applicable_products_th: coupon?.applicable_products_th ?? '',
    applicable_products_en: coupon?.applicable_products_en ?? '',
    coupon_type: coupon?.coupon_type === 'cashback' ? 'cashback' : 'discount',
    code_generation: coupon?.code_generation === 'unique_suffix' ? 'unique_suffix' : 'shared',
    discount_type: coupon?.discount_type === 'FIXED_AMOUNT' ? 'FIXED_AMOUNT' : 'PERCENTAGE',
    discount_value: coupon?.discount_value != null ? String(coupon.discount_value) : '10',
    maximum_discount_amount:
      coupon?.maximum_discount_amount != null ? String(coupon.maximum_discount_amount) : '',
    discount_scope: inferDiscountScope(coupon, redemptionRules),
    user_limit: isLegacySingleUse
      ? '1'
      : coupon?.user_limit != null
        ? String(coupon.user_limit)
        : '',
    global_limit: coupon?.global_limit != null ? String(coupon.global_limit) : '',
    start_date: toBangkokInputValue(coupon?.start_date),
    end_date: toBangkokInputValue(coupon?.end_date),
    is_active: coupon?.is_active ?? true,
    auto_apply: coupon?.auto_apply === true,
  };
}

/** '0' / '-1' / '1.5' / '' / 'abc' -> null, '1' / '25' -> the number. */
export function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return num >= 1 ? num : null;
}

/** Flags derived purely from the audience mode — the single source of truth for who can use the coupon. */
export function resolveCouponFormFlags(audienceMode: CouponAudienceMode) {
  const isNewSignupCoupon = isNewSignupAudience(audienceMode);
  const effectiveDistributionType: CouponDistributionType = audienceMode === 'all' ? 'public' : 'assigned';
  return { isNewSignupCoupon, effectiveDistributionType };
}

/**
 * true when the form's discount fields (type/value/max cap) are exactly what `originalCoupon`
 * (the record CouponDetail loaded) already has — i.e. the PATCH this form produces wouldn't
 * change any of them. Mirrors the backend's own "did this PATCH touch a discount field"
 * comparison in `coupon.service.ts update()` (see docs/coupon-api.md § PATCH /coupon/:id),
 * so an old PERCENTAGE coupon with no maximum_discount_amount can still be edited/disabled
 * without the client blocking the save before the request is even sent.
 */
function discountFieldsUnchangedFromOriginal(
  form: CouponCoreForm,
  originalCoupon: { discount_type?: string; discount_value?: number; maximum_discount_amount?: number | null } | null | undefined,
): boolean {
  if (!originalCoupon) return false;
  const formDiscountValue = Number(form.discount_value);
  if (!Number.isFinite(formDiscountValue)) return false;
  const formMaxDiscount =
    form.discount_type === 'PERCENTAGE' && form.maximum_discount_amount.trim()
      ? Number(form.maximum_discount_amount)
      : null;
  const originalMaxDiscount =
    originalCoupon.maximum_discount_amount == null
      ? null
      : Number(originalCoupon.maximum_discount_amount);
  return (
    form.discount_type === originalCoupon.discount_type &&
    formDiscountValue === Number(originalCoupon.discount_value) &&
    formMaxDiscount === originalMaxDiscount
  );
}

export function validateCouponCoreForm(
  form: CouponCoreForm,
  /** The coupon record as loaded (CouponDetail's `coupon` state) — omit on create, where
   * there is nothing to compare against and the cap is always required for a new % coupon. */
  originalCoupon?: {
    coupon_code?: string;
    discount_type?: string;
    discount_value?: number;
    maximum_discount_amount?: number | null;
  } | null,
): { formError?: string; fieldErrors: Partial<Record<keyof CouponCoreForm, string>> } {
  const fieldErrors: Partial<Record<keyof CouponCoreForm, string>> = {};

  // Both limits are always required now.
  if (parsePositiveInteger(form.user_limit) == null) {
    fieldErrors.user_limit = LIMIT_VALIDATION_MESSAGE;
  }
  if (parsePositiveInteger(form.global_limit) == null) {
    fieldErrors.global_limit = LIMIT_VALIDATION_MESSAGE;
  }

  if (!form.coupon_code.trim() || !form.title.trim() || !form.title_en.trim()) {
    return { formError: 'กรุณากรอกรหัสคูปองและชื่อคูปอง (ไทยและอังกฤษ)', fieldErrors };
  }
  // Existing coupons may already have a code longer than 8 chars (created before this cap
  // existed) — CouponDetail re-runs this validator on every save with the unchanged code still
  // in the form, so only reject when the (trimmed+uppercased) code actually differs from what's
  // stored, mirroring coupon.service.ts update()'s own codeChanged comparison.
  const nextCouponCode = form.coupon_code.trim().toUpperCase();
  const codeChanged =
    !originalCoupon?.coupon_code || nextCouponCode !== originalCoupon.coupon_code.trim().toUpperCase();
  if (codeChanged && nextCouponCode.length > COUPON_CODE_MAX_LENGTH) {
    fieldErrors.coupon_code = COUPON_CODE_MAX_LENGTH_MESSAGE;
    return { formError: COUPON_CODE_MAX_LENGTH_MESSAGE, fieldErrors };
  }
  if (!form.start_date || !form.end_date) {
    return { formError: 'กรุณาระบุวันเริ่มต้นและวันสิ้นสุด', fieldErrors };
  }
  if (form.start_date > form.end_date) {
    return { formError: 'วันเริ่มต้นต้องไม่เกินวันสิ้นสุด', fieldErrors };
  }
  const discountValue = Number(form.discount_value);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return { formError: 'กรุณาระบุมูลค่าส่วนลดให้ถูกต้อง', fieldErrors };
  }
  if (form.discount_type === 'PERCENTAGE' && discountValue > 100) {
    return { formError: 'ส่วนลดแบบเปอร์เซ็นต์ต้องไม่เกิน 100%', fieldErrors };
  }
  if (form.discount_type === 'PERCENTAGE' && !discountFieldsUnchangedFromOriginal(form, originalCoupon)) {
    const maxDiscount = Number(form.maximum_discount_amount);
    if (!form.maximum_discount_amount.trim() || !Number.isFinite(maxDiscount) || maxDiscount <= 0) {
      fieldErrors.maximum_discount_amount = 'ส่วนลดแบบเปอร์เซ็นต์ต้องระบุส่วนลดสูงสุด (บาท)';
      return { formError: 'ส่วนลดแบบเปอร์เซ็นต์ต้องระบุส่วนลดสูงสุด (บาท)', fieldErrors };
    }
  }
  if (isRichTextEmpty(form.applicable_products_th) || isRichTextEmpty(form.applicable_products_en)) {
    return { formError: 'กรุณากรอกสินค้าที่ร่วมรายการ (ไทยและอังกฤษ)', fieldErrors };
  }
  if (isRichTextEmpty(form.description) || isRichTextEmpty(form.description_en)) {
    return { formError: 'กรุณากรอกรายละเอียด (ไทยและอังกฤษ)', fieldErrors };
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { formError: LIMIT_VALIDATION_MESSAGE, fieldErrors };
  }
  return { fieldErrors };
}

function userLimitForPayload(form: CouponCoreForm): number | null {
  return parsePositiveInteger(form.user_limit);
}

function globalLimitForPayload(form: CouponCoreForm): number | null {
  return parsePositiveInteger(form.global_limit);
}

/** Coupon-only fields for createCoupon/updateCoupon — caller adds minimum_order_amount from redemption rules. */
export function couponCoreFormToPayload(
  form: CouponCoreForm,
  flags: { effectiveDistributionType: CouponDistributionType; isNewSignupCoupon: boolean },
) {
  const discountValue = Number(form.discount_value);
  return {
    coupon_code: form.coupon_code.trim(),
    title: form.title.trim(),
    title_th: form.title.trim(),
    title_en: form.title_en.trim() || null,
    description: form.description.trim() || undefined,
    description_th: form.description.trim() || undefined,
    description_en: form.description_en.trim() || null,
    applicable_products_th: form.applicable_products_th,
    applicable_products_en: form.applicable_products_en,
    distribution_type: flags.effectiveDistributionType,
    coupon_type: form.coupon_type,
    code_generation: flags.effectiveDistributionType === 'public' ? 'shared' : form.code_generation,
    discount_type: form.discount_type,
    discount_value: discountValue,
    maximum_discount_amount:
      form.discount_type === 'PERCENTAGE' && form.maximum_discount_amount.trim()
        ? Number(form.maximum_discount_amount)
        : null,
    discount_scope: form.discount_scope,
    // global_limit is required now (both limits enforced independently by the backend).
    usage_type: 'GLOBAL_LIMIT',
    user_limit: userLimitForPayload(form),
    global_limit: globalLimitForPayload(form),
    start_date: fromBangkokInputValue(form.start_date),
    end_date: fromBangkokInputValue(form.end_date),
    is_active: form.is_active,
    auto_grant_on_signup: flags.isNewSignupCoupon,
    // Draft restored from before this field existed has it undefined → false.
    auto_apply: !!form.auto_apply && flags.effectiveDistributionType === 'public',
  };
}
