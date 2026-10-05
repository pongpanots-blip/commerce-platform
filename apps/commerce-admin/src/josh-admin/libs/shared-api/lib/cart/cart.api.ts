import { apiClient } from '../api-client/api-client';
import type { SearchProductResult } from '../search/search.api';
import type { CouponIneligibleReason } from '../coupon/coupon.api';

export type CartSummaryItem = {
  productInventoryId: string;
  productId: string;
  productName: string;
  sku: string;
  variantName: string;
  quantity: number;
  unitPriceExVat: number;
  unitPriceIncVat: number;
  lineTotalExVat: number;
  lineTotalIncVat: number;
  vatRate: number;
  /** ERP MOQ (order-taking units); default 1 when unset. */
  minQuantity?: number;
  maxQuantity?: number;
  fulfillmentType?: 'preorder' | 'standard';
  orderTakingFlag?: string | null;
  /** Can move between checkout shipments (normal stock, not order-taking). Checkout groups only. */
  movable?: boolean;
  imageUrl?: string;
  packSize?: string | null;
  sellingUnit?: string | null;
  /** Per-sub-unit price range of this line, inc VAT — computed by the shared
   * `computeAvgPrice()` divisor rules, divided from what the customer actually pays.
   * Equal min/max for anything that isn't a variable-weight range. null when the
   * packaging has no divisor; the UI then falls back to unitPriceIncVat/sellingUnit. */
  subUnitPriceMinIncVat?: number | null;
  subUnitPriceMaxIncVat?: number | null;
  /** @deprecated use subUnitPriceMaxIncVat */
  subUnitPriceIncVat?: number | null;
  subUnitLabel?: string | null;
  weightPerUnit?: string | null;
  weightMin?: number | null;
  weightMax?: number | null;
  weightUnit?: string | null;
  priceSource?: string;
  hasCustomerPrice?: boolean;
  isSpecialPrice?: boolean;
  /** Only meaningful when isSpecialPrice is true (customer_sku/contract_sku) —
   * bounds the delivery-date picker so it can't offer dates after this price expires. */
  specialPriceEndDate?: string | null;
  basePrice?: number;
  unitListPriceIncVat?: number;
  unitListPriceExVat?: number;
  /** ส่วนลดของบรรทัดนี้ (ex VAT) — backend คิดให้ อย่าคำนวณซ้ำฝั่ง client */
  lineDiscountExVat: number;
  /** ยอดบรรทัดตามราคาป้าย (inc VAT) สำหรับขีดฆ่า — 0 เมื่อไม่มีส่วนลด */
  lineListTotalIncVat: number;
  /** % ส่วนลดสำหรับ badge — 0 เมื่อไม่มีส่วนลด */
  discountPct: number;
  /** Earliest open OT delivery date (ISO YYYY-MM-DD); null when none or not OT */
  earliestDeliveryDate?: string | null;
};

export type CartSummaryGroup = {
  items: CartSummaryItem[];
  subtotalExVat: number;
  vatAmount: number;
  subtotalIncVat: number;
  discountExVat: number;
  grossExVat: number;
};

export type CartSummary = {
  /** Grouped sections (present on new API) */
  standard?: CartSummaryGroup;
  orderTaking?: CartSummaryGroup;
  /** Flat merge of all lines (always present for transition) */
  items: CartSummaryItem[];
  subtotalExVat: number;
  vatAmount: number;
  subtotalIncVat: number;
  /** Σ ส่วนลดระดับบรรทัด (ex VAT) — แถว "Discount" อ่านจากค่านี้ */
  discountExVat: number;
  /** ราคาก่อนหักส่วนลด (ex VAT) — แถว "Product Price (Before VAT)" อ่านจากค่านี้ */
  grossExVat: number;
  deliveryFee: number;
  totalIncVat: number;
  freeDeliveryEligible: boolean;
  freeDeliveryThreshold: number;
  amountToFreeDelivery: number;
  /**
   * Cart-wide upsell rail (same shape as `POST /search/upsell` results).
   * Soft-wait on the server — may be `[]` on timeout/outage. Prefer this on
   * `/cart` instead of a second `getUpsellProducts` call. Checkout per-shipment
   * rails use `shipmentGroups[].upsell` from `POST /checkout/quote`.
   */
  upsell?: SearchProductResult[];
  /**
   * Applied credit-note amount **ex VAT**. `null` when none is on the cart.
   */
  creditNote?: number | null;
  /**
   * Applied credit-back amount **ex VAT**. `null` when none.
   * Partial use is allowed (unlike credit notes).
   */
  creditBack?: number | null;
  /**
   * Applied coupon from `POST /coupon/apply` (Redis cart session), or — when none is
   * selected and the user is signed in — the `auto_apply` coupon Checkout would pick.
   * Null when neither. Cart never deducts it (discount fields stay 0).
   */
  coupon?: {
    valid: boolean;
    errors: string[];
    couponCode?: string;
    couponTitle?: string;
    /** Why this coupon can't be applied to the current cart; `null` when valid. */
    ineligibleReason: CouponIneligibleReason | null;
    discountExVat: number;
    discountIncVat: number;
    couponDiscountExVat: number;
    couponDiscount: number;
    totalIncVat: number;
    /** `true` = picked by the system (`auto_apply`; removable — `DELETE /coupon/apply` opts the cart out of auto); `false` = chosen by the customer. */
    isAutomatic: boolean;
  } | null;
  /**
   * Next automatic promotion the cart is one min-spend away from:
   * "add `amountToUnlockIncVat` (inc VAT) more to get `couponTitle`".
   * `null` when there is none, when a manual coupon is selected (it always wins), or for guests.
   */
  nextPromotion?: {
    couponTitle: string;
    amountToUnlockIncVat: number;
  } | null;
  meta?: {
    cartId: string;
    hydratedFromDb: boolean;
    preorderListCount?: number;
    totalItems?: number;
    readyToShipCount?: number;
    preOrderCount?: number;
    notReadyForSaleCount?: number;
    overdueInvoiceCount?: number;
  };
};

