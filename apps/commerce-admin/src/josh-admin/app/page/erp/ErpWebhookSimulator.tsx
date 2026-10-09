// ui-metadata-migration: static labels and UI notices only
import { TableViewport } from '@cp/ui';
import {
  getErpTestingShipment,
  getOrders,
  getShipmentsByOrderId,
  simulateErpCourier,
  simulateErpDeliveryStatus,
  simulateErpInvoiceStatus,
  simulateErpOrderStatus,
  type AdminOrderShipmentItem,
  type ErpTestingInvoiceFlags,
  type ErpTestingShipmentSnapshot,
  type ErpTestingThreePlStatus,
} from '@josh/shared-api';
import { Button, Input } from '@josh/shared-ui-web';
import { useState } from 'react';
import { AdminListHeader } from '../../components/AdminListHeader';
import ErpWebhookPayloadConsole from './ErpWebhookPayloadConsole';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type OrderRow = {
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  orderStatus: string;
};

type DeliveryStage = 'none' | 'outForDelivery' | 'delivered' | 'deliveryFailed' | 'invoiceCancelled';
type SimulatorTab = 'order' | 'invoice' | '3pl' | 'courier';

const THREE_PL_STAGES: Array<{ key: ErpTestingThreePlStatus; label: string; note: string }> = [
  {
    key: 'PREPARING',
    label: 'PREPARING',
    note: 'shipment → preparing — ก้าวแรกของ 3PL ถ้ายังไม่มีสถานะ',
  },
  {
    key: 'SHIPPING',
    label: 'SHIPPING',
    note: 'shipment → shipped (order ยัง preparing) — คนขับเว้นว่างได้ (ยังไม่มี)',
  },
  {
    key: 'DELIVERED',
    label: 'DELIVERED',
    note: 'shipment → delivered — ต้องผ่าน SHIPPING มาก่อน',
  },
  {
    key: 'FAILED_DELIVERY',
    label: 'FAILED_DELIVERY',
    note: 'ไม่เปลี่ยนสถานะ Josh — 3PL บันทึกว่าส่งไม่สำเร็จ',
  },
  {
    key: 'RETURNED',
    label: 'RETURNED',
    note: 'shipment → cancelled',
  },
];

const DELIVERY_STAGES: Array<{ key: DeliveryStage; label: string; note: string; flags: ErpTestingInvoiceFlags }> = [
  {
    key: 'none',
    get label() { return __uiText("ออก invoice อย่างเดียว (ไม่มี flag)"); },
    note: 'สร้าง/อัปเดต invoice + Credit Back ถ้าส่งของขาด — ไม่เปลี่ยนสถานะ shipment',
    flags: {},
  },
  {
    key: 'outForDelivery',
    get label() { return __uiText("\"Out for Delivery\": \"Y\""); },
    note: 'shipment → shipped',
    flags: { outForDelivery: true },
  },
  {
    key: 'delivered',
    get label() { return __uiText("\"Delivered\": \"Y\""); },
    note: 'shipment → delivered (เมื่อ invoice ที่ไม่ถูกยกเลิกของ shipment นี้ delivered ครบทุกใบ) — ส่ง Out for Delivery = Y ไปด้วยเหมือน ERP จริง',
    flags: { outForDelivery: true, delivered: true },
  },
  {
    key: 'deliveryFailed',
    get label() { return __uiText("\"Delivery Failed\": \"Y\""); },
    note: 'backend log warning เท่านั้น ไม่เปลี่ยนสถานะ',
    flags: { deliveryFailed: true },
  },
  {
    key: 'invoiceCancelled',
    get label() { return __uiText("\"Invoice Cancelled\": \"Y\""); },
    note: 'ยกเลิก invoice + ยกเลิก Credit Back — ไม่แตะสถานะ shipment ดูผลได้ที่แถว Invoice/Credit Back ด้านล่าง',
    flags: { invoiceCancelled: true },
  },
];

