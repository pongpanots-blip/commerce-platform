import { apiClient } from '../api-client/api-client';
import type { CartSummary } from '../cart/cart.api';

export type CouponIneligibleCode =
  | 'min_spend_not_met'
  | 'items_not_eligible'
  | 'brands_not_eligible'
  | 'categories_not_eligible'
  | 'payment_method_not_allowed'
  | 'not_applicable';

/** Which slice of the cart the coupon's discount is restricted to — drives which
 * ineligible code (items/brands/categories_not_eligible) the server returns when
 * nothing in the cart matches the coupon's Promotion Product Set. */
export type CouponDiscountScope = 'all' | 'product' | 'brand' | 'category';

export type CouponIneligibleReason = {
  code: CouponIneligibleCode;
  params?: { amount?: number; methods?: string[] };
  /**
   * `true` when this coupon has no way back to `valid: true` from anything the
   * shopper can do (expired, deactivated, deleted, usage exhausted, audience
   * mismatch). `false` for a recoverable reason (min spend, product scope, payment
   * method, "not started yet") — a kept/stored coupon with `deadEnd: false` may come
   * back valid on its own once the cart or timing changes; don't clear/forget it.
   * Server-computed — see `CouponRedemptionService.DEAD_END_ERROR` in the backend,
   * the single source of this classification. Prefer this over deriving dead-end-ness
   * from `code` on the client (`not_applicable` alone covers both dead-end and
   * non-dead-end cases).
   */
  deadEnd: boolean;
};

export type CouponEntitlement = {
  id: string;
  coupon_id: string;
  user_id: string;
  personal_code: string | null;
  status: string;
  source: string;
  granted_at: string | null;
  notified_at: string | null;
  usable_from: string | null;
  expires_at: string | null;
};

export type CouponApplyResult = {
  valid: boolean;
  errors: string[];
  couponId?: string;
  couponCode?: string;
  couponTitle?: string;
  /** Why this coupon can't be applied to the current cart; `null` when valid. */
  ineligibleReason: CouponIneligibleReason | null;
  /** ส่วนลดฐานก่อน VAT — ค่าที่ลดฐานภาษีและขึ้นใบกำกับภาษี */
  discountExVat: number;
  couponDiscountExVat: number;
  /** ส่วนลดที่ลูกค้าเห็น (inc VAT) — ใช้ตัวนี้แสดงแถวส่วนลด/หักออกจาก total */
  discountIncVat: number;
  couponDiscount: number;
  /** @deprecated ใช้ discountIncVat — remove after 2026-12-31 */
  discountAmount: number;
  eligibleSubtotal: number;
  cartSubtotal: number;
  /** ยอดจ่ายหลังหักคูปอง — ชื่อเดียวกับ cart/checkout */
  totalIncVat?: number;
  /** @deprecated ใช้ totalIncVat */
  totalAfterDiscount?: number;
  /** true when coupon was persisted on the cart Redis session */
  savedToCart?: boolean;
  /**
   * Always `false` now: the code sent (an `auto_apply` coupon's too) is the customer's own choice
   * and is saved (`savedToCart: true`). Kept for older clients.
   */
  isAutomatic?: boolean;
  /** Cart money after coupon (same shape as GET /cart/summary) */
  pricing?: CartSummary;
};

export type UserCouponWalletItem = {
  entitlement: {
    id: string;
    status: string;
    source: string;
    personal_code: string | null;
    code_to_use: string;
    granted_at: string | null;
    usable_from: string | null;
    expires_at: string | null;
    notified_at: string | null;
  };
  coupon: {
    id: string;
    coupon_code: string;
    /** ชื่อคูปองตาม `lang` ที่ขอมา — server เลือกภาษาให้แล้ว */
    name: string;
    /** รายละเอียด (HTML จาก text editor ในแอดมิน) ตาม `lang` */
    detail: string | null;
    /** สินค้าที่ร่วมรายการ ตาม `lang` — ถ้าแอดมินไม่ได้เขียน server ใส่ป้ายจาก redemption rules ให้ */
    applicable_product: string;
    image_url: string | null;
    coupon_type: string;
    distribution_type: string;
    code_generation: string;
    discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
    discount_value: number;
    minimum_order_amount: number;
    maximum_discount_amount: number | null;
    discount_scope: CouponDiscountScope;
    usage_type: string;
    user_limit: number | null;
    global_limit: number | null;
    global_used_count: number;
    start_date: string;
    end_date: string;
    is_active: boolean;
    auto_grant_on_signup: boolean;
    /** `true` = ระบบใช้ให้เองตอนชำระเงิน (ไม่ต้องกรอก/เลือก) — optional: server เก่าไม่ส่ง */
    auto_apply?: boolean;
  };
  redemption_rules: Record<string, unknown>;
  usage: {
    used_count: number;
    user_limit: number | null;
    remaining_uses: number | null;
  };
  is_usable_now: boolean;
  unusable_reasons: string[];
  /** Only when `getMyCoupons` was called with `cartId` — same rules as `applyCoupon`. */
  cart_eligible?: boolean;
  cart_ineligible_reasons?: string[];
  /** Structured reason for `cart_eligible === false` — prefer this over `cart_ineligible_reasons[0]`. */
  cart_ineligible_reason?: CouponIneligibleReason | null;
  cart_discount_inc_vat?: number;
  /** With `cartId`: `true` = checkout auto-applies THIS coupon to the cart right now (auto coupons only). */
  cart_auto_selected?: boolean;
};

