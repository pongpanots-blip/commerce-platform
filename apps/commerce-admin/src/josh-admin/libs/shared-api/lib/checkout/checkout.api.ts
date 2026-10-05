import { apiClient } from '../api-client/api-client';
import type {
  CartSummary,
  CartSummaryItem,
  ShipmentUpsellDraftItem,
} from '../cart/cart.api';
import type { CouponIneligibleReason } from '../coupon/coupon.api';
import type { ShipmentDeliverySelection } from '../orders/orders.api';
import type { SearchProductResult } from '../search/search.api';

export type CheckoutBranch = {
  id: string;
  name: string;
  deliveryAddress: string | null;
  type: string | null;
  isDefault: boolean;
};

/** GET /checkout/branches item — adds fields for the placement page (shop name,
 * delivery contact, "Note to Delivery"); the `branch` field on validate/prepare
 * responses stays the plain CheckoutBranch shape above. */
export type CheckoutBranchListItem = CheckoutBranch & {
  shopName: string;
  recipientName: string | null;
  phone: string | null;
  deliveryNote: string | null;
};

export type CheckoutPaymentMethod =
  | 'qr'
  | 'credit'
  | 'customer_credit'
  | 'cod'
  | 'payment_link';

export type CheckoutCreditEligibility = {
  eligible: boolean;
  companyName: string | null;
  creditLimit: number;
  creditUsed: number;
  creditAvailable: number;
  creditTermDays: number;
  reason: string | null;
  erpValidated?: boolean;
  /** มีเมื่อส่ง `amount` — backend คิดแล้ว ห้ามคำนวณซ้ำที่ client */
  paymentBreakdown?: CheckoutPaymentBreakdown;
};

export type CheckoutPaymentBreakdown = {
  totalIncVat: number;
  creditApplied: number;
  additionalPaymentRequired: number;
  payNow: number;
  canUseCreditTerms: boolean;
};

export type CheckoutDeliverySlot = {
  id: string;
  slotName: string;
  startTime: string;
  endTime: string;
  label: string;
  maxOrdersPerDay: number;
  bookedCount: number;
  available: boolean;
};

export type FulfillmentType = 'preorder' | 'standard';

export type ResolvedDeliveryDate = {
  workingDate: string;
  displayLabel: string;
  dayColor?: string;
};

export type ShipmentGroupPricing = {
  subtotalExVat: number;
  vatAmount: number;
  subtotalIncVat: number;
  /** Σ ส่วนลดระดับบรรทัดของกลุ่มนี้ (ex VAT) */
  discountExVat: number;
  /** ราคาก่อนหักส่วนลด (ex VAT) = subtotalExVat + discountExVat */
  grossExVat: number;
  deliveryFee: number;
  totalIncVat: number;
  freeDeliveryEligible: boolean;
  freeDeliveryThreshold: number;
  amountToFreeDelivery: number;
};

export type ShipmentGroup = {
  groupKey: string;
  /**
   * Pre-merge groupKeys combined into this card (shared delivery date) —
   * undefined for a group that was never merged. Use this (not a "same
   * picked date" guess) to find this card's own sibling deliveryByGroup
   * entries when re-writing a date/slot pick.
   */
  sourceGroupKeys?: string[];
  fulfillmentType: FulfillmentType;
  items: CartSummaryItem[];
  deliveryDate: ResolvedDeliveryDate;
  availableDates: string[];
  /** Date the customer picked for this group (YYYY-MM-DD); null = default earliest. */
  selectedDeliveryDate?: string | null;
  /** Slot picked with selectedDeliveryDate (saved arrangement); null when not picked yet. */
  selectedTimeSlotId?: string | null;
  /**
   * Dates the customer may pick (union over the group's SKUs). Picking a date only
   * some SKUs can ship splits the rest into their own shipment on their earliest
   * date — see PreparedCheckout.keptOnEarliestDate. Falls back to availableDates.
   */
  selectableDates?: string[];
  /**
   * Per selectable date: lines in this group that cannot ship that day. Non-empty
   * → confirm with the customer before applying the date (those lines get their
   * own shipment on their earliest date).
   */
  dateCoverage?: Array<{ deliveryDate: string; undeliverableProductInventoryIds: string[] }>;
  /** เติมจาก prepare/quote — slots ต่อวัน ไม่ต้องเรียก delivery-slots แยก */
  deliverySlotsByDate?: Array<{
    deliveryDate: string;
    slots: CheckoutDeliverySlot[];
  }>;
  pricing: ShipmentGroupPricing;
  /**
   * Per-section upsell from `POST /checkout/quote` (same shape as
   * `POST /search/upsell` results). Ranked from this group's items;
   * cart SKUs excluded. Soft-wait — `[]` on timeout. Prefer this over a
   * second `getUpsellProducts` call.
   */
  upsell?: SearchProductResult[];
  /**
   * "Unlock Free Shipping" panel — set only on the first shipment (delivery-date
   * order) still under the free-delivery threshold; `null` elsewhere.
   */
  freeShippingPrompt?: FreeShippingPrompt | null;
};