// shipment/order status enum → Thai label + chip colour (Figma-ish, no token for this page specifically)
const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  payment_pending: { get label(){return __uiText("รอชำระเงิน");}, className: 'bg-gray-100 text-gray-700' },
  paid: { get label(){return __uiText("ชำระแล้ว รอ ERP ยืนยัน");}, className: 'bg-sky-100 text-sky-800' },
  preparing: { get label(){return __uiText("ERP ยืนยันแล้ว กำลังเตรียม");}, className: 'bg-violet-100 text-violet-800' },
  shipped: { get label(){return __uiText("ออกจัดส่งแล้ว");}, className: 'bg-amber-100 text-amber-800' },
  delivered: { get label(){return __uiText("ส่งถึงแล้ว");}, className: 'bg-emerald-100 text-emerald-800' },
  cancelled: { get label(){return __uiText("ยกเลิก");}, className: 'bg-red-100 text-red-700' },
  refunded: { get label(){return __uiText("คืนเงินแล้ว");}, className: 'bg-rose-100 text-rose-800' },
};

function invoiceStateLabel(inv: { cancelled: boolean; delivered: boolean }): string {
  if (inv.cancelled) return __uiText("ยกเลิกแล้ว");
  if (inv.delivered) return __uiText("ส่งถึงแล้ว");
  return __uiText("ใช้งาน");
}

