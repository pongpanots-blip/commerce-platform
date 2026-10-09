// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { TableViewport } from '@cp/ui';
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { createRefund, getOrderById, getRefunds, updateRefund } from '@josh/shared-api';
import { Input, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
type RefundItemRow = {
  id: string;
  order_item_id: string;
  quantity_refunded: number;
  amount: number;
  orderItem?: { sku?: string; product_name?: string } | null;
};

type Row = {
  id: string;
  order_id: string;
  amount: number;
  reason: string;
  status: string;
  cs_note?: string | null;
  created_at: string;
  items?: RefundItemRow[];
};

const STATUS_OPTIONS = [
  { value: '', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'under_review', get label(){return __uiText("under_review");} },
  { value: 'pending_decision', get label(){return __uiText("pending_decision");} },
  { value: 'rejected', get label(){return __uiText("rejected");} },
  { value: 'refunded', get label(){return __uiText("refunded");} },
] as const;

type OrderItemForRefund = {
  id: string;
  sku: string;
  product_name: string;
  product_quantity: number;
  line_total: number;
};

type RefundStatus = 'under_review' | 'pending_decision' | 'rejected' | 'refunded';

type ItemSelection = { selected: boolean; quantity: string; amount: string };

export default function RefundsAdmin() {
  __useUiLocale();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [orderId, setOrderId] = useState('');
  const [reason, setReason] = useState('');
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [orderItems, setOrderItems] = useState<OrderItemForRefund[]>([]);
  const [itemSelections, setItemSelections] = useState<Record<string, ItemSelection>>({});
  const [itemsLoading, setItemsLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await getRefunds(statusFilter || undefined);
      setRows(res?.data?.data ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadOrderItems = async () => {
    if (!orderId.trim()) return;
    setItemsLoading(true);
    try {
      const res: any = await getOrderById(orderId.trim());
      const items: OrderItemForRefund[] =
        res?.data?.data?.items ?? res?.data?.items ?? [];
      setOrderItems(items);
      setItemSelections(
        Object.fromEntries(
          items.map((item) => [
            item.id,
            {
              selected: false,
              quantity: String(item.product_quantity),
              amount: String(item.line_total),
            },
          ]),
        ),
      );
    } catch (err: any) {
      alert(err?.response?.data?.message ?? err.message ?? __uiText("โหลดรายการสินค้าไม่สำเร็จ"));
      setOrderItems([]);
      setItemSelections({});
    } finally {
      setItemsLoading(false);
    }
  };

  const handleCreateRefund = async () => {
    const items = Object.entries(itemSelections)
      .filter(([, sel]) => sel.selected)
      .map(([order_item_id, sel]) => ({
        order_item_id,
        quantity: Number(sel.quantity),
        amount: Number(sel.amount),
      }));

    if (!orderId.trim() || items.length === 0 || !reason.trim()) {
      alert(__uiText("กรอก Order ID, เลือกรายการสินค้าอย่างน้อย 1 รายการ, และเหตุผล"));
      return;
    }
    if (
      items.some(
        (i) => !i.quantity || i.quantity <= 0 || !i.amount || i.amount <= 0,
      )
    ) {
      alert(__uiText("จำนวนและยอดเงินคืนของแต่ละรายการต้องมากกว่า 0"));
      return;
    }

    setCreating(true);
    try {
      await createRefund({ order_id: orderId.trim(), reason: reason.trim(), items });
      setOrderId('');
      setReason('');
      setOrderItems([]);
      setItemSelections({});
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message ?? err.message ?? __uiText("สร้างคำขอคืนเงินไม่สำเร็จ"));
    } finally {
      setCreating(false);
    }
  };

  const patchStatus = async (id: string, status: RefundStatus) => {
    try {
      await updateRefund(id, {
        status,
        cs_note: noteDraft[id]?.trim() || undefined,
      });
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message ?? err.message ?? __uiText("อัปเดตไม่สำเร็จ"));
    }
  };

  const columns: TableColumn<Row>[] = [
    {
      key: 'order_id',
      label: __uiText("Order"),
      render: (v) => (
        <Link
          to={ADMIN_ROUTES.orderDetail(String(v))}
          className="font-mono text-xs text-blue-600 hover:underline"
        >
          {String(v).slice(0, 8)}…
        </Link>
      ),
    },
    {
      key: 'amount',
      label: __uiText("จำนวน"),
      render: (v) => Number(v).toLocaleString(),
    },
    { key: 'reason', label: __uiText("เหตุผล") },
    { key: 'status', label: __uiText("สถานะ") },
    {
      key: 'items',
      label: __uiText("รายการสินค้า"),
      render: (v) => {
        const items = (v as RefundItemRow[] | undefined) ?? [];
        if (items.length === 0) return <span className="text-xs text-gray-400">—</span>;
        return (
          <ul className="space-y-0.5 text-xs text-gray-600">
            {items.map((item) => (
              <li key={item.id}>
                {item.orderItem?.sku ?? item.order_item_id.slice(0, 8)} × {item.quantity_refunded} —{' '}
                {__uiText("฿")}{Number(item.amount).toLocaleString()}
              </li>
            ))}
          </ul>
        );
      },
    },
    {
      key: 'cs_note',
      label: __uiText("CS note"),
      render: (v, row) =>
        row.status === 'under_review' || row.status === 'pending_decision' ? (
          <Input
            aria-label={__uiText("หมายเหตุ CS สำหรับคำขอคืนเงิน {0}", {"0": row.id})}
            value={noteDraft[row.id] ?? ''}
            onChange={(e) =>
              setNoteDraft((prev) => ({ ...prev, [row.id]: e.target.value }))
            }
            placeholder={__uiText("หมายเหตุ")}
          />
        ) : (
          <span className="text-xs text-gray-600">{(v as string) || '—'}</span>
        ),
    },
    {
      key: 'created_at',
      label: __uiText("สร้างเมื่อ"),
      render: (v) => new Date(String(v)).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')),
    },
    {
      key: 'id',
      label: __uiText("จัดการ"),
      render: (id, row) =>
        row.status === 'under_review' ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
              onClick={() => void patchStatus(String(id), 'pending_decision')}
            >
              {__uiText("Pending decision")}</button>
            <button
              type="button"
              className="rounded bg-red-600 px-2 py-1 text-xs text-white"
              onClick={() => void patchStatus(String(id), 'rejected')}
            >
              {__uiText("Reject")}</button>
          </div>
        ) : row.status === 'pending_decision' ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="rounded bg-sky-600 px-2 py-1 text-xs text-white"
              onClick={() => void patchStatus(String(id), 'refunded')}
            >
              {__uiText("Refunded")}</button>
            <button
              type="button"
              className="rounded bg-red-600 px-2 py-1 text-xs text-white"
              onClick={() => void patchStatus(String(id), 'rejected')}
            >
              {__uiText("Reject")}</button>
          </div>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="cp-management-page">
      <AdminListHeader
        title={__uiText("Returns & Refunds")}
        subtitle={__uiText("คำขอคืนเงิน / คืนสินค้า")}
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Select
            label={__uiText("สถานะ")}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="button"
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => void load()}
        >
          {__uiText("รีเฟรช")}</button>
      </div>

      <div className="mb-6 max-w-3xl rounded-lg border border-gray-100 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            label={__uiText("รหัสออเดอร์ (Order ID) *")}
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          />
          <button
            type="button"
            className="self-end rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
            disabled={itemsLoading || !orderId.trim()}
            onClick={() => void loadOrderItems()}
          >
            {itemsLoading ? __uiText("กำลังโหลด...") : __uiText("โหลดรายการสินค้า")}
          </button>
          <Input
            label={__uiText("เหตุผลการคืนเงิน *")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {orderItems.length > 0 && (
          <TableViewport className="mt-3 overflow-x-auto rounded-lg border border-gray-100">
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
                {orderItems.map((item) => {
                  const sel = itemSelections[item.id] ?? {
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
                            setItemSelections((prev) => ({
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
                            setItemSelections((prev) => ({
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
                            setItemSelections((prev) => ({
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
        )}

        <button
          type="button"
          disabled={creating}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          onClick={() => void handleCreateRefund()}
        >
          {creating ? __uiText("กำลังบันทึก...") : __uiText("สร้างคำขอคืนเงิน")}
        </button>
      </div>

      {loading ? (
        <p className="mb-2 text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : null}
      <Table columns={columns} data={rows} idKey="id" />
    </div>
  );
}
