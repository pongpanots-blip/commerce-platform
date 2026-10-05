/**
 * Coupon `payment_methods.allowed_methods` values — single source of truth for
 * admin (rule editor) and backend (redemption validation).
 *
 * Checkout sends a raw `CheckoutPaymentMethod` (see checkout.api.ts), which
 * includes `payment_link` (card paid via a payment link) and legacy `cod`.
 * Coupon rules only ever store/offer the three values below; `payment_link`
 * is normalized to `credit` since it's the same business channel (card).
 *
 * Used by web-admin. `apps/backend` cannot import this lib (Node16/rootDir
 * config, no build target) — it keeps its own mirror at
 * `apps/backend/src/shared/constants/coupon-payment-methods.constants.ts`.
 * Update both if this logic changes.
 */
export type CouponPaymentMethod = 'qr' | 'credit' | 'customer_credit';

export const COUPON_PAYMENT_METHOD_OPTIONS: ReadonlyArray<{
  value: CouponPaymentMethod;
  label: string;
}> = [
  { value: 'qr', label: 'QR / PromptPay' },
  { value: 'credit', label: 'บัตรเครดิต' },
  { value: 'customer_credit', label: 'เครดิตเทอม' },
];

// ponytail: cod ถูกถอดออกจากตัวเลือกที่เลือกได้ แต่คูปองเก่าที่บันทึก 'cod' ไว้ยังต้องแสดงผลได้
const LEGACY_PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: 'เก็บเงินปลายทาง (COD)',
};

/** checkout method → value that coupon rules understand. `payment_link` (card by link) = `credit`. */
export function normalizeCouponPaymentMethod(method: string): string {
  return method === 'payment_link' ? 'credit' : method;
}

export function couponPaymentMethodLabel(method: string): string {
  return (
    COUPON_PAYMENT_METHOD_OPTIONS.find((option) => option.value === method)
      ?.label ??
    LEGACY_PAYMENT_METHOD_LABELS[method] ??
    method
  );
}
