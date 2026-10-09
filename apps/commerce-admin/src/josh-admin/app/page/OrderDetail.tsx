// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { TableViewport } from '@cp/ui';
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  ADMIN_SHIPMENT_STATUS_OPTIONS,
  createRefund,
  getOrderById,
  getOrderPaymentQr,
  getRefunds,
  getShipmentsByOrderId,
  sendShipmentToErp,
  updateOrderStatus,
  updateShipmentStatus,
  type AdminOrderShipmentItem,
  type AdminOrderUiStatus,
  type AdminShipmentStatusOption,
} from '@josh/shared-api';
import { Button, Input, Select, Table, TableColumn, Text } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ADMIN_ROUTES } from '../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { PageHeader, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type RefundRow = {
  id: string;
  order_id: string;
  amount: number;
  reason: string;
  status: string;
  created_at: string;
};

type RefundItemSelection = {
  selected: boolean;
  quantity: string;
  amount: string;
};

interface OrderItemRow {
  id: string;
  sku: string;
  product_name: string;
  product_quantity: number;
  product_price: number;
  line_total: number;
  status: string;
}

interface OrderDetailData {
  orders_id: string;
  order_id: string;
  customer_name: string;
  total_price: number;
  status: AdminOrderUiStatus;
  branch: string;
  delivery_slot: string;
  delivery_date: string | null;
  date: string;
  items: OrderItemRow[];
}

const ITEM_STATUS_LABELS: Record<string, string> = {
  get pending_pack(){return __uiText("รอแพ็ค");},
  get packed(){return __uiText("แพ็คแล้ว");},
  get shortage(){return __uiText("สินค้าขาด");},
  get completed(){return __uiText("เสร็จสิ้น");},
};

const ORDER_STATUS_LABELS: Record<AdminOrderUiStatus, string> = {
  get pending(){return __uiText("รอชำระเงิน");},
  get paid(){return __uiText("ชำระแล้ว");},
  get preparing(){return __uiText("กำลังเตรียม");},
  get shipped(){return __uiText("กำลังจัดส่ง");},
  get complete(){return __uiText("เสร็จสิ้น");},
  get cancelled(){return __uiText("ยกเลิก / คืนเงิน");},
};

const ORDER_STATUS_OPTIONS = [
  { value: 'pending', label: ORDER_STATUS_LABELS.pending },
  { value: 'paid', label: ORDER_STATUS_LABELS.paid },
  { value: 'preparing', label: ORDER_STATUS_LABELS.preparing },
  { value: 'shipped', label: ORDER_STATUS_LABELS.shipped },
  { value: 'complete', label: ORDER_STATUS_LABELS.complete },
  { value: 'cancelled', label: ORDER_STATUS_LABELS.cancelled },
];

/**
 * NestJS validation errors return `message` as a string[], not a string —
 * rendering that array straight into JSX/alert() concatenates it with no
 * separator. `err` itself can also be null/undefined, so every step here is
 * optional-chained.
 */
function extractShipmentErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string' && message.trim()) return message;
  return (err as { message?: string })?.message ?? fallback;
}

