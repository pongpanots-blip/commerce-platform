import { apiClient } from '../api-client/api-client';

/**
 * Client for the "ERP Webhook Simulator" admin page — calls
 * `apps/backend/src/app/erp/erp-webhook-simulator.controller.ts`, which
 * pretends to be ERP and runs the request through the real
 * `ErpWebhookService.handleOrderStatus`/`handleInvoiceStatus` (same
 * correlation, stock, Credit Back, and notification logic a real
 * `/api/erp/*` webhook would trigger).
 */

export interface ErpTestingProductLine {
  code: string;
  name: string;
  unit: string;
  orderedQty: number;
  rate: number;
  actualQty: number | null;
}

export interface ErpTestingCourier {
  name: string;
  phone: string;
  licensePlate: string;
}

export interface ErpTestingInvoiceRow {
  invoiceNumber: string;
  cancelled: boolean;
  delivered: boolean;
}

export interface ErpTestingCreditBackRow {
  cbNumber: string;
  invoiceNumber: string;
  cbStatus: string;
  totalAmountExVat: number;
  remainingAmountExVat: number;
}

export interface ErpTestingShipmentSnapshot {
  shipmentId: string;
  shipmentNumber: string;
  status: string;
  erpSyncStatus: string | null;
  orderId: string;
  orderNumber: string | null;
  orderStatus: string | null;
  courier: ErpTestingCourier | null;
  sync: {
    transactionType: string | null;
    docBook: string | null;
    docNo: string | null;
    orderTakingDocSeq: string | null;
  } | null;
  products: ErpTestingProductLine[];
  invoices: ErpTestingInvoiceRow[];
  creditBacks: ErpTestingCreditBackRow[];
}

export const getErpTestingShipment = async (
  shipmentId: string,
): Promise<ErpTestingShipmentSnapshot> => {
  const response = await apiClient.get(`/erp/testing/shipments/${shipmentId}`);
  return response.data;
};

export interface SimulateErpOrderStatusPayload {
  shipmentId: string;
  flag: 'confirmed' | 'cancelled';
  docBook?: string;
  docNo?: string;
}

export const simulateErpOrderStatus = async (
  payload: SimulateErpOrderStatusPayload,
): Promise<ErpTestingShipmentSnapshot> => {
  const response = await apiClient.post('/erp/testing/orders-status', payload);
  return response.data;
};

export interface ErpTestingInvoiceFlags {
  packed?: boolean;
  outForDelivery?: boolean;
  delivered?: boolean;
  deliveryFailed?: boolean;
  closedForVat?: boolean;
  invoiceCancelled?: boolean;
}

export interface SimulateErpInvoiceStatusPayload {
  shipmentId: string;
  invBook: string;
  invNo: string | number;
  docBook?: string;
  docNo?: string;
  products: Array<{ code: string; qty: number }>;
  flags: ErpTestingInvoiceFlags;
}

export const simulateErpInvoiceStatus = async (
  payload: SimulateErpInvoiceStatusPayload,
): Promise<ErpTestingShipmentSnapshot> => {
  const response = await apiClient.post('/erp/testing/invoices-status', payload);
  return response.data;
};

/**
 * Passthrough simulators — one per remaining /api/erp/* webhook. The backend
 * route takes the exact body ERP would send (same DTO + validation pipe as the
 * real endpoint) and runs the real service handler.
 */
export type ErpTestingPassthroughEndpoint =
  | 'quotations'
  | 'quotations-status'
  | 'products'
  | 'products-bulk'
  | 'products-image'
  | 'products-qty'
  | 'products-moq'
  | 'products-price'
  | 'customers'
  | 'companies'
  | 'order-periods';

export interface ErpTestingPassthroughResult {
  received: boolean;
  [key: string]: unknown;
}

export const simulateErpWebhook = async (
  endpoint: ErpTestingPassthroughEndpoint,
  payload: unknown,
): Promise<ErpTestingPassthroughResult> => {
  const response = await apiClient.post(`/erp/testing/${endpoint}`, payload);
  return response.data;
};

/**
 * Pretends to be a real `GET /drivers/tracking` result — the actual pipeline
 * that assigns a courier (ShipmentTrackingService/ShipmentService).
 * `invoice.status.changed` never carries driver data, so this is deliberately
 * a separate mock rather than a field on `simulateErpInvoiceStatus`.
 */
export interface SimulateErpCourierPayload {
  shipmentId: string;
  name: string;
  phone?: string;
  licensePlate?: string;
}

export const simulateErpCourier = async (
  payload: SimulateErpCourierPayload,
): Promise<ErpTestingShipmentSnapshot> => {
  const { shipmentId, ...body } = payload;
  const response = await apiClient.post(`/erp/testing/shipments/${shipmentId}/courier`, body);
  return response.data;
};

export type ErpTestingThreePlStatus =
  | 'PREPARING'
  | 'SHIPPING'
  | 'DELIVERED'
  | 'FAILED_DELIVERY'
  | 'RETURNED';

export interface SimulateErpDeliveryStatusPayload {
  shipmentId: string;
  status: ErpTestingThreePlStatus;
  name?: string;
  phone?: string;
  licensePlate?: string;
}

/**
 * Pretends to be `POST /api/3pl/delivery-status`. Courier is optional —
 * SHIPPING with no name leaves คนขับ ยังไม่มี and still moves shipment →
 * shipped / order → delivered.
 */
export const simulateErpDeliveryStatus = async (
  payload: SimulateErpDeliveryStatusPayload,
): Promise<ErpTestingShipmentSnapshot> => {
  const { shipmentId, status, name, phone, licensePlate } = payload;
  const response = await apiClient.post(
    `/erp/testing/shipments/${shipmentId}/delivery-status`,
    {
      status,
      courier: name?.trim()
        ? { name: name.trim(), phone: phone?.trim() ?? '', licensePlate: licensePlate?.trim() ?? '' }
        : null,
    },
  );
  return response.data;
};
