import type { AxiosResponse } from 'axios';
import { uiText } from '@cp/ui';
import { apiClient } from '../api-client/api-client';

export interface OrderListParams {
  /** Company admin: branch UUID or all. Staff stays scoped by the server. */
  branchId?: string;
  page?: number;
  limit?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
  sortKey?: string;
  sortOrder?: 'ASC' | 'DESC';
  search?: string;
}

export const getOrders = async (params: OrderListParams = {}): Promise<any> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams.set(key, String(value));
    }
  });
  const response = await apiClient.get(`/orders?${searchParams.toString()}`);
  return response;
};

export const getMyOrders = async (params: OrderListParams = {}): Promise<any> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams.set(key, String(value));
    }
  });
  const response = await apiClient.get(`/orders/my?${searchParams.toString()}`);
  return response;
};

export const getReorderPreview = async (ordersId: string): Promise<any> => {
  const response = await apiClient.get(`/orders/${ordersId}/reorder-preview`);
  return response;
};

export type ApplyReorderPayload = {
  cartId: string;
  items?: Array<{ productInventoryId: string; quantity: number }>;
};

export const applyReorder = async (
  ordersId: string,
  payload: ApplyReorderPayload,
): Promise<any> => {
  const response = await apiClient.post(`/orders/${ordersId}/reorder`, payload);
  return response;
};

/** คืน AxiosResponse ทั้งก้อน ไม่ใช่ body — `response.status` คือ HTTP code
 *  ส่วน AppResponse ของหลังบ้านอยู่ที่ `response.data` (ตามที่ทุก caller ใช้จริง) */
export const getOrderById = async (
  ordersId: string,
  lang?: 'th' | 'en',
): Promise<
  AxiosResponse<{
    status: boolean;
    statusCode: number;
    message: string;
    data: OrderDetail;
  }>
> => {
  const response = await apiClient.get(
    `/orders/${ordersId}${lang ? `?lang=${lang}` : ''}`,
  );
  return response;
};

/** Nested shipment card on Order Detail (includes unpaid). */
export type OrderDetailShipmentStatus =
  | 'to_ship'
  | 'shipping'
  | 'delivered'
  | 'cancelled'
  | 'unpaid';

export type OrderDetailShipmentItem = {
  orderItemId: string;
  productName: string;
  quantity: number;
  quantityLabel: string;
  packLabel: string | null;
  unitPriceIncVat: number;
  unitPriceLabel: string;
  lineTotalIncVat: number;
  imageUrl: string | null;
  isRefunded: boolean;
};

export type OrderDetailShipment = {
  shipmentId: string;
  shipmentNumber: string;
  sequence: number;
  shipmentIndexLabel: string;
  status: OrderDetailShipmentStatus;
  statusLabel: string;
  statusDateLabel:
    | 'delivery_slot'
    | 'estimated_arrival'
    | 'delivered'
    | 'cancelled';
  statusDate: string | null;
  deliverySlotLabel: string | null;
  deliveryDate: string | null;
  statusTimeRange: string | null;
  itemCount: number;
  totalIncVat: number;
  refundedItemCount: number | null;
  refundRequestId: string | null;
  items: OrderDetailShipmentItem[];
};

export type OrderDetailItem = {
  orderItemId: string;
  sku: string;
  productName: string;
  quantity: number;
  quantityLabel: string;
  packLabel: string | null;
  unitPriceIncVat: number;
  unitPriceLabel: string;
  lineTotalIncVat: number;
  imageUrl: string | null;
  status: string;
};

export type OrderDetail = {
  orderId: string;
  orderNumber: string | null;
  totalIncVat: number;
  orderStatus: string;
  statusGroup: string;
  paymentMethod: string | null;
  canCancel: boolean;
  statusBannerLabel: string | null;
  orderTimeLabel: string | null;
  variableWeightNote: string;
  subtotalExVat: number;
  vatAmount: number;
  subtotalIncVat: number;
  deliveryFee: number;
  deliveryFeeLabel: string;
  /** Product line discount before VAT; 0 when absent. */
  discountExVat: number;
  /** Coupon discount accounting base before VAT; 0 when absent. */
  couponDiscountExVat: number;
  /** ส่วนลดที่ลูกค้าเห็นตอนกดใช้คูปอง (inc VAT) — ใช้โชว์ */
  discountIncVat: number;
  productDiscount: number;
  couponDiscount: number;
  grossExVat: number;
  /** มูลค่าสินค้าก่อนหักส่วนลด (inc VAT) = `subtotalIncVat + discountIncVat` */
  grossIncVat: number;
  creditNoteExVat: number;
  creditBackExVat: number;
  paymentExpiresAt: string | null;
  paymentMethodLabel: string | null;
  canPay: boolean;
  canChangePayment: boolean;
  /** Values to send as `paymentMethod` on `POST /payment` with `orderDocumentNo` */
  changeablePaymentMethods: Array<'Qr' | 'Card' | 'credit'>;
  paidAt: string | null;
  /** Jagota REF_TOKEN / KBank reference_order — null until minted or after pay */
  chargeId: string | null;
  /** `YYYYMMDD#####` — send as `orderDocumentNo` on `POST /payment` to resume QR */
  documentNo: string | null;
  shipments: OrderDetailShipment[];
  shipmentCount: number;
  items: OrderDetailItem[];
  itemCount: number;
  imageUrls: string[];
  [key: string]: unknown;
};