function statusChip(status: string | null | undefined) {
  const entry = status ? STATUS_CHIP[status] : undefined;
  if (!entry) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
        -
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${entry.className}`}>
      {entry.label}
      <span className="font-mono text-[10px] opacity-70">· {status}</span>
    </span>
  );
}

export default function ErpWebhookSimulator() {
  __useUiLocale();
  const [mode, setMode] = useState<'shipment' | 'payload'>('shipment');
  const [searchInput, setSearchInput] = useState('');
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrderNumber, setSelectedOrderNumber] = useState<string | null>(null);

  const [shipments, setShipments] = useState<AdminOrderShipmentItem[]>([]);
  const [loadingShipments, setLoadingShipments] = useState(false);

  const [shipment, setShipment] = useState<ErpTestingShipmentSnapshot | null>(null);
  const [loadingShipment, setLoadingShipment] = useState(false);

  const [tab, setTab] = useState<SimulatorTab>('order');
  const [orderFlag, setOrderFlag] = useState<'confirmed' | 'cancelled'>('confirmed');
  const [docBook, setDocBook] = useState('');
  const [docNo, setDocNo] = useState('');

  const [invBook, setInvBook] = useState('');
  const [invNo, setInvNo] = useState('');
  const [invoicedQty, setInvoicedQty] = useState<Record<string, string>>({});
  const [deliveryStage, setDeliveryStage] = useState<DeliveryStage | null>(null);

  const [courierName, setCourierName] = useState('');
  const [courierPhone, setCourierPhone] = useState('');
  const [courierLicensePlate, setCourierLicensePlate] = useState('');
  const [threePlStatus, setThreePlStatus] = useState<ErpTestingThreePlStatus>('SHIPPING');

  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    endpoint: string;
    before: ErpTestingShipmentSnapshot;
    after: ErpTestingShipmentSnapshot;
  } | null>(null);

  const switchTab = (next: SimulatorTab) => {
    setTab(next);
    setSubmitAttempted(false);
    setError(null);
  };

  const searchOrders = async () => {
    setLoadingOrders(true);
    setError(null);
    try {
      const response = await getOrders({ search: searchInput.trim(), limit: 10 });
      const rows: OrderRow[] = response?.data?.data?.data ?? [];
      setOrders(rows);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? __uiMessage("ค้นหาไม่สำเร็จ"));
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  };

  const pickOrder = async (order: OrderRow) => {
    setSelectedOrderId(order.orderId);
    setSelectedOrderNumber(order.orderNumber);
    setShipment(null);
    setLastResult(null);
    setLoadingShipments(true);
    try {
      const { data } = await getShipmentsByOrderId(order.orderId);
      setShipments(data.items);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? __uiMessage("โหลด shipment ไม่สำเร็จ"));
      setShipments([]);
    } finally {
      setLoadingShipments(false);
    }
  };

  const pickShipment = async (shipmentId: string) => {
    setLoadingShipment(true);
    setError(null);
    setLastResult(null);
    setSubmitAttempted(false);
    try {
      const snapshot = await getErpTestingShipment(shipmentId);
      setShipment(snapshot);
      setDocBook(snapshot.sync?.docBook ?? '');
      setDocNo(snapshot.sync?.docNo ?? '');
      setInvBook('IN69');
      setInvNo('');
      setDeliveryStage(null);
      setCourierName('');
      setCourierPhone('');
      setCourierLicensePlate('');
      setThreePlStatus('SHIPPING');
      const qtyMap: Record<string, string> = {};
      snapshot.products.forEach((p) => {
        qtyMap[p.code] = String(p.orderedQty);
      });
      setInvoicedQty(qtyMap);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? __uiMessage("โหลด shipment ไม่สำเร็จ"));
      setShipment(null);
    } finally {
      setLoadingShipment(false);
    }
  };

  const qtyInvalid = (code: string) => {
    const raw = (invoicedQty[code] ?? '').trim();
    if (raw === '') return true;
    const n = Number(raw);
    return !Number.isFinite(n) || n < 0;
  };

  const applySnapshot = (after: ErpTestingShipmentSnapshot) => {
    setShipment(after);
    setShipments((prev) =>
      prev.map((s) =>
        s.shipmentId === after.shipmentId ? { ...s, rawStatus: after.status } : s,
      ),
    );
    setOrders((prev) =>
      prev.map((o) =>
        o.orderId === after.orderId
          ? { ...o, orderStatus: after.orderStatus ?? o.orderStatus }
          : o,
      ),
    );
  };

  const sendOrderStatus = async () => {
    if (!shipment) return;
    setSending(true);
    setError(null);
    const before = shipment;
    try {
      const after = await simulateErpOrderStatus({
        shipmentId: shipment.shipmentId,
        flag: orderFlag,
        docBook: docBook || undefined,
        docNo: docNo || undefined,
      });
      applySnapshot(after);
      setLastResult({ endpoint: 'POST /api/erp/orders/status', before, after });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? __uiMessage("ยิง webhook ไม่สำเร็จ"));
    } finally {
      setSending(false);
    }
  };

  const sendInvoiceStatus = async () => {
    if (!shipment) return;
    const hasQtyError = shipment.products.some((p) => qtyInvalid(p.code));
    const invalid = !invBook.trim() || !invNo.trim() || hasQtyError || deliveryStage === null;
    if (invalid) {
      setSubmitAttempted(true);
      setError(__uiMessage("กรอกข้อมูลที่มี * ให้ครบก่อนยิง"));
      return;
    }
    setSending(true);
    setError(null);
    const before = shipment;
    try {
      const after = await simulateErpInvoiceStatus({
        shipmentId: shipment.shipmentId,
        invBook: invBook.trim(),
        invNo: invNo.trim(),
        docBook: docBook || undefined,
        docNo: docNo || undefined,
        products: shipment.products.map((p) => ({
          code: p.code,
          qty: Number(invoicedQty[p.code] ?? p.orderedQty) || 0,
        })),
        flags: DELIVERY_STAGES.find((s) => s.key === deliveryStage)!.flags,
      });
      applySnapshot(after);
      setLastResult({ endpoint: 'POST /api/erp/invoices/status', before, after });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? __uiMessage("ยิง webhook ไม่สำเร็จ"));
    } finally {
      setSending(false);
    }
  };

  const sendCourier = async () => {
    if (!shipment) return;
    if (!courierName.trim()) {
      setSubmitAttempted(true);
      setError(__uiMessage("กรอกชื่อคนขับก่อน"));
      return;
    }
    setSending(true);
    setError(null);
    const before = shipment;
    try {
      const after = await simulateErpCourier({
        shipmentId: shipment.shipmentId,
        name: courierName.trim(),
        phone: courierPhone.trim() || undefined,
        licensePlate: courierLicensePlate.trim() || undefined,
      });
      applySnapshot(after);
      setLastResult({ endpoint: 'POST /api/erp/testing/shipments/:id/courier', before, after });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? __uiMessage("ยิง mock ไม่สำเร็จ"));
    } finally {
      setSending(false);
    }
  };

  const sendDeliveryStatus = async () => {
    if (!shipment) return;
    setSending(true);
    setError(null);
    const before = shipment;
    try {
      const after = await simulateErpDeliveryStatus({
        shipmentId: shipment.shipmentId,
        status: threePlStatus,
        name: courierName.trim() || undefined,
        phone: courierPhone.trim() || undefined,
        licensePlate: courierLicensePlate.trim() || undefined,
      });
      applySnapshot(after);
      setLastResult({
        endpoint: 'POST /api/erp/testing/shipments/:id/delivery-status',
        before,
        after,
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? __uiMessage("ยิง mock ไม่สำเร็จ"));
    } finally {
      setSending(false);
    }
  };

  const creditPreview = shipment
    ? shipment.products.reduce((sum, p) => {
        const invoiced = Number(invoicedQty[p.code] ?? p.orderedQty) || 0;
        const shortBy = Math.max(0, p.orderedQty - invoiced);
        return sum + shortBy * p.rate;
      }, 0)
    : 0;

  const invBookError = submitAttempted && !invBook.trim() ? 'กรอก INV_BOOK' : undefined;
  const invNoError = submitAttempted && !invNo.trim() ? 'กรอก INV_NO' : undefined;
  const deliveryStageError = submitAttempted && deliveryStage === null;
  const courierNameError = submitAttempted && !courierName.trim() ? 'กรอกชื่อคนขับก่อน' : undefined;

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <AdminListHeader
        title={__uiText("ERP Webhook Simulator")}
        subtitle={__uiText("ยิง webhook ERP → Josh จำลอง เข้า service handler ตัวจริง (validation + logic เดียวกับ /api/erp/*) — ไม่ต้องรอ ERP sandbox")}
      />

      <div className="flex w-fit gap-1 rounded-lg bg-gray-100 p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode('shipment')}
          className={`rounded-md px-4 py-1.5 font-medium ${mode === 'shipment' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
        >
          {__uiText("Order / Invoice status")}<span className="ml-1.5 text-[11px] font-normal text-gray-400">{__uiText("จาก shipment จริง")}</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('payload')}
          className={`rounded-md px-4 py-1.5 font-medium ${mode === 'payload' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
        >
          {__uiText("Webhook อื่น ๆ")}<span className="ml-1.5 text-[11px] font-normal text-gray-400">{__uiText("quotation · catalog · stock · customer")}</span>
        </button>
      </div>

      {mode === 'payload' && <ErpWebhookPayloadConsole />}

      {mode === 'shipment' && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {(typeof error === 'string' ? __uiText(error) : error)}
        </div>
      )}

      {mode === 'shipment' && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
        {/* LEFT: order -> shipment picker */}
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">{__uiText("หา order")}</h3>
            <div className="flex gap-2">
              <Input
                placeholder={__uiText("เลขที่ order เช่น JOSH-2026-04417")}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchOrders()}
                className="flex-1"
              />
              <Button text={loadingOrders ? '...' : __uiText("ค้นหา")} onClick={searchOrders} disabled={loadingOrders} />
            </div>

            {orders.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5">
                {orders.map((o) => (
                  <button
                    key={o.orderId}
                    type="button"
                    onClick={() => pickOrder(o)}
                    className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left text-sm hover:border-gray-400 ${
                      selectedOrderId === o.orderId ? 'border-primary bg-primary-soft' : 'border-gray-200'
                    }`}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">{o.orderNumber ?? o.orderId}</span>
                      {statusChip(o.orderStatus)}
                    </span>
                    <span className="text-xs text-gray-500">{o.customerName ?? '-'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedOrderId && (
            <div className="rounded-lg border bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">
                {__uiText("Shipment ใน ")}{selectedOrderNumber ?? selectedOrderId}
              </h3>
              {loadingShipments ? (
                <p className="text-sm text-gray-400">{__uiText("กำลังโหลด...")}</p>
              ) : shipments.length === 0 ? (
                <p className="text-sm text-gray-400">{__uiText("ไม่มี shipment")}</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {shipments.map((s) => (
                    <button
                      key={s.shipmentId}
                      type="button"
                      onClick={() => pickShipment(s.shipmentId)}
                      className={`flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:border-gray-400 ${
                        shipment?.shipmentId === s.shipmentId ? 'border-primary bg-primary-soft' : 'border-gray-200'
                      }`}
                    >
                      <span className="font-mono text-xs font-semibold">{s.shipmentNumber}</span>
                      {statusChip(s.rawStatus)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {shipment && (
            <div className="rounded-lg border bg-white p-4 text-sm">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">{__uiText("สถานะปัจจุบัน")}</h3>
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between"><span className="text-gray-500">{__uiText("Shipment")}</span><span className="font-mono">{shipment.shipmentNumber}</span></div>
                <div className="flex flex-wrap items-start justify-between gap-2"><span className="text-gray-500">{__uiText("Shipment status")}</span>{statusChip(shipment.status)}</div>
                <div className="flex flex-wrap items-start justify-between gap-2"><span className="text-gray-500">{__uiText("Order status")}</span>{statusChip(shipment.orderStatus)}</div>
                <div className="flex justify-between"><span className="text-gray-500">{__uiText("erp_sync_status")}</span><span>{shipment.erpSyncStatus ?? '-'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">{__uiText("jagota_order_sync")}</span><span>{shipment.sync ? __uiText("มี") : <span className="text-amber-600">{__uiText("ไม่มี (correlate ไม่เจอ)")}</span>}</span></div>
                <div className="flex justify-between">
                  <span className="text-gray-500">{__uiText("คนขับ (courier)")}</span>
                  <span>
                    {shipment.courier ? (
                      <span className="font-mono">{shipment.courier.name} · {shipment.courier.phone || '-'} · {shipment.courier.licensePlate || '-'}</span>
                    ) : (
                      <span className="text-amber-600">{__uiText("ยังไม่มี")}</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: webhook builder */}
        <div className="rounded-lg border bg-white p-4">
          {!shipment ? (
            <p className="py-12 text-center text-sm text-gray-400">{__uiText("เลือก order แล้วเลือก shipment ก่อน")}</p>
          ) : (
            <>
              <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
                <button
                  type="button"
                  onClick={() => switchTab('order')}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === 'order' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                >
                  {__uiText("Order status ")}<span className="ml-1 font-mono text-[11px] text-gray-400">{__uiText("order.status.changed")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchTab('invoice')}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === 'invoice' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                >
                  {__uiText("Invoice status ")}<span className="ml-1 font-mono text-[11px] text-gray-400">{__uiText("invoice.status.changed")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchTab('3pl')}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === '3pl' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                >
                  {__uiText("3PL delivery ")}<span className="ml-1 font-mono text-[11px] text-gray-400">{__uiText("POST /3pl/delivery-status")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchTab('courier')}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === 'courier' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                >
                  {__uiText("Courier ")}<span className="ml-1 font-mono text-[11px] text-gray-400">{__uiText("GET /drivers/tracking")}</span>
                </button>
              </div>

              {tab === 'order' ? (
                <div className="flex flex-col gap-4">
                  <fieldset className="rounded-lg border p-3">
                    <legend className="px-1 text-xs font-semibold uppercase text-gray-500">{__uiText("orderStatus flags")}</legend>
                    <label className="flex items-start gap-2 rounded-md p-2 hover:bg-gray-50">
                      <input type="radio" checked={orderFlag === 'confirmed'} onChange={() => setOrderFlag('confirmed')} className="mt-1" />
                      <span>
                        <strong className="block font-mono text-sm">{__uiText("\"Order Confirmed\": \"Y\"")}</strong>
                        <span className="text-xs text-gray-500">{__uiText("shipment ไป preparing (จาก paid/payment_pending), จอง stock")}</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 rounded-md p-2 hover:bg-gray-50">
                      <input type="radio" checked={orderFlag === 'cancelled'} onChange={() => setOrderFlag('cancelled')} className="mt-1" />
                      <span>
                        <strong className="block font-mono text-sm">{__uiText("\"Order Cancelled\": \"Y\"")}</strong>
                        <span className="text-xs text-gray-500">{__uiText("shipment ไป cancelled, คืน stock")}</span>
                      </span>
                    </label>
                  </fieldset>

                  <div className="grid grid-cols-2 gap-3">
                    <Input label={__uiText("DOC_BOOK")} value={docBook} onChange={(e) => setDocBook(e.target.value)} hint={__uiText("ว่างได้ — backend ใช้ค่าจาก jagota_order_sync")} />
                    <Input label={__uiText("DOC_NO")} value={docNo} onChange={(e) => setDocNo(e.target.value)} hint={__uiText("ว่างได้ — backend ใช้ค่าจาก jagota_order_sync")} />
                  </div>

                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="font-mono text-xs text-gray-500">{__uiText("POST /api/erp/orders/status")}</span>
                    <Button text={sending ? __uiText("กำลังยิง...") : __uiText("Send mock webhook →")} onClick={sendOrderStatus} disabled={sending} />
                  </div>
                </div>
              ) : tab === 'invoice' ? (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Input label={__uiText("INV_BOOK")} value={invBook} onChange={(e) => setInvBook(e.target.value)} required error={invBookError} />
                    <Input label={__uiText("INV_NO")} value={invNo} onChange={(e) => setInvNo(e.target.value)} required error={invNoError} />
                    <Input label={__uiText("DOC_BOOK")} value={docBook} onChange={(e) => setDocBook(e.target.value)} hint={__uiText("ว่างได้ — backend ใช้ค่าจาก jagota_order_sync")} />
                    <Input label={__uiText("DOC_NO")} value={docNo} onChange={(e) => setDocNo(e.target.value)} hint={__uiText("ว่างได้ — backend ใช้ค่าจาก jagota_order_sync")} />
                  </div>

                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">
                      {__uiText("SKU บน shipment นี้ — ตั้งจำนวนที่ ERP invoice จริง")}</h4>
                    <div className="overflow-hidden rounded-lg border">
                      <TableViewport><table className="cp-data-table w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs text-gray-500">
                          <tr>
                            <th className="px-3 py-2 font-medium" scope="col">{__uiText("Product")}</th>
                            <th className="px-3 py-2 text-right font-medium" scope="col">{__uiText("สั่ง")}</th>
                            <th className="px-3 py-2 text-right font-medium" scope="col">{__uiText("ราคา (ex VAT)")}</th>
                            <th className="px-3 py-2 text-right font-medium" scope="col">
                              {__uiText("Invoice qty")}<span className="text-alert"> *</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {shipment.products.map((p) => {
                            const invoiced = Number(invoicedQty[p.code] ?? p.orderedQty) || 0;
                            const short = invoiced < p.orderedQty;
                            const invalid = submitAttempted && qtyInvalid(p.code);
                            return (
                              <tr key={p.code} className="border-t">
                                <td className="px-3 py-2">
                                  <div className="font-mono text-xs font-semibold">{p.code}</div>
                                  <div className="text-xs text-gray-500">{p.name}</div>
                                </td>
                                <td className="px-3 py-2 text-right font-mono">{p.orderedQty} {p.unit}</td>
                                <td className="px-3 py-2 text-right font-mono">{__uiText("฿")}{p.rate.toLocaleString()}</td>
                                <td className="px-3 py-2 text-right">
                                  <input
                                    type="number"
                                    aria-label={__uiText("Invoice qty {0}", {"0": p.code})}
                                    min={0}
                                    step="0.01"
                                    value={invoicedQty[p.code] ?? ''}
                                    onChange={(e) =>
                                      setInvoicedQty((prev) => ({ ...prev, [p.code]: e.target.value }))
                                    }
                                    className={`w-20 rounded border px-2 py-1 text-right font-mono text-sm ${
                                      invalid
                                        ? 'border-alert'
                                        : short
                                        ? 'border-amber-400 text-amber-700'
                                        : 'border-gray-300'
                                    }`}
                                  />
                                  {invalid && <p className="mt-1 text-xs text-alert">{__uiText("กรอกจำนวน ≥ 0")}</p>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table></TableViewport>
                    </div>
                    {creditPreview > 0 && (
                      <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                        {__uiText("คาดว่าจะเกิด Credit Back ≈ ฿")}{creditPreview.toLocaleString(undefined, { minimumFractionDigits: 2 })} {__uiText(" (ex VAT) — คำนวณจริงฝั่ง backend")}</p>
                    )}
                  </div>

                  <fieldset className={`rounded-lg border p-3 ${deliveryStageError ? 'border-alert' : ''}`}>
                    <legend className="px-1 text-xs font-semibold uppercase text-gray-500">
                      {__uiText("สถานะจัดส่ง (invoice.delivery)")}<span className="text-alert"> *</span>
                    </legend>
                    {DELIVERY_STAGES.map((s) => (
                      <label key={s.key} className="flex items-start gap-2 rounded-md p-2 hover:bg-gray-50">
                        <input
                          type="radio"
                          name="delivery-stage"
                          checked={deliveryStage === s.key}
                          onChange={() => setDeliveryStage(s.key)}
                          className="mt-1"
                        />
                        <span>
                          <strong className="block font-mono text-sm">{s.label}</strong>
                          <span className="text-xs text-gray-500">{s.note}</span>
                        </span>
                      </label>
                    ))}
                    {/* ponytail: Packed / Closed for VAT dropped from the UI — handleInvoiceStatus never reads
                        those two flags, so offering them as options would just be dead UI with no observable effect */}
                    <p className="px-2 pt-1 text-xs italic text-gray-400">
                      {__uiText("Packed / Closed for VAT ไม่มีในตัวเลือก — handleInvoiceStatus ไม่อ่าน flag พวกนี้")}</p>
                    {deliveryStageError && (
                      <p className="px-2 pt-1 text-xs text-alert">{__uiText("เลือกสถานะจัดส่ง 1 อัน")}</p>
                    )}
                  </fieldset>

                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="font-mono text-xs text-gray-500">{__uiText("POST /api/erp/invoices/status")}</span>
                    <Button text={sending ? __uiText("กำลังยิง...") : __uiText("Send mock webhook →")} onClick={sendInvoiceStatus} disabled={sending} />
                  </div>
                </div>
              ) : tab === '3pl' ? (
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-gray-500">
                    {__uiText("จำลอง ")}<code className="font-mono">{__uiText("POST /api/3pl/delivery-status")}</code> {__uiText(" — คนละเส้นกับ invoice. กด ")}<span className="font-mono">{__uiText("SHIPPING")}</span> {__uiText(" โดยไม่กรอกคนขับ จะได้สถานะปัจจุบันแบบ shipment shipped · order preparing · คนขับยังไม่มี (ถ้ายังไม่มี 3PL status จะยิง PREPARING ให้ก่อน). order เป็น delivered เมื่อทุก shipment ส่งถึง; Credit Back ออกจาก tab invoice (ไม่ต้องรอส่งถึง)")}</p>
                  <fieldset className="rounded-lg border p-3">
                    <legend className="px-1 text-xs font-semibold uppercase text-gray-500">{__uiText("3PL status")}</legend>
                    {THREE_PL_STAGES.map((s) => (
                      <label key={s.key} className="flex items-start gap-2 rounded-md p-2 hover:bg-gray-50">
                        <input
                          type="radio"
                          name="three-pl-status"
                          checked={threePlStatus === s.key}
                          onChange={() => setThreePlStatus(s.key)}
                          className="mt-1"
                        />
                        <span>
                          <strong className="block font-mono text-sm">{s.label}</strong>
                          <span className="text-xs text-gray-500">{s.note}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label={__uiText("คนขับ")}
                      value={courierName}
                      onChange={(e) => setCourierName(e.target.value)}
                      className="col-span-2"
                      hint={__uiText("ว่างได้ — SHIPPING โดยไม่มีคนขับจะโชว์ ยังไม่มี")}
                    />
                    <Input label={__uiText("เบอร์คนขับ")} value={courierPhone} onChange={(e) => setCourierPhone(e.target.value)} />
                    <Input label={__uiText("ทะเบียนรถ")} value={courierLicensePlate} onChange={(e) => setCourierLicensePlate(e.target.value)} />
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="font-mono text-xs text-gray-500">{__uiText("POST /api/erp/testing/shipments/:id/delivery-status")}</span>
                    <Button text={sending ? __uiText("กำลังยิง...") : __uiText("Send mock webhook →")} onClick={sendDeliveryStatus} disabled={sending} />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-gray-500">
                    {__uiText("จำลองผล ")}<code className="font-mono">{__uiText("GET /drivers/tracking")}</code> {__uiText(" ตัวจริง — คนขับ/route ไม่ได้มาจาก invoice.status.changed แยก mock ไว้เพราะเป็นคนละ endpoint กัน ยิงแล้วจะ persist ลง")}<code className="mx-1 font-mono">{__uiText("shipment.courier_*")}</code> {__uiText(" เหมือน flow จริง")}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label={__uiText("คนขับ")}
                      value={courierName}
                      onChange={(e) => setCourierName(e.target.value)}
                      className="col-span-2"
                      required
                      error={courierNameError}
                    />
                    <Input label={__uiText("เบอร์คนขับ")} value={courierPhone} onChange={(e) => setCourierPhone(e.target.value)} />
                    <Input label={__uiText("ทะเบียนรถ")} value={courierLicensePlate} onChange={(e) => setCourierLicensePlate(e.target.value)} />
                  </div>

                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="font-mono text-xs text-gray-500">{__uiText("POST /api/erp/testing/shipments/:id/courier")}</span>
                    <Button text={sending ? __uiText("กำลังยิง...") : __uiText("Send mock webhook →")} onClick={sendCourier} disabled={sending} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}

      {mode === 'shipment' && lastResult && (
        <div className="rounded-lg border bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">{__uiText("ผลล่าสุด — ")}{lastResult.endpoint}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3 text-sm">
              <div className="mb-1 text-xs font-semibold uppercase text-gray-400">{__uiText("ก่อนยิง")}</div>
              <div className="flex flex-wrap items-start justify-between gap-2"><span className="text-gray-500">{__uiText("Shipment")}</span>{statusChip(lastResult.before.status)}</div>
              <div className="flex flex-wrap items-start justify-between gap-2"><span className="text-gray-500">{__uiText("Order")}</span>{statusChip(lastResult.before.orderStatus)}</div>
              <div className="flex justify-between"><span className="text-gray-500">{__uiText("คนขับ")}</span><span className="font-mono">{lastResult.before.courier?.name ?? '-'}</span></div>
              <div className="mt-2 border-t pt-2 text-gray-500">{__uiText("Invoice")}</div>
              {lastResult.before.invoices.length === 0 ? (
                <div className="font-mono">-</div>
              ) : (
                lastResult.before.invoices.map((inv) => (
                  <div key={inv.invoiceNumber} className="flex justify-between">
                    <span className="font-mono">{inv.invoiceNumber}</span>
                    <span className="text-gray-500">{invoiceStateLabel(inv)}</span>
                  </div>
                ))
              )}
              <div className="mt-2 border-t pt-2 text-gray-500">{__uiText("Credit Back")}</div>
              {lastResult.before.creditBacks.length === 0 ? (
                <div className="font-mono">-</div>
              ) : (
                lastResult.before.creditBacks.map((cb) => (
                  <div key={cb.cbNumber} className="flex justify-between">
                    <span className="font-mono">{cb.cbNumber} · {cb.cbStatus}</span>
                    <span className="font-mono">{cb.remainingAmountExVat}/{cb.totalAmountExVat}</span>
                  </div>
                ))
              )}
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="mb-1 text-xs font-semibold uppercase text-gray-400">{__uiText("หลังยิง")}</div>
              <div className="flex flex-wrap items-start justify-between gap-2"><span className="text-gray-500">{__uiText("Shipment")}</span>{statusChip(lastResult.after.status)}</div>
              <div className="flex flex-wrap items-start justify-between gap-2"><span className="text-gray-500">{__uiText("Order")}</span>{statusChip(lastResult.after.orderStatus)}</div>
              <div className="flex justify-between"><span className="text-gray-500">{__uiText("คนขับ")}</span><span className="font-mono">{lastResult.after.courier?.name ?? '-'}</span></div>
              <div className="mt-2 border-t pt-2 text-gray-500">{__uiText("Invoice")}</div>
              {lastResult.after.invoices.length === 0 ? (
                <div className="font-mono">-</div>
              ) : (
                lastResult.after.invoices.map((inv) => (
                  <div key={inv.invoiceNumber} className="flex justify-between">
                    <span className="font-mono">{inv.invoiceNumber}</span>
                    <span className="text-gray-500">{invoiceStateLabel(inv)}</span>
                  </div>
                ))
              )}
              <div className="mt-2 border-t pt-2 text-gray-500">{__uiText("Credit Back")}</div>
              {lastResult.after.creditBacks.length === 0 ? (
                <div className="font-mono">-</div>
              ) : (
                lastResult.after.creditBacks.map((cb) => (
                  <div key={cb.cbNumber} className="flex justify-between">
                    <span className="font-mono">{cb.cbNumber} · {cb.cbStatus}</span>
                    <span className="font-mono">{cb.remainingAmountExVat}/{cb.totalAmountExVat}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