/** SKU line from another shipment that may move into the prompted one. */
export type MoveCandidate = CartSummaryItem & {
  /** send back as `items[].fromGroupKey` on moveCartShipmentItems */
  fromGroupKey: string;
  /** 1-based "Shipment N" of the source */
  fromShipmentNumber: number;
};

export type FreeShippingPrompt = {
  /** `move` = offer the candidate list; `browse_items` = nothing can close the gap, show only "Add more items". */
  action: 'move' | 'browse_items';
  amountToFreeDelivery: number;
  fromShipmentNumbers: number[];
  /** English copy from the server; shop-web renders its own i18n from the fields above */
  message: string;
  moveCandidates: MoveCandidate[];
};

export type MoveCartShipmentItemsPayload = {
  cartId: string;
  toGroupKey: string;
  lang?: string;
  items: Array<{ productInventoryId: string; fromGroupKey: string }>;
  /**
   * Current date/slot picks — without this the server re-clusters preorder
   * groups from scratch (earliest-date keys), which can no longer match the
   * `fromGroupKey`/`toGroupKey` the UI is holding once the customer has
   * picked a date that shifted a group off its default key.
   */
  shipmentDeliveries?: ShipmentDeliverySelection[];
};

/** 422 body of `POST /cart/move` — branch on `error_code`, highlight `productIds` */
export type MoveCartShipmentItemsError = {
  statusCode: 422;
  message: string;
  error_code:
    | 'group_not_found'
    | 'item_not_found'
    | 'not_movable_product'
    | 'not_deliverable_on_target_date'
    | 'source_below_free_delivery_threshold'
    | 'target_below_free_delivery_threshold';
  productIds: string[];
};

/** `POST /cart/move/preview` — same rules as move, nothing written. */
export type MoveCartShipmentItemsPreview = {
  canMove: boolean;
  reason: MoveCartShipmentItemsError['error_code'] | null;
  message: string | null;
  productIds: string[];
  target: {
    groupKey: string;
    subtotalExVatAfter: number;
    freeDeliveryEligibleAfter: boolean;
    amountToFreeDeliveryAfter: number;
  } | null;
  sources: Array<{
    groupKey: string;
    subtotalExVatAfter: number;
    freeDeliveryEligibleAfter: boolean;
  }>;
};

export type PreparedCheckout = {
  shipmentGroups: ShipmentGroup[];
  /** Pre-order SKUs split into their own shipment because the chosen date did not cover them. */
  keptOnEarliestDate?: string[];
  totalIncVat: number;
  invoiceCount: number;
};

export type StockIssue = {
  sku: string;
  quantity: number;
  availableQuantity: number;
  fulfillmentType: string;
  productName?: string;
};

export type PriceIssue = {
  sku: string;
  productInventoryId: string;
  productName?: string;
  quantity: number;
  oldPrice: number;
  newPrice: number;
  reason: 'special_price_expired' | 'price_changed';
  fulfillmentType?: string;
};