export type PreorderListItem = CartSummaryItem & {
  id: string;
  canAddToCart: boolean;
};

export type PreorderListResponse = {
  items: PreorderListItem[];
  meta: { cartId: string; preorderListCount: number };
};

export type ConvertBookingsResult = {
  converted: Array<{ id: string; sku: string; quantity: number }>;
  skipped: Array<{ id: string; sku: string; reason: 'round_not_open' | 'not_found' | 'invalid_quantity' | 'product_inactive' }>;
};

/** Nested Redis cart shape returned by load-redis / sync-redis */
export type GroupedCartPayload = {
  standard: Record<string, unknown>;
  orderTaking: Record<string, unknown>;
  flat: Record<string, unknown>;
  meta: { cartId: string; hydratedFromDb: boolean };
};

export type CartBooking = {
  id: string;
  device_id: string;
  user_id: string | null;
  product_inventory_id: string;
  sku: string;
  quantity: string | number;
  status: string;
  created_at?: string;
  updated_at?: string;
};

/** sync-redis when backend routes Y + no dates → booking table */
export type SyncCartBookingResponse = {
  destination: 'booking';
  booking: CartBooking;
};

export type SyncCartPayload = {
  cartId: string;
  productId: string;
  productName: string;
  companyId?: string;
  branchId?: string;
  /**
   * Shipment group the line should join ('standard' | 'preorder'). Sent by checkout's
   * shipment wizard so a stock item added from its upsell rail lands in the shipment
   * on screen. The server validates it (stock items only, target group must already
   * exist in the cart) and silently falls back to the product's own flag otherwise.
   */
  fulfillmentType?: string;
  /**
   * Stable checkout group key (`standard` | `preorder:YYYY-MM-DD`) — targets a specific
   * preorder cluster when the wizard has multiple preorder steps.
   */
  groupKey?: string;
  /** Both upsell types sort last; omit for normal (newest on top). */
  addedVia?: 'upsell' | 'upsellExplore' | 'normal';
  inventory: {
    product_inventory_id: string;
    sku: string;
    variant_name: string;
    price: number;
    quantity: number;
    pre_order_round_id?: string;
    pack_size?: string;
    selling_unit?: string;
    weight_per_unit?: string;
    image_url?: string;
    product_image_url?: string;
  };
};

/** Unsaved quantity increase staged from Explore More on the Shipment screen. */
export type ShipmentUpsellDraftItem = {
  productInventoryId: string;
  productName: string;
  sku: string;
  variantName: string;
  /** Quantity on the main cart when this draft item was first added. */
  baseQuantity: number;
  /** Additional quantity; never written to the main cart before commit. */
  quantity: number;
  groupKey: string;
};

export function isSyncCartBookingResponse(
  payload: unknown,
): payload is SyncCartBookingResponse {
  return (
    !!payload &&
    typeof payload === 'object' &&
    (payload as SyncCartBookingResponse).destination === 'booking'
  );
}

/** Prefer nested flat map when API returns grouped cart; else pass through legacy shape. */
export function unwrapFlatCartPayload(payload: unknown): unknown {
  if (
    payload &&
    typeof payload === 'object' &&
    'flat' in payload &&
    (payload as GroupedCartPayload).flat != null &&
    typeof (payload as GroupedCartPayload).flat === 'object'
  ) {
    return (payload as GroupedCartPayload).flat;
  }
  return payload;
}