const OrderDetail = () => {
  __useUiLocale();
  const { ordersId } = useParams<{ ordersId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [statusDraft, setStatusDraft] = useState<OrderDetailData['status']>('pending');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [shipments, setShipments] = useState<AdminOrderShipmentItem[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(false);
  const [shipmentsError, setShipmentsError] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [refundItemSelections, setRefundItemSelections] = useState<
    Record<string, RefundItemSelection>
  >({});
  const [refundReason, setRefundReason] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);

  const loadShipments = useCallback(async (orderId: string) => {
    setShipmentsLoading(true);
    setShipmentsError('');
    try {
      const res = await getShipmentsByOrderId(orderId);
      setShipments(res.data.items ?? []);
    } catch (err: any) {
      setShipments([]);
      setShipmentsError(
        extractShipmentErrorMessage(err, 'โหลด shipment ไม่สำเร็จ'),
      );
    } finally {
      setShipmentsLoading(false);
    }
  }, []);

  const loadRefunds = useCallback(async (orderUuid: string) => {
    try {
      const res: any = await getRefunds();
      const all: RefundRow[] = res?.data?.data ?? [];
      setRefunds(all.filter((r) => r.order_id === orderUuid));
    } catch {
      setRefunds([]);
    }
  }, []);

  useEffect(() => {
    if (!ordersId) return;

    const loadOrder = async () => {
      setLoading(true);
      setError('');
      setSaveMessage('');
      try {
        const response: any = await getOrderById(ordersId);
        if (response?.status === 200 && response.data?.status === true) {
          const data = response.data.data as OrderDetailData;
          setOrder(data);
          setStatusDraft(data.status);
          setRefundItemSelections(
            Object.fromEntries(
              (data.items ?? []).map((item) => [
                item.id,
                {
                  selected: false,
                  quantity: String(item.product_quantity),
                  amount: String(item.line_total),
                },
              ]),
            ),
          );
          const oid = data.orders_id || ordersId;
          await Promise.all([loadShipments(oid), loadRefunds(oid)]);
        } else {
          setError(__uiMessage("ไม่พบข้อมูลออเดอร์"));
        }
      } catch (err: any) {
        setError(err?.response?.data?.message ?? err.message ?? __uiMessage("โหลดข้อมูลไม่สำเร็จ"));
      } finally {
        setLoading(false);
      }
    };

    void loadOrder();
  }, [ordersId, loadShipments, loadRefunds]);

  const handleSaveStatus = async () => {
    if (!ordersId || !order || statusDraft === order.status) return;

    setSaving(true);
    setSaveMessage('');
    setError('');
    try {
      const response: any = await updateOrderStatus(ordersId, statusDraft);
      if (response?.status === 200 && response.data?.status === true) {
        setOrder((prev) =>
          prev ? { ...prev, status: statusDraft } : prev,
        );
        setSaveMessage(__uiMessage("บันทึกสถานะสำเร็จ"));
      } else {
        setError(response?.data?.message ?? __uiMessage("บันทึกสถานะไม่สำเร็จ"));
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err.message ?? __uiMessage("บันทึกสถานะไม่สำเร็จ"));
    } finally {
      setSaving(false);
    }
  };

  const handleSendErp = async (shipmentId: string) => {
    if (!window.confirm(__uiText("ส่ง shipment นี้ไป ERP?"))) return;
    setSendingId(shipmentId);
    try {
      const res = await sendShipmentToErp(shipmentId);
      if (res?.message) {
        alert(res.message);
      }
      if (order) await loadShipments(order.orders_id || ordersId!);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? err.message ?? __uiText("ส่ง ERP ไม่สำเร็จ"));
    } finally {
      setSendingId(null);
    }
  };

  const handleShipmentStatus = async (
    shipmentId: string,
    status: AdminShipmentStatusOption,
  ) => {
    setStatusBusyId(shipmentId);
    try {
      const res = await updateShipmentStatus(shipmentId, status);
      const updated = res.data;
      setShipments((prev) =>
        prev.map((row) => (row.shipmentId === shipmentId ? updated : row)),
      );
    } catch (err: any) {
      alert(extractShipmentErrorMessage(err, 'บันทึกสถานะ shipment ไม่สำเร็จ'));
      // 409 = shipment ถูกเปลี่ยนเป็นสถานะ terminal ไปแล้วโดยที่ UI ยังไม่รู้ — โหลดใหม่ให้ตรงของจริง
      if (err?.response?.status === 409 && order) {
        await loadShipments(order.orders_id || ordersId!);
      }
    } finally {
      setStatusBusyId(null);
    }
  };

  const handleCreateRefund = async () => {
    if (!order) return;

    const items = Object.entries(refundItemSelections)
      .filter(([, sel]) => sel.selected)
      .map(([order_item_id, sel]) => ({
        order_item_id,
        quantity: Number(sel.quantity),
        amount: Number(sel.amount),
      }));

    if (items.length === 0 || !refundReason.trim()) {
      alert(__uiText("เลือกรายการสินค้าที่ต้องการคืนเงินอย่างน้อย 1 รายการ และกรอกเหตุผล"));
      return;
    }
    if (items.some((i) => !i.quantity || i.quantity <= 0 || !i.amount || i.amount <= 0)) {
      alert(__uiText("จำนวนและยอดเงินคืนของแต่ละรายการต้องมากกว่า 0"));
      return;
    }

    setRefundBusy(true);
    try {
      await createRefund({
        order_id: order.orders_id,
        reason: refundReason.trim(),
        items,
      });
      setRefundReason('');
      setRefundItemSelections((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([id, sel]) => [
            id,
            { ...sel, selected: false },
          ]),
        ),
      );
      await loadRefunds(order.orders_id);
    } catch (err: any) {
      alert(
        err?.response?.data?.message ??
          err.message ??
          __uiText("สร้างคำขอคืนเงินไม่สำเร็จ"),
      );
    } finally {
      setRefundBusy(false);
    }
  };

  const itemColumns: TableColumn<OrderItemRow>[] = [
    { key: 'sku', label: __uiText("SKU") },
    { key: 'product_name', label: __uiText("ชื่อสินค้า") },
    {
      key: 'product_quantity',
      label: __uiText("จำนวน"),
      render: (value) => <span className="font-mono">{value}</span>,
    },
    {
      key: 'product_price',
      label: __uiText("ราคา/หน่วย"),
      render: (value) => <span>{__uiText("฿")}{Number(value).toLocaleString()}</span>,
    },
    {
      key: 'line_total',
      label: __uiText("รวม"),
      render: (value) => (
        <span className="font-medium">{__uiText("฿")}{Number(value).toLocaleString()}</span>
      ),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: string) => (
        <span className="text-xs text-gray-600">
          {ITEM_STATUS_LABELS[value] ?? value}
        </span>
      ),
    },
  ];

  const shipmentColumns: TableColumn<AdminOrderShipmentItem>[] = [
    { key: 'shipmentNumber', label: __uiText("Shipment #") },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (_v, row) => {
        const settled =
          row.rawStatus === 'delivered' ||
          row.rawStatus === 'cancelled' ||
          row.rawStatus === 'refunded';

        // ใบที่จบแล้วแก้ไม่ได้ — backend ก็ปฏิเสธอยู่แล้ว ไม่ต้องหลอกให้กด
        if (settled) {
          return <span className="text-xs text-gray-500">{row.rawStatus}</span>;
        }

        return (
          <Select
            aria-label={__uiText("สถานะ shipment {0}", {"0": row.shipmentNumber})}
            value={row.rawStatus}
            disabled={statusBusyId === row.shipmentId}
            onChange={(e) =>
              void handleShipmentStatus(
                row.shipmentId,
                e.target.value as AdminShipmentStatusOption,
              )
            }
          >
            <option value={row.rawStatus} disabled>
              {row.rawStatus}
            </option>
            {ADMIN_SHIPMENT_STATUS_OPTIONS.filter(
              (option) => option !== row.rawStatus,
            ).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        );
      },
    },
    {
      key: 'deliveryDate',
      label: __uiText("วันจัดส่ง"),
      render: (v) => (v as string | null) ?? '—',
    },
    {
      key: 'fulfillmentType',
      label: __uiText("ประเภท"),
      render: (v) => (v as string | null) ?? '—',
    },
    {
      key: 'totalIncVat',
      label: __uiText("ยอด"),
      render: (v) => `฿${Number(v).toLocaleString()}`,
    },
    {
      key: 'erpSyncStatus',
      label: __uiText("ERP"),
      render: (v) => (v as string | null) ?? '—',
    },
    {
      key: 'shipmentId',
      label: '',
      render: (id, row) =>
        row.erpSyncStatus !== 'sent' ? (
          <button
            type="button"
            disabled={sendingId === id}
            className="rounded bg-primary px-2 py-1 text-xs text-white disabled:opacity-50"
            onClick={() => void handleSendErp(String(id))}
          >
            {sendingId === id ? '...' : __uiText("Send ERP")}
          </button>
        ) : (
          <span className="text-xs text-emerald-600">{__uiText("sent")}</span>
        ),
    },
  ];

  if (loading) {
    return (
      <div className="cp-management-page py-12 text-center text-gray-500 text-sm">{__uiText("กำลังโหลด...")}</div>
    );
  }

  if (error && !order) {
    return (
      <div className="cp-management-page flex flex-col gap-4">
        <Text text={error || __uiText("ไม่พบคำสั่งซื้อ")} size="base" />
        <Button text={__uiText("กลับรายการออเดอร์")} onClick={() => navigate(ADMIN_ROUTES.orders)} />
      </div>
    );
  }

  if (!order) {
    return null;
  }

  const statusChanged = statusDraft !== order.status;

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <PageHeader title={__uiText("Order {0}", {"0": order.order_id})} />
          <Text text={__uiText("ลูกค้า: {0}", {"0": order.customer_name})} size="sm" />
        </div>
        <Button text={__uiText("← กลับ")} onClick={() => navigate(ADMIN_ROUTES.orders)} />
      </div>

      <div className="bg-white border border-gray-200 rounded-md p-4 shadow-sm flex flex-col gap-4">
        <Text bold text={__uiText("สถานะออเดอร์")} size="lg" />
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="w-full sm:w-72">
            <Select
              label={__uiText("สถานะออเดอร์")}
              data={ORDER_STATUS_OPTIONS}
              value={statusDraft}
              onChange={(e) => {
                setStatusDraft(e.target.value as OrderDetailData['status']);
                setSaveMessage('');
              }}
            />
          </div>
          <Button
            text={saving ? __uiText("กำลังบันทึก...") : __uiText("บันทึกสถานะ")}
            onClick={() => {
              if (!statusChanged || saving) return;
              void handleSaveStatus();
            }}
          />
        </div>
        {saveMessage ? (
          <p className="text-sm text-emerald-600">{(typeof (saveMessage) === 'string' ? __uiText(saveMessage) : saveMessage)}</p>
        ) : null}
        {error ? <p className="text-sm text-red-600">{(typeof error === 'string' ? __uiText(error) : error)}</p> : null}
        <p className="text-xs text-gray-500">
          {__uiText("สถานะปัจจุบัน: ")}{ORDER_STATUS_LABELS[order.status]}
        </p>
        {order.status === 'pending' && (
          <div className="border-t border-gray-100 pt-4">
            <Button
              text={__uiText("สร้าง / ส่ง QR ชำระเงิน")}
              onClick={() => {
                if (!ordersId) return;
                void getOrderPaymentQr(ordersId).then((res: any) => {
                  setQrUrl(res?.data?.data?.qr_code_url ?? null);
                });
              }}
            />
            {qrUrl && (
              <div className="mt-3 flex flex-col items-start gap-2">
                <img src={qrUrl} alt={__uiText("Payment QR")} className="h-48 w-48 rounded border" />
                <a href={qrUrl} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                  {__uiText("เปิดลิงก์ QR")}</a>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-white border border-gray-200 rounded-md p-4 shadow-sm">
        <div>
          <p className="text-xs text-gray-500">{__uiText("ยอดรวม")}</p>
          <p className="font-semibold text-lg">
            {__uiText("฿")}{Number(order.total_price).toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{__uiText("วันที่สั่งซื้อ")}</p>
          <p className="font-medium">
            {order.date
              ? new Date(order.date).toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : '-'}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{__uiText("วันจัดส่ง")}</p>
          <p className="font-medium">{order.delivery_slot}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{__uiText("สาขา")}</p>
          <p className="font-medium">{order.branch}</p>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <Text bold text={__uiText("Shipments")} size="lg" />
          <button
            type="button"
            className="text-xs text-blue-600 hover:underline"
            onClick={() => void loadShipments(order.orders_id || ordersId!)}
          >
            {__uiText("รีเฟรช")}</button>
        </div>
        {shipmentsLoading ? (
          <p className="text-sm text-gray-500">{__uiText("กำลังโหลด shipments...")}</p>
        ) : shipmentsError ? (
          <p className="text-sm text-red-600">{(typeof (shipmentsError) === 'string' ? __uiText(shipmentsError) : shipmentsError)}</p>
        ) : shipments.length === 0 ? (
          <p className="text-sm text-gray-500">{__uiText("ยังไม่มี shipment")}</p>
        ) : (
          <Table
            columns={shipmentColumns}
            data={shipments}
            idKey="shipmentId"
            currentPage={1}
            totalPages={1}
            onPageChange={() => undefined}
            totalItems={shipments.length}
          />
        )}
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        <Text bold text={__uiText("Refunds")} size="lg" />
        <div className="mt-3">
          <p className="mb-2 text-xs text-gray-500">
            {__uiText("เลือกรายการสินค้าที่ต้องการคืนเงิน (แก้ไขจำนวน/ยอดเงินได้)")}</p>
          <TableViewport className="overflow-x-auto rounded-lg border border-gray-100">
            <table className="cp-data-table w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-2 py-2" scope="col" />
                  <th className="px-2 py-2" scope="col">{__uiText("SKU")}</th>
                  <th className="px-2 py-2" scope="col">{__uiText("สินค้า")}</th>
                  <th className="px-2 py-2" scope="col">{__uiText("จำนวนคืน")}</th>
                  <th className="px-2 py-2" scope="col">{__uiText("ยอดเงินคืน")}</th>
                </tr>
              </thead>
              <tbody>
                {(order?.items ?? []).map((item) => {
                  const sel = refundItemSelections[item.id] ?? {
                    selected: false,
                    quantity: String(item.product_quantity),
                    amount: String(item.line_total),
                  };
                  return (
                    <tr key={item.id} className="border-t border-gray-50">
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          aria-label={__uiText("เลือกคืนสินค้า {0}", {"0": item.product_name})}
                          checked={sel.selected}
                          onChange={(e) =>
                            setRefundItemSelections((prev) => ({
                              ...prev,
                              [item.id]: { ...sel, selected: e.target.checked },
                            }))
                          }
                        />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{item.sku}</td>
                      <td className="px-2 py-2">{item.product_name}</td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          aria-label={__uiText("จำนวนคืน {0}", {"0": item.product_name})}
                          value={sel.quantity}
                          onChange={(e) =>
                            setRefundItemSelections((prev) => ({
                              ...prev,
                              [item.id]: { ...sel, quantity: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          aria-label={__uiText("ยอดเงินคืน {0}", {"0": item.product_name})}
                          value={sel.amount}
                          onChange={(e) =>
                            setRefundItemSelections((prev) => ({
                              ...prev,
                              [item.id]: { ...sel, amount: e.target.value },
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableViewport>
          <div className="mt-3 grid max-w-xl gap-2 sm:grid-cols-2">
            <Input
              label={__uiText("เหตุผลการคืนเงิน *")}
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
            />
            <button
              type="button"
              disabled={refundBusy}
              className="self-end rounded-lg bg-primary px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={() => void handleCreateRefund()}
            >
              {refundBusy ? __uiText("กำลังบันทึก...") : __uiText("สร้างคำขอคืนเงิน")}
            </button>
          </div>
        </div>
        {refunds.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            {__uiText("ยังไม่มีคำขอคืนเงินสำหรับออเดอร์นี้")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-50 text-sm">
            {refunds.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 py-2">
                <span>
                  {__uiText("฿")}{Number(r.amount).toLocaleString()} — {r.reason}
                </span>
                <span className="text-xs text-gray-500">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <Text bold text={__uiText("รายการสินค้า (SKU)")} size="lg" />
        <div className="mt-3">
          <Table
            columns={itemColumns}
            data={order.items}
            idKey="id"
            currentPage={1}
            totalPages={1}
            onPageChange={() => undefined}
            totalItems={order.items.length}
          />
        </div>
      </div>
    </div>
  );
};

export default OrderDetail;

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