export type AdminOrderUiStatus =
  | 'pending'
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'complete'
  | 'cancelled';

export const updateOrderStatus = async (
  ordersId: string,
  status: AdminOrderUiStatus,
): Promise<any> => {
  const response = await apiClient.patch(`/orders/${ordersId}/status`, {
    status,
  });
  return response;
};

export const createOrder = async (data: CreateOrderPayload): Promise<any> => {
  const response = await apiClient.post(`/orders`, data);
  return response.data;
};

/** Per-shipment-group delivery date/slot override — matched to a PreparedCheckout
 * shipmentGroups[].fulfillmentType. Groups without a matching entry fall back to
 * the top-level deliveryDate/timeSlotId. */
export type ShipmentDeliverySelection = {
  fulfillmentType: string;
  groupKey?: string;
  deliveryDate: string;
  timeSlotId: string;
};

export type CreateOrderBatchPayload = {
  chargeId?: string;
  /** ยอดที่ลูกค้าจ่าย — ชื่อเดียวกับ cart/checkout/order (docs/api-naming-glossary.md) */
  totalIncVat: number;
  cartId: string;
  paymentMethod: 'qr' | 'credit' | 'customer_credit' | 'cod' | 'payment_link';
  jagotaPaymentMethod?: 'credit_card' | 'customer_credit' | 'cash';
  /** @deprecated server ignores it — only `customer_credit` is paid at create; everything else waits for the gateway */
  paymentSuccess?: boolean;
  userId: string;
  branchId: string;
  deliveryAddress: string;
  shippingAddress?: string;
  timeSlotId?: string;
  deliveryDate?: string;
  shipmentDeliveries?: ShipmentDeliverySelection[];
  couponCode?: string;
  analyticsIndividualId?: string;
  analyticsSessionId?: string;
  analyticsPlatform?: 'web' | 'ios' | 'android';
  /** Customer's own Purchase Order reference — display/reporting only; not sent to ERP NARATION (future work). */
  poNumber?: string;
  remark?: string;
};

export type CreateOrderBatchResult = {
  status: string;
  message: string;
  batchId?: string;
  orderIds?: string[];
  orderNumbers?: string[];
  shipmentIds?: string[];
  shipmentNumbers?: string[];
  /** Numeric YYYYMMDD##### id of the order — send back as `orderDocumentNo` to mint QR */
  documentNo?: string | null;
  orderId?: string;
  orderNumber?: string;
  transactionId?: string;
  paymentPending: boolean;
  jagotaSyncIds?: string[];
  invoiceCount?: number;
};

export const createOrderBatch = async (
  data: CreateOrderBatchPayload,
): Promise<CreateOrderBatchResult> => {
  const response = await apiClient.post<CreateOrderBatchResult>(
    '/orders/batch',
    data,
  );
  return response.data;
};

export type CancelOrderReason =
  | 'change_product'
  | 'add_coupon'
  | 'payment_method_not_available'
  | 'change_shipping_address'
  | 'no_longer_needed';

export type CancelOrderResult = {
  status: boolean;
  statusCode: number;
  message: string;
  data: { orderId: string; status: 'cancelled' };
};

export type CancelOrderBatchResult = {
  status: boolean;
  statusCode: number;
  message: string;
  data: { batchId: string; orderIds: string[] };
};

/** ยกเลิกออเดอร์ที่ยังไม่จ่ายหนึ่งใบ (Order Detail — Cancel Order) */
export const cancelOrder = async (
  orderId: string,
  reason: CancelOrderReason,
): Promise<CancelOrderResult> => {
  const response = await apiClient.post<CancelOrderResult>(
    `/orders/${orderId}/cancel`,
    { reason },
  );
  return response.data;
};