/**
 * Collapses the burst of identical `/cart/summary` GETs one page load fires — ShopHeader's
 * badge, the page itself, React StrictMode's double effect in dev. `inFlight` shares a
 * running request; `fresh` covers consumers that mount a few hundred ms apart (Suspense
 * hydration order), which an in-flight share alone misses.
 *
 * The window is deliberately tiny and every write below drops it, so a mutation is never
 * read back stale. Anything that changes the cart outside this module (coupon apply, order
 * placement) is a user action seconds later — far outside the window.
 * ponytail: 1s + explicit invalidation. If a cross-tab or push-driven cart update ever
 * needs to show up instantly, drop the `fresh` map and keep `inFlight`.
 */
const SUMMARY_FRESH_MS = 1_000;
const summaryInFlight = new Map<string, Promise<CartSummary>>();
const summaryFresh = new Map<string, { at: number; value: CartSummary }>();

function invalidateCartSummary(): void {
  summaryFresh.clear();
}

export const syncRedis = async (
  data:
    | SyncCartPayload
    | {
        cartId: string;
        branchId?: string;
        addedVia: 'upsellExplore';
        shipmentUpsellDraftItems: ShipmentUpsellDraftItem[];
      },
): Promise<any> => {
  const response = await apiClient.post(`/cart/sync-redis`, data);
  invalidateCartSummary();
  return response;
};

export const commitShipmentUpsellDraft = async (
  cartId: string,
  items: ShipmentUpsellDraftItem[],
  branchId?: string,
): Promise<{ cartId: string; addedVia: 'upsellExplore'; committedItems: number }> => {
  const response = await syncRedis({
    cartId,
    branchId,
    addedVia: 'upsellExplore',
    shipmentUpsellDraftItems: items,
  });
  return response.data?.data;
};

export const loadRedis = async (cartId: string): Promise<any> => {
  const response = await apiClient.get(`/cart/load-redis?cartId=${cartId}`);
  return response;
};

export const getCartSummary = (
  cartId: string,
  opts?: { lang?: string; branchId?: string; companyId?: string },
): Promise<CartSummary> => {
  const cacheKey = `${cartId}|${opts?.lang ?? ''}|${opts?.branchId ?? ''}|${opts?.companyId ?? ''}`;
  const pending = summaryInFlight.get(cacheKey);
  if (pending) return pending;

  const cached = summaryFresh.get(cacheKey);
  if (cached && Date.now() - cached.at < SUMMARY_FRESH_MS) {
    return Promise.resolve(cached.value);
  }

  const params = new URLSearchParams({ cartId });
  if (opts?.lang) params.set('lang', opts.lang);
  if (opts?.branchId) params.set('branchId', opts.branchId);
  if (opts?.companyId) params.set('companyId', opts.companyId);

  const request = apiClient
    .get<{ success: boolean; data: CartSummary }>(
      `/cart/summary?${params.toString()}`,
    )
    .then((response) => {
      const summary = response.data.data;
      summaryFresh.set(cacheKey, { at: Date.now(), value: summary });
      return summary;
    })
    .finally(() => summaryInFlight.delete(cacheKey));

  summaryInFlight.set(cacheKey, request);
  return request;
};

export const updateCartItem = async (
  variantId: string,
  payload: {
    cartId: string;
    productId: string;
    quantity: number;
    companyId?: string;
    branchId?: string;
  },
): Promise<CartSummary> => {
  const response = await apiClient.patch<{ success: boolean; data: CartSummary }>(
    `/cart/items/${encodeURIComponent(variantId)}`,
    payload,
  );
  invalidateCartSummary();
  return response.data.data;
};

export const removeCartItem = async (
  variantId: string,
  payload: { cartId: string; productId: string },
): Promise<CartSummary> => {
  const response = await apiClient.delete<{ success: boolean; data: CartSummary }>(
    `/cart/items/${encodeURIComponent(variantId)}`,
    { data: payload },
  );
  invalidateCartSummary();
  return response.data.data;
};

export type CartPriceIssue = {
  sku: string;
  productInventoryId: string;
  productName?: string;
  quantity: number;
  oldPrice: number;
  newPrice: number;
  reason: 'special_price_expired' | 'price_changed';
  fulfillmentType?: string;
  /** `needs_confirmation` — the shopper accepts these via `repriceCartLines`. */
  resolution?: CartIssueResolution;
};

/**
 * Whether the cart already acted on an issue (`applied`) or is waiting on the
 * shopper (`needs_confirmation`) — read this instead of assuming per list.
 */