export type PrepareCheckoutPayload = {
  cartId: string;
  branchId: string;
  userId: string;
  /**
   * วัน/ช่วงเวลาที่เลือกไว้ต่อ shipment group
   * กลุ่มที่วันจัดส่งตรงกัน (ไม่สนช่วงเวลา) จะถูก backend รวมเป็น shipment เดียว
   * ออปชัน — ถ้าไม่ส่ง ใช้ค่าที่เซฟไว้จาก `PUT /checkout/shipment-deliveries`
   * (หรือค่าที่เคยส่งมากับ prepare/quote/validate ก่อนหน้า เพราะ body จะ upsert Redis)
   */
  shipmentDeliveries?: ShipmentDeliverySelection[];
};

/**
 * Flash-sale (capped promotion) the cart wants more units of than are left. `reason` is the same
 * string as `error_code` of the 400 that payment / create order answer with. docs/checkout-api.md
 */
export type PromotionIssue = {
  reason: 'promotion_sold_out';
  promotionMechanicId: string;
  promotionName: string;
  /** Units in the cart under this promotion. */
  quantity: number;
  /** Units left under the cap (0 = sold out). */
  remainingUnits: number;
};

export type ValidateCheckoutPayload = {
  cartId: string;
  branchId: string;
  userId: string;
  paymentMethod: CheckoutPaymentMethod;
  deliveryDate?: string;
  timeSlotId?: string;
  shipmentDeliveries?: ShipmentDeliverySelection[];
  shipmentUpsellDraftItems?: ShipmentUpsellDraftItem[];
  couponCode?: string;
};

export type ValidateCheckoutResult = {
  valid: boolean;
  errors: string[];
  pricing: CartSummary;
  branch: CheckoutBranch;
  credit: CheckoutCreditEligibility;
  paymentBreakdown?: CheckoutPaymentBreakdown;
  prepared?: PreparedCheckout;
  stockIssues?: StockIssue[];
  priceIssues?: PriceIssue[];
  promotionIssues?: PromotionIssue[];
  coupon?: {
    valid: boolean;
    errors: string[];
    couponCode?: string;
    couponTitle?: string;
    /** ส่วนลดฐานก่อน VAT — ค่าที่ลดฐานภาษีและขึ้นใบกำกับภาษี */
    discountExVat: number;
    /** Explicit coupon base before VAT; 0 when no coupon applies. */
    couponDiscountExVat: number;
    /** ส่วนลดที่ลูกค้าเห็น — ใช้ตัวนี้แสดงแถวส่วนลด/หักออกจาก total */
    discountIncVat: number;
    couponDiscount: number;
    totalIncVat: number;
    /** Why this coupon can't be applied to the current cart; `null` when valid. */
    ineligibleReason: CouponIneligibleReason | null;
    /** `true` = picked by the system (`auto_apply`; removable — `DELETE /coupon/apply` opts the cart out of auto); `false` = chosen by the customer. */
    isAutomatic: boolean;
  };
};

export type QuoteCheckoutPayload = {
  cartId: string;
  userId: string;
  branchId?: string;
  paymentMethod?: CheckoutPaymentMethod;
  couponCode?: string;
  shipmentDeliveries?: ShipmentDeliverySelection[];
  /** Temporary Shipment Explore More additions; priced and grouped for preview only. */
  shipmentUpsellDraftItems?: ShipmentUpsellDraftItem[];
  /** Forwarded to per-section upsell enrichment */
  lang?: string;
};

export type QuoteOrderSummary = {
  /** Product Price (Before VAT) */
  grossExVat: number;
  /** Product Discount */
  discountExVat: number;
  productDiscount: number;
  /** ยอด CN ที่ระบบ auto-หัก (ex VAT). `null` เมื่อไม่มี */
  creditNote: number | null;
  /** ยอด Credit Back ที่ระบบ auto-หัก (ex VAT, ใช้บางส่วนได้). `null` เมื่อไม่มี */
  creditBack: number | null;
  /** Coupon Discount (ex VAT); 0 when none */
  couponDiscountExVat: number;
  couponDiscount: number;
  subtotalExVat: number;
  vatAmount: number;
  deliveryFee: number;
  freeDeliveryEligible: boolean;
  freeDeliveryThreshold: number;
  amountToFreeDelivery: number;
  totalIncVat: number;
};