/** ยกเลิกทุกออเดอร์ที่ยังไม่จ่ายในตะกร้าเดียวกัน (เช่นตอนกด "Change payment method") */
export const cancelOrderBatch = async (
  batchId: string,
  reason: CancelOrderReason,
): Promise<CancelOrderBatchResult> => {
  const response = await apiClient.post<CancelOrderBatchResult>(
    `/orders/batch/${batchId}/cancel`,
    { reason },
  );
  return response.data;
};

export type CreateOrderPayload = {
  chargeId?: string;
  /** ยอดที่ลูกค้าจ่าย — ชื่อเดียวกับ cart/checkout/order (docs/api-naming-glossary.md) */
  totalIncVat: number;
  cartId: string;
  paymentMethod: 'qr' | 'credit' | 'customer_credit' | 'cod' | 'payment_link';
  jagotaPaymentMethod?: 'credit_card' | 'customer_credit' | 'cash';
  /** @deprecated use jagotaPaymentMethod */
  margentoPaymentMethod?: 'credit_card' | 'customer_credit' | 'cash';
  /** @deprecated server ignores it — only `customer_credit` is paid at create; everything else waits for the gateway */
  paymentSuccess?: boolean;
  userId: string;
  branchId: string;
  deliveryAddress: string;
  subtotalExVat?: number;
  vatAmount?: number;
  timeSlotId?: string;
  deliveryDate?: string;
  shippingAddress?: string;
};

export type OrderAnalytics = {
  total_orders: number;
  pending_payment: number;
  paid: number;
  preparing: number;
  shipped: number;
  completed: number;
  cancelled: number;
  orders_today: number;
  revenue_today: number;
  total_revenue: number;
  pending_payment_amount: number;
};

export const getOrderAnalytics = async (): Promise<{
  status: boolean;
  data: OrderAnalytics;
}> => {
  const response = await apiClient.get('/orders/analytics');
  return response.data;
};

export type PaymentTransactionItem = {
  id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  gateway_charge_id: string | null;
  payment_method: string;
  amount: number;
  currency: string;
  status: 'pending' | 'success' | 'failed' | 'cancelled';
  gateway_provider: string;
  paid_at: string | null;
  created_at: string;
};

export type PaymentTransactionAnalytics = {
  total: number;
  pending: number;
  success: number;
  failed: number;
  cancelled: number;
  success_amount: number;
  pending_amount: number;
  today_count: number;
  today_success_amount: number;
};

export interface PaymentTransactionListParams {
  page?: number;
  limit?: number;
  status?: string;
  paymentMethod?: string;
  gatewayProvider?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  sortKey?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export const getPaymentTransactions = async (
  params: PaymentTransactionListParams = {},
): Promise<any> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams.set(key, String(value));
    }
  });
  const response = await apiClient.get(
    `/orders/payment-transactions?${searchParams.toString()}`,
  );
  return response;
};

export const getPaymentTransactionAnalytics = async (): Promise<{
  status: boolean;
  data: PaymentTransactionAnalytics;
}> => {
  const response = await apiClient.get('/orders/payment-transactions/analytics');
  return response.data;
};

/** @deprecated use createOrder */
export const cretedOrders = createOrder;