export type CartIssueResolution = 'applied' | 'needs_confirmation';

export const getCartPriceIssues = async (payload: {
  cartId: string;
  branchId?: string;
  companyId?: string;
}): Promise<CartPriceIssue[]> => {
  const params = new URLSearchParams({ cartId: payload.cartId });
  if (payload.branchId) params.set('branchId', payload.branchId);
  if (payload.companyId) params.set('companyId', payload.companyId);
  const response = await apiClient.get<{
    success: boolean;
    data: { priceIssues: CartPriceIssue[] };
  }>(`/cart/price-issues?${params.toString()}`);
  return response.data.data?.priceIssues ?? [];
};

export type CartPreorderIssue = {
  sku: string;
  productInventoryId: string;
  productName?: string;
  quantity: number;
  reason:
    | 'preorder_round_closed'
    | 'delivery_date_changed'
    | 'became_preorder'
    | 'became_standard';
  oldDeliveryDate: string | null;
  newDeliveryDate: string | null;
  movedTo: 'preorder_list' | 'preorder' | 'standard';
  /** `applied` — the move already happened; show it, do not ask to confirm. */
  resolution?: CartIssueResolution;
};

/**
 * Cart-open re-check: one request instead of `getCartSummary` +
 * `getCartPriceIssues`. `preorderIssues` are already applied to `cart`;
 * `priceIssues` still need the shopper to confirm via `repriceCartLines`.
 */
export const revalidateCart = async (payload: {
  cartId: string;
  deviceId?: string;
  branchId?: string;
  companyId?: string;
  lang?: string;
}): Promise<{
  priceIssues: CartPriceIssue[];
  preorderIssues: CartPreorderIssue[];
  cart: CartSummary;
}> => {
  const response = await apiClient.post<{
    success: boolean;
    data: {
      priceIssues: CartPriceIssue[];
      preorderIssues: CartPreorderIssue[];
      cart: CartSummary;
    };
  }>('/cart/revalidate', payload);
  // The pre-order moves changed the cart server-side — drop the memoised
  // summary so the next reader does not serve the pre-move version.
  invalidateCartSummary();
  const data = response.data.data;
  return {
    priceIssues: data?.priceIssues ?? [],
    preorderIssues: data?.preorderIssues ?? [],
    cart: data.cart,
  };
};

export const repriceCartLines = async (payload: {
  cartId: string;
  productInventoryIds: string[];
  companyId?: string;
  branchId?: string;
}): Promise<CartSummary> => {
  const response = await apiClient.post<{ success: boolean; data: CartSummary }>(
    '/cart/reprice',
    payload,
  );
  invalidateCartSummary();
  return response.data.data;
};

export const listCartBookings = async (
  cartId: string,
  opts?: { lang?: string; branchId?: string; companyId?: string },
): Promise<PreorderListResponse> => {
  const params = new URLSearchParams({ cartId });
  if (opts?.lang) params.set('lang', opts.lang);
  if (opts?.branchId) params.set('branchId', opts.branchId);
  if (opts?.companyId) params.set('companyId', opts.companyId);

  const res = await apiClient.get<{ success: boolean; data: PreorderListResponse }>(
    `/cart/bookings?${params.toString()}`,
  );
  return res.data.data;
};

export const convertCartBookings = async (payload: {
  cartId: string;
  items: Array<{ id: string; quantity: number }>;
  deviceId?: string;
}): Promise<ConvertBookingsResult> => {
  const res = await apiClient.post<{ success: boolean; data: ConvertBookingsResult }>(
    '/cart/bookings/convert',
    payload,
  );
  invalidateCartSummary();
  return res.data.data;
};

export const updateCartBooking = async (
  bookingId: string,
  quantity: number,
  identity: { cartId?: string; deviceId?: string },
): Promise<CartBooking> => {
  const res = await apiClient.patch<{ success: boolean; data: CartBooking }>(
    `/cart/bookings/${encodeURIComponent(bookingId)}`,
    {
      quantity,
      cartId: identity.cartId,
      deviceId: identity.deviceId ?? identity.cartId,
    },
  );
  invalidateCartSummary();
  return res.data.data;
};

export const cancelCartBooking = async (
  bookingId: string,
  identity: { cartId?: string; deviceId?: string },
): Promise<void> => {
  const deviceId = identity.deviceId ?? identity.cartId;
  const qs = deviceId
    ? `?${identity.deviceId ? `deviceId=${encodeURIComponent(identity.deviceId)}` : `cartId=${encodeURIComponent(identity.cartId!)}`}`
    : '';
  await apiClient.delete(
    `/cart/bookings/${encodeURIComponent(bookingId)}${qs}`,
  );
  invalidateCartSummary();
};