export type UserCouponWalletResponse = {
  user_id: string;
  total: number;
  items: UserCouponWalletItem[];
};

export type CouponLang = 'th' | 'en';

export const getMyCoupons = async (
  status: 'all' | 'usable' | 'active' | 'pending' | 'used' | 'expired' | 'inactive' = 'all',
  lang: CouponLang = 'th',
  /** Pass the cart to get `cart_eligible` per item (checkout coupon picker). */
  cart?: { cartId: string; paymentMethod?: string | null; branchId?: string | null },
): Promise<{ data: { data: UserCouponWalletResponse } }> => {
  const params = new URLSearchParams({ status, lang });
  if (cart?.cartId) {
    params.set('cartId', cart.cartId);
    if (cart.paymentMethod) params.set('paymentMethod', cart.paymentMethod);
    if (cart.branchId) params.set('branchId', cart.branchId);
  }
  const response = await apiClient.get(`/coupon/my?${params.toString()}`);
  return response;
};

export const getUserCoupons = async (
  userId: string,
  status: 'all' | 'usable' | 'active' | 'pending' | 'used' | 'expired' | 'inactive' = 'all',
  lang: CouponLang = 'th',
): Promise<{ data: { data: UserCouponWalletResponse } }> => {
  const response = await apiClient.get(
    `/coupon/user/${encodeURIComponent(userId)}?status=${encodeURIComponent(status)}&lang=${lang}`,
  );
  return response;
};

export const getCoupons = async (
  page = 1,
  limit = 10,
  search = '',
): Promise<any> => {
  const response = await apiClient.get(
    `/coupon?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
  );
  return response;
};

export const getCouponById = async (id: string): Promise<any> => {
  const response = await apiClient.get(`/coupon/${id}`);
  return response;
};

export const createCoupon = async (data: any): Promise<any> => {
  const response = await apiClient.post('/coupon', data);
  return response;
};

export const updateCoupon = async (id: string, data: any): Promise<any> => {
  const response = await apiClient.patch(`/coupon/${id}`, data);
  return response;
};

export const uploadCouponImage = async (
  couponId: string,
  file: File,
): Promise<any> => {
  const formData = new FormData();
  formData.append('image', file);
  const response = await apiClient.patch(`/coupon/${couponId}/image`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response;
};

export const deleteCoupon = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/coupon/${id}`);
  return response;
};

export const applyCoupon = async (payload: {
  coupon_code: string;
  cartId: string;
  userId: string;
  branchId?: string;
  paymentMethod?: string;
  /** th | en — ภาษาของ `couponTitle` ที่ตอบกลับ */
  lang?: CouponLang;
}): Promise<{
  data: { data: CouponApplyResult & { totalAfterDiscount: number; totalIncVat: number } };
}> => {
  const response = await apiClient.post('/coupon/apply', payload);
  return response;
};

/**
 * ลูกค้า "ไม่เอาคูปอง" — ลบคูปองบนตะกร้า (ที่เลือกเอง รวมคูปอง auto, หรือที่ระบบเลือกให้ `isAutomatic`) แล้วระบบจะไม่เลือกโปรอัตโนมัติให้อีก จนกว่าจะ POST /coupon/apply คูปองใหม่ หรือล้างตะกร้า
 * `optOutAuto: false` = client ปลดคูปองที่ใช้ไม่ได้เอง (ไม่ใช่ลูกค้ากด) → แค่ลบ โปรอัตโนมัติกลับมา และ `pricing` โชว์ใบนั้น (default `true`)
 * `lang` = ภาษาของ `couponTitle` ของโปรอัตโนมัติใน `pricing` เมื่อ `optOutAuto: false` (ไม่ส่งใช้ Accept-Language)
 */