export const importOrdersCsv = async (
  ordersFile: File,
  itemsFile: File,
): Promise<any> => {
  const formData = new FormData();
  formData.append('orders', ordersFile);
  formData.append('items', itemsFile);
  const response = await apiClient.post('/orders/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response;
};

export const relinkAllOrderUsers = async (): Promise<any> => {
  const response = await apiClient.post('/orders/import/relink-all');
  return response;
};

export const relinkOrderUsersCsv = async (ordersFile: File): Promise<any> => {
  const formData = new FormData();
  formData.append('orders', ordersFile);
  const response = await apiClient.post('/orders/import/relink-users', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response;
};

export type ShipmentUiStatus =
  | 'to_ship'
  | 'shipping'
  | 'delivered'
  | 'cancelled';

export type MyShipmentListItem = {
  shipmentId: string;
  shipmentNumber: string;
  orderId: string;
  orderNumber: string | null;
  /** 1..n within the parent order — "Shipment 3", not list position */
  sequence: number;
  status: ShipmentUiStatus;
  statusDateLabel:
    | 'delivery_slot'
    | 'estimated_arrival'
    | 'delivered'
    | 'cancelled';
  /** ISO datetime when delivered/cancelled; shipping ISO from slot start; `YYYY-MM-DD` when to_ship */
  statusDate: string | null;
  /** `'08:00 - 10:00'` — null when the shipment has no time slot */
  statusTimeRange: string | null;
  shopName: string | null;
  branchName: string | null;
  deliveryDate: string | null;
  fulfillmentType: string | null;
  totalIncVat: number;
  itemCount: number;
  imageUrls: string[];
};

export type MyShipmentsParams = {
  page?: number;
  limit?: number;
  status?: ShipmentUiStatus;
  orderId?: string;
  /** Order create_date >= startDate (YYYY-MM-DD). Same meaning as GET /orders/my. */
  startDate?: string;
  /** Order create_date <= end of endDate (YYYY-MM-DD). Same meaning as GET /orders/my. */
  endDate?: string;
};

export type ShipmentDetailItem = {
  orderItemId: string;
  productName: string;
  quantity: number;
  quantityLabel: string;
  packLabel: string | null;
  unitPriceIncVat: number;
  unitPriceLabel: string;
  lineTotalIncVat: number;
  imageUrl: string | null;
};

export type ShipmentStatusStep = {
  key: 'preparing' | 'shipping' | 'delivered';
  label: string;
  state: 'done' | 'current' | 'upcoming';
};

export type ShipmentDetail = {
  shipmentId: string;
  shipmentNumber: string;
  orderId: string;
  orderNumber: string | null;
  sequence: number;
  shipmentCount: number;
  shipmentIndexLabel: string;
  status: ShipmentUiStatus | null;
  statusLabel: string | null;
  statusSteps: ShipmentStatusStep[];
  statusDateLabel:
    | 'delivery_slot'
    | 'estimated_arrival'
    | 'delivered'
    | 'cancelled'
    | null;
  statusDate: string | null;
  statusTimeRange: string | null;
  estimatedArrivalLabel: string | null;
  deliveryDate: string | null;
  fulfillmentType: string | null;
  branchName: string | null;
  recipientName: string | null;
  phone: string | null;
  deliveryAddress: string | null;
  deliveryNote: string | null;
  invoice: { invoiceId: string; downloadUrl: string | null } | null;
  weightAdjustment: {
    creditedAmountExVat: number | null;
    bannerText: string | null;
    /** null when no CB, or matched-weight banner (no Credit Back) */
    creditBackId: string | null;
  };
  tracking: {
    trackingStatus: 'tracking' | 'delivered' | 'pending' | 'error';
    reasonCode: 'driver_not_assigned' | null;
    location: { lat: number; lng: number } | null;
    locationUpdatedAt: string | null;
    courier: {
      name: string;
      phone: string;
      licensePlate: string;
    } | null;
    proofOfDelivery: {
      recipientName: string;
      signatureImageUrls: string[];
      photoUrls: string[];
      capturedAt: string;
    } | null;
  } | null;
  timing: {
    createdAt: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    cancelledAt: string | null;
    toShipSeconds: number | null;
    shippingSeconds: number | null;
    totalSeconds: number | null;
    toShipMinutes: number | null;
    shippingMinutes: number | null;
    totalMinutes: number | null;
  };
  subtotalExVat: number;
  vatAmount: number;
  subtotalIncVat: number;
  discountExVat: number;
  /** ส่วนลดที่ลูกค้าเห็นตอนกดใช้คูปอง (inc VAT) — ใช้โชว์, ใบกำกับภาษีใช้ `discountExVat` */
  discountIncVat: number;
  /** มูลค่าสินค้าก่อนหักส่วนลด (inc VAT) = `subtotalIncVat + discountIncVat` */
  grossIncVat: number;
  deliveryFee: number;
  totalIncVat: number;
  itemCount: number;
  imageUrls: string[];
  items: ShipmentDetailItem[];
};

export type ShipmentTiming = ShipmentDetail['timing'];

export type ShipmentAnalytics = {
  total: number;
  toShip: number;
  shipping: number;
  delivered: number;
  cancelled: number;
  unpaid: number;
  createdToday: number;
  avgToShipSeconds: number | null;
  avgShippingSeconds: number | null;
  avgTotalSeconds: number | null;
  avgToShipMinutes: number | null;
  avgShippingMinutes: number | null;
  avgTotalMinutes: number | null;
};

export const getMyShipments = async (
  params: MyShipmentsParams = {},
): Promise<{
  status: number;
  data:
    | {
        items: MyShipmentListItem[];
        page: number;
        limit: number;
        total: number;
      }
    | [];
  message: string;
}> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  const response = await apiClient.get(
    `/shipments/my${query ? `?${query}` : ''}`,
  );
  return response.data;
};

export const getCompanyShipments = async (
  params: MyShipmentsParams = {},
): Promise<{
  status: number;
  data:
    | {
        items: MyShipmentListItem[];
        page: number;
        limit: number;
        total: number;
      }
    | [];
  message: string;
}> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  const response = await apiClient.get(
    `/shipments/company${query ? `?${query}` : ''}`,
  );
  return response.data;
};