export type QuoteCheckoutResult = {
  /** ยอดจ่ายจริงหลังหัก CN และคูปอง — ห้ามลบ creditNote ซ้ำที่ UI */
  totalIncVat: number;
  /** Order Summary ทั้งออเดอร์ — แถวเดียวกับ UI */
  orderSummary: QuoteOrderSummary;
  /** ยอดแยก shipment — ใช้ `shipmentGroups[].pricing` */
  prepared: PreparedCheckout;
  credit: CheckoutCreditEligibility;
  /** มีเมื่อส่ง `paymentMethod: customer_credit` */
  paymentBreakdown?: CheckoutPaymentBreakdown;
  coupon?: ValidateCheckoutResult['coupon'];
};

export const getCheckoutBranches = async (
  userId: string,
): Promise<CheckoutBranchListItem[]> => {
  const response = await apiClient.get<CheckoutBranchListItem[]>(
    `/checkout/branches?userId=${encodeURIComponent(userId)}`,
  );
  return response.data;
};

export const getCheckoutCreditEligibility = async (
  userId: string,
  amount?: number,
): Promise<CheckoutCreditEligibility> => {
  const params = new URLSearchParams({ userId });
  if (amount != null && amount > 0) {
    params.set('amount', String(amount));
  }
  const response = await apiClient.get<CheckoutCreditEligibility>(
    `/checkout/credit-eligibility?${params.toString()}`,
  );
  return response.data;
};

export const getCheckoutDeliverySlots = async (
  deliveryDate: string,
): Promise<CheckoutDeliverySlot[]> => {
  const response = await apiClient.get<CheckoutDeliverySlot[]>(
    `/checkout/delivery-slots?deliveryDate=${encodeURIComponent(deliveryDate)}`,
  );
  return response.data;
};

export type CheckoutDeliverySlotsByDate = {
  deliveryDate: string;
  slots: CheckoutDeliverySlot[];
};

/** Prefetch slots หลายวันในครั้งเดียว (สูงสุด 7 — ตรงหน้าต่าง availableDates) */
export const getCheckoutDeliverySlotsByDates = async (
  deliveryDates: string[],
): Promise<CheckoutDeliverySlotsByDate[]> => {
  const response = await apiClient.get<CheckoutDeliverySlotsByDate[]>(
    `/checkout/delivery-slots?deliveryDates=${encodeURIComponent(deliveryDates.join(','))}`,
  );
  return response.data;
};

export const prepareCheckout = async (
  payload: PrepareCheckoutPayload,
): Promise<PreparedCheckout> => {
  const response = await apiClient.post<PreparedCheckout>(
    '/checkout/prepare',
    payload,
  );
  return response.data;
};

export const validateCheckout = async (
  payload: ValidateCheckoutPayload,
): Promise<ValidateCheckoutResult> => {
  const response = await apiClient.post<ValidateCheckoutResult>(
    '/checkout/validate',
    payload,
  );
  return response.data;
};

/** ยอด live หลังคูปอง + credit breakdown — ไม่เช็ค stock / ไม่มี token */
export const quoteCheckout = async (
  payload: QuoteCheckoutPayload,
): Promise<QuoteCheckoutResult> => {
  const response = await apiClient.post<QuoteCheckoutResult>(
    '/checkout/quote',
    payload,
  );
  return response.data;
};

export type ShipmentGroupDetailPayload = QuoteCheckoutPayload & {
  groupKey: string;
};

/**
 * รายละเอียด shipment เดียวก่อนสั่งซื้อ (modal "ดูรายละเอียด" หน้า placement) —
 * quote ด้วย context เดิมแล้วกรองเหลือ groupKey เดียว ราคาจึงตรงกับการ์ดเป๊ะ
 */
export const getShipmentGroupDetail = async (
  payload: ShipmentGroupDetailPayload,
): Promise<ShipmentGroup> => {
  const response = await apiClient.post<ShipmentGroup>(
    '/checkout/shipment-group',
    payload,
  );
  return response.data;
};

/**
 * Persist one shipment group's delivery date/slot for a cart.
 * Minimal: `cartId` + `groupKey` + `deliveryDate` + `timeSlotId`.
 * Server fills `items` / `fulfillmentType` from prepare when omitted.
 */
