import type { CouponProductPick } from './coupon-redemption.helpers';
import {
  COUPON_PAYMENT_METHOD_OPTIONS,
  couponPaymentMethodLabel,
  type CouponPaymentMethod,
} from '@josh/shared-api';

export type CouponSkuMinimumRow = {
  rowId: string;
  product: CouponProductPick;
  minSubtotal: string;
  minQuantity: string;
};

export type CouponPaymentMethodValue = CouponPaymentMethod;

export { COUPON_PAYMENT_METHOD_OPTIONS };
export const paymentMethodLabel = couponPaymentMethodLabel;