export const getShipmentById = async (
  shipmentId: string,
): Promise<{
  status: number;
  data: ShipmentDetail | [];
  message: string;
}> => {
  const response = await apiClient.get(`/shipments/${shipmentId}`);
  return response.data;
};

export type AdminOrderShipmentItem = Omit<
  MyShipmentListItem,
  | 'status'
  | 'sequence'
  | 'statusDateLabel'
  | 'statusDate'
  | 'statusTimeRange'
  | 'shopName'
  | 'branchName'
> & {
  status: ShipmentUiStatus | null;
  erpSyncStatus: string | null;
  rawStatus: string;
};

export type AdminShipmentListItem = AdminOrderShipmentItem & {
  customerName: string | null;
  courierName: string | null;
  timing: ShipmentTiming;
};

export type AdminShipmentsParams = {
  page?: number;
  limit?: number;
  status?: ShipmentUiStatus;
  search?: string;
  orderId?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  sortKey?:
    | 'createdAt'
    | 'deliveryDate'
    | 'totalIncVat'
    | 'shippedAt'
    | 'deliveredAt';
  sortOrder?: 'ASC' | 'DESC';
};

export const getAdminShipments = async (
  params: AdminShipmentsParams = {},
): Promise<{
  status: number;
  data: {
    items: AdminShipmentListItem[];
    page: number;
    limit: number;
    total: number;
  };
  message: string;
}> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  const response = await apiClient.get(
    `/shipments${query ? `?${query}` : ''}`,
  );
  return response.data;
};

export const getShipmentAnalytics = async (): Promise<{
  status: number;
  data: ShipmentAnalytics;
  message: string;
}> => {
  const response = await apiClient.get('/shipments/analytics');
  return response.data;
};

/** Duration label for admin — minutes are the primary unit. */
export const formatShipmentDuration = (
  seconds: number | null | undefined,
): string => {
  if (seconds == null || seconds < 0) return '-';
  if (seconds < 60) return uiText('<1 นาที');

  const totalMins = Math.floor(seconds / 60);
  if (totalMins < 60) return uiText('{0} นาที', { 0: totalMins });

  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(uiText('{0} วัน', { 0: days }));
  if (hours > 0) parts.push(uiText('{0} ชม.', { 0: hours }));
  if (mins > 0 || parts.length === 0) parts.push(uiText('{0} นาที', { 0: mins }));
  return parts.join(' ');
};

/** Same as formatShipmentDuration but input is already whole minutes. */
export const formatShipmentDurationMinutes = (
  minutes: number | null | undefined,
): string => {
  if (minutes == null || minutes < 0) return '-';
  if (minutes < 1) return uiText('<1 นาที');
  return formatShipmentDuration(minutes * 60);
};

export const getShipmentsByOrderId = async (
  orderId: string,
): Promise<{
  status: number;
  data: { items: AdminOrderShipmentItem[] };
  message: string;
}> => {
  const response = await apiClient.get(`/shipments/by-order/${orderId}`);
  return response.data;
};

export const sendShipmentToErp = async (
  shipmentId: string,
): Promise<{ status: number; data: unknown; message: string }> => {
  const response = await apiClient.post(`/shipments/${shipmentId}/send`);
  return response.data;
};

/** สถานะที่ admin ตั้งให้ shipment ได้ — ตรงกับ ADMIN_SETTABLE_SHIPMENT_STATUSES ฝั่ง backend */
export const ADMIN_SHIPMENT_STATUS_OPTIONS = [
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
] as const;

export type AdminShipmentStatusOption =
  (typeof ADMIN_SHIPMENT_STATUS_OPTIONS)[number];

export const updateShipmentStatus = async (
  shipmentId: string,
  status: AdminShipmentStatusOption,
): Promise<{
  status: number;
  data: AdminOrderShipmentItem;
  message: string;
}> => {
  const response = await apiClient.patch(`/shipments/${shipmentId}/status`, {
    status,
  });
  return response.data;
};