export const removeCartCoupon = async (payload: {
  cartId: string;
  lang?: CouponLang;
  optOutAuto?: boolean;
}): Promise<{
  data: {
    data: {
      cleared: boolean;
      hadCoupon: boolean;
      couponCode: string | null;
      totalIncVat: number;
      pricing: unknown;
    };
  };
}> => {
  const response = await apiClient.delete('/coupon/apply', { data: payload });
  return response;
};

export const getCouponEntitlements = async (couponId: string): Promise<any> => {
  const response = await apiClient.get(`/coupon/${couponId}/entitlements`);
  return response;
};

export const addCouponEntitlements = async (
  couponId: string,
  payload: { user_ids: string[]; activate?: boolean },
): Promise<any> => {
  const response = await apiClient.post(`/coupon/${couponId}/entitlements`, payload);
  return response;
};

export const importCouponEntitlements = async (
  couponId: string,
  payload: {
    user_ids?: string[];
    emails?: string[];
    custcodes?: string[];
    activate?: boolean;
  },
): Promise<any> => {
  const response = await apiClient.post(
    `/coupon/${couponId}/entitlements/import`,
    payload,
  );
  return response;
};

export const generateCouponEntitlementsFromSegment = async (
  couponId: string,
  payload: { activate?: boolean } = {},
): Promise<any> => {
  const response = await apiClient.post(
    `/coupon/${couponId}/entitlements/from-segment`,
    payload,
  );
  return response;
};

export const updateCouponEntitlementStatus = async (
  couponId: string,
  entitlementId: string,
  status: string,
): Promise<any> => {
  const response = await apiClient.patch(
    `/coupon/${couponId}/entitlements/${entitlementId}/status`,
    { status },
  );
  return response;
};

export const notifyCouponEntitlements = async (
  couponId: string,
  payload: {
    entitlement_ids?: string[];
    include_already_notified?: boolean;
    channel?: 'in_app' | 'push';
    message?: string;
  } = {},
): Promise<any> => {
  const response = await apiClient.post(`/coupon/${couponId}/notify`, payload);
  return response;
};

export const getCouponReport = async (couponId: string): Promise<any> => {
  const response = await apiClient.get(`/coupon/${couponId}/report`);
  return response;
};

export const getCouponRedemptionRules = async (couponId: string): Promise<any> => {
  const response = await apiClient.get(`/coupon/${couponId}/redemption-rules`);
  return response;
};

/** Snapshot of a Promotion Product Set's SKUs taken at the time the coupon last saved a
 * reference to it — later edits/deactivation/deletion of the set don't affect the coupon
 * unless the admin explicitly refreshes it (see `upsertCouponRedemptionRules`). */
export type CouponProductSetSnapshot = {
  name: string;
  set_updated_at: string | null;
  snapshotted_at: string;
  items: Array<{ product_inventory_id: string; sku: string }>;
};

export const upsertCouponRedemptionRules = async (
  couponId: string,
  rules: Record<string, unknown>,
  /** ids to re-snapshot from the live Promotion Product Set — server ignores any
   * product_set_snapshots sent by the client and owns snapshotting itself. */
  refreshProductSetIds?: string[],
): Promise<any> => {
  const response = await apiClient.put(`/coupon/${couponId}/redemption-rules`, {
    rules,
    ...(refreshProductSetIds && refreshProductSetIds.length > 0
      ? { refresh_product_set_ids: refreshProductSetIds }
      : {}),
  });
  return response;
};

export const getCouponRewardRules = async (
  couponId: string,
  options?: { as?: 'reward' },
): Promise<any> => {
  const response = await apiClient.get(`/coupon/${couponId}/reward-rules`, {
    params: options?.as ? { as: options.as } : undefined,
  });
  return response;
};

export const createCouponRewardRule = async (
  couponId: string,
  payload: Record<string, unknown>,
): Promise<any> => {
  const response = await apiClient.post(`/coupon/${couponId}/reward-rules`, payload);
  return response;
};

export const updateCouponRewardRule = async (
  ruleId: string,
  payload: Record<string, unknown>,
): Promise<any> => {
  const response = await apiClient.patch(`/coupon/reward-rules/${ruleId}`, payload);
  return response;
};

/** ตัดการเชื่อม chain — ลบ reward rule ตาม ruleId */
export const deleteCouponRewardRule = async (ruleId: string): Promise<any> => {
  const response = await apiClient.delete(`/coupon/reward-rules/${ruleId}`);
  return response;
};

export const getCouponNotifyLogs = async (couponId: string): Promise<any> => {
  const response = await apiClient.get(`/coupon/${couponId}/notify-logs`);
  return response;
};