export const saveCheckoutShipmentDelivery = async (payload: {
  cartId: string;
  userId?: string;
  branchId?: string;
  /** Prefer `groupKey` from prepare; required if fulfillmentType omitted */
  groupKey?: string;
  fulfillmentType?: string;
  deliveryDate: string;
  timeSlotId: string;
  /** Same day, new slot — server skips Jagota / re-cluster. */
  slotOnly?: boolean;
  items?: Array<{
    productInventoryId: string;
    sku?: string;
    quantity: number;
  }>;
}): Promise<{
  cartId: string;
  /**
   * Pre-order SKUs that cannot ship on the chosen date — the server kept them
   * on their own earliest date as a separate shipment (the rest moved). Empty
   * when the whole group took the date.
   */
  keptOnEarliestDate: string[];
  /**
   * Groups after this pick (merge/split already applied) + `deliverySlotsByDate`.
   * Date-change only — same-day `slotOnly` omits this; keep the last quote cards.
   * Do not quote again just to refresh boxes when this is present.
   */
  prepared?: PreparedCheckout;
  shipmentDeliveries: Array<
    ShipmentDeliverySelection & {
      items?: Array<{
        productInventoryId: string;
        sku?: string;
        quantity: number;
      }>;
    }
  >;
}> => {
  const response = await apiClient.put<{
    success: boolean;
    data: {
      cartId: string;
      keptOnEarliestDate?: string[];
      prepared?: PreparedCheckout;
      shipmentDeliveries: Array<
        ShipmentDeliverySelection & {
          items?: Array<{
            productInventoryId: string;
            sku?: string;
            quantity: number;
          }>;
        }
      >;
    };
  }>('/checkout/shipment-deliveries', payload);
  const data = response.data.data;
  return { ...data, keptOnEarliestDate: data.keptOnEarliestDate ?? [] };
};

/** Read saved delivery choices for a cart — `shipmentDeliveries` is null when unset. */
export const getCheckoutShipmentDeliveries = async (
  cartId: string,
): Promise<{
  cartId: string;
  shipmentDeliveries: Array<
    ShipmentDeliverySelection & {
      items?: Array<{
        productInventoryId: string;
        sku?: string;
        quantity: number;
      }>;
    }
  > | null;
}> => {
  const response = await apiClient.get<{
    success: boolean;
    data: {
      cartId: string;
      shipmentDeliveries: Array<
        ShipmentDeliverySelection & {
          items?: Array<{
            productInventoryId: string;
            sku?: string;
            quantity: number;
          }>;
        }
      > | null;
    };
  }>(`/checkout/shipment-deliveries?cartId=${encodeURIComponent(cartId)}`);
  return response.data.data;
};

/**
 * Move whole SKU lines into another checkout shipment (customer-chosen).
 * Returns the re-split groups — same shape as prepare, without slots/quote.
 * Follow with `quoteCheckout` for the live totals.
 */
export const moveCartShipmentItems = async (
  payload: MoveCartShipmentItemsPayload,
): Promise<PreparedCheckout> => {
  const response = await apiClient.post<PreparedCheckout>('/cart/move', payload);
  return response.data;
};

/** Check a candidate selection before offering Move — enable the button only when `canMove`. */
export const previewCartShipmentMove = async (
  payload: MoveCartShipmentItemsPayload,
): Promise<MoveCartShipmentItemsPreview> => {
  const response = await apiClient.post<MoveCartShipmentItemsPreview>(
    '/cart/move/preview',
    payload,
  );
  return response.data;
};

/**
 * Leaving the Shipment screen — "save these shipments?"
 * yes → keep the moves + date/slot picks for this cart; no → drop them (cart lines stay).
 */
export const saveCartShipments = async (cartId: string): Promise<{ cartId: string; status: 'saved' }> => {
  const response = await apiClient.post<{ cartId: string; status: 'saved' }>('/cart/shipments/save', { cartId });
  return response.data;
};

export const discardCartShipments = async (cartId: string): Promise<{ cartId: string; status: 'discarded' }> => {
  const response = await apiClient.post<{ cartId: string; status: 'discarded' }>('/cart/shipments/discard', { cartId });
  return response.data;
};
