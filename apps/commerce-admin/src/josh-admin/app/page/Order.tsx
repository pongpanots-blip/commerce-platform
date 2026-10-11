// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { getOrderAnalytics, getOrders, type AdminOrderUiStatus, type OrderAnalytics } from '@josh/shared-api';
import { Button, CardAdmin, DateRangeInput, Select, Table, TableColumn, TableViewBar, useTableViews } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AiOutlineEdit, AiOutlineEye, AiOutlineFilter } from 'react-icons/ai';
import { ADMIN_ROUTES } from '../config/admin-routes';
import { roleCanWrite } from '../../../app/role-can';

// ui-copy-migration: only literal UI copy and notification templates
import { ButtonLink, Chip, PageHeader, type Tone, downloadCsv, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const PAGE_SIZE = 20;
const EXPORT_PAGE_SIZE = 100;
// ponytail: client-side paging over the list API; ask josh for a server export if 5000 rows is not enough.
const EXPORT_MAX_ROWS = 5000;

const ORDER_STATUS_LABELS: Record<AdminOrderUiStatus, string> = {
  get pending(){return __uiText("รอชำระเงิน");},
  get paid(){return __uiText("ชำระแล้ว");},
  get preparing(){return __uiText("กำลังเตรียม");},
  get shipped(){return __uiText("กำลังจัดส่ง");},
  get complete(){return __uiText("เสร็จสิ้น");},
  get cancelled(){return __uiText("ยกเลิก / คืนเงิน");},
};

const ORDER_STATUS_TONES: Record<AdminOrderUiStatus, Tone> = {
  pending: 'warn',
  paid: 'ok',
  preparing: 'info',
  shipped: 'info',
  complete: 'ok',
  cancelled: 'muted',
};

interface OrderData {
  orders_id: string;
  order_id: string;
  customer_name: string;
  total_price: number;
  status: AdminOrderUiStatus;
  branch: string;
  delivery_slot: string;
  date: string;
}

const Order = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState<OrderAnalytics | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortKey, setSortKey] = useState('date');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const orderStatusOptions = [
    { value: 'all', label: __uiText("คำสั่งซื้อทั้งหมด") },
    { value: 'pending', label: __uiText("รอชำระเงิน") },
    { value: 'paid', label: __uiText("ชำระแล้ว") },
    { value: 'preparing', label: __uiText("กำลังเตรียม") },
    { value: 'shipped', label: __uiText("กำลังจัดส่ง") },
    { value: 'complete', label: __uiText("เสร็จสิ้น") },
    { value: 'cancelled', label: __uiText("ยกเลิก / คืนเงิน") },
  ];

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, response]: any = await Promise.all([
        getOrderAnalytics(),
        getOrders({
          page: currentPage,
          limit: PAGE_SIZE,
          status: statusFilter === 'all' ? undefined : statusFilter,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          sortKey,
          sortOrder,
        }),
      ]);

      setAnalytics(analyticsRes?.data ?? null);

      if (response?.status === 200 && response.data?.status === true) {
        const payload = response.data.data;
        setOrders(payload.data ?? []);
        setTotalItems(Number(payload.meta?.total ?? 0));
      }
    } catch (error: any) {
      console.error('load orders error:', error.message);
    } finally {
      setLoading(false);
    }
  }, [currentPage, statusFilter, startDate, endDate, sortKey, sortOrder]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const views = useTableViews('j-order', { statusFilter, startDate, endDate, sortKey, sortOrder }, (v) => {
    setStatusFilter(v.statusFilter ?? 'all');
    setStartDate(v.startDate ?? '');
    setEndDate(v.endDate ?? '');
    setSortKey(v.sortKey ?? 'date');
    setSortOrder(v.sortOrder ?? 'DESC');
    setCurrentPage(1);
  });

  /** Every order matching the current filters and sort (not just this page), in the visible columns. */
  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows: OrderData[] = [];
      let total = 0;
      for (let page = 1; rows.length < EXPORT_MAX_ROWS; page++) {
        const response: any = await getOrders({
          page,
          limit: EXPORT_PAGE_SIZE,
          status: statusFilter === 'all' ? undefined : statusFilter,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          sortKey,
          sortOrder,
        });
        const payload = response?.data?.data;
        const batch: OrderData[] = payload?.data ?? [];
        total = Number(payload?.meta?.total ?? 0);
        rows.push(...batch);
        if (!batch.length || rows.length >= total) break;
      }
      const exported = rows.slice(0, EXPORT_MAX_ROWS).map((r) => ({ ...r, status: ORDER_STATUS_LABELS[r.status] ?? r.status }));
      const cols = columns.filter((c) => c.key !== 'actions' && !views.hidden.includes(c.key));
      downloadCsv(exported, cols, `orders-${new Date().toISOString().slice(0, 10)}.csv`);
      if (total > exported.length) {
        window.alert(__uiText('ส่งออก {0} จาก {1} รายการ (สูงสุด {2}) ใช้ตัวกรองให้แคบลงเพื่อส่งออกส่วนที่เหลือ', { 0: exported.length, 1: total, 2: EXPORT_MAX_ROWS }));
      }
    } catch (error: any) {
      window.alert(__uiText('ส่งออกไม่สำเร็จ: {0}', { 0: error?.message ?? String(error) }));
    } finally {
      setExporting(false);
    }
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortKey(key);
      setSortOrder('ASC');
    }
    setCurrentPage(1);
  };

  const handleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSelectAll = () => {
    const allIds = orders.map((o) => o.order_id);
    const isAllSelected = orders.every((row) => selectedIds.includes(row.order_id));
    setSelectedIds(isAllSelected ? [] : allIds);
  };

  const columns: TableColumn<OrderData>[] = [
    { key: 'order_id', label: __uiText("เลขที่ออเดอร์"), sortable: true, render: (value) => <span className="font-mono">{value}</span> },
    { key: 'customer_name', label: __uiText("ชื่อลูกค้า") },
    {
      key: 'total_price',
      label: __uiText("ยอดรวม"),
      sortable: true,
      align: 'right',
      render: (value) => (
        <span className="font-medium">{__uiText("฿")}{Number(value).toLocaleString()}</span>
      ),
    },
    { key: 'branch', label: __uiText("สาขาที่จัดส่ง"), sortable: true },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: OrderData['status']) => (
        <Chip tone={ORDER_STATUS_TONES[value] ?? 'muted'} statusCode={value} dot>{ORDER_STATUS_LABELS[value] ?? value}</Chip>
      ),
    },
    {
      key: 'date',
      label: __uiText("วันที่สั่งซื้อ"),
      sortable: true,
      render: (value) => {
        if (!value) return <span className="text-gray-400">-</span>;
        const dateObj = new Date(value);
        return (
          <span className="text-gray-600 font-mono">
            {dateObj.toLocaleDateString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        );
      },
    },
    { key: 'delivery_slot', label: __uiText("รอบเวลาจัดส่ง") },
    {
      key: 'actions',
      label: __uiText("เครื่องมือ"),
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(ADMIN_ROUTES.orderDetail(row.orders_id))}
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
            title={__uiText("ดูรายละเอียด")}
          >
            <AiOutlineEye size={18} />
          </button>
          <button
            onClick={() => navigate(ADMIN_ROUTES.orderDetail(row.orders_id))}
            className="p-1.5 text-gray-500 hover:text-primary hover:bg-gray-100 rounded-lg transition-colors"
            title={__uiText("แก้ไขสถานะ")}
          >
            <AiOutlineEdit size={18} />
          </button>
        </div>
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const formatMoney = (value: number) =>
    `฿${Number(value).toLocaleString('th-TH', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;

  const cardData = [
    { name: __uiText("ออเดอร์ทั้งหมด"), value: String(analytics?.total_orders ?? 0) },
    {
      name: __uiText("รอชำระเงิน"),
      value: String(analytics?.pending_payment ?? 0),
      textColor: 'text-amber-600',
    },
    {
      name: __uiText("ชำระแล้ว"),
      value: String(analytics?.paid ?? 0),
      textColor: 'text-emerald-600',
    },
    {
      name: __uiText("กำลังเตรียม"),
      value: String(analytics?.preparing ?? 0),
      textColor: 'text-lime-600',
    },
    {
      name: __uiText("กำลังจัดส่ง"),
      value: String(analytics?.shipped ?? 0),
      textColor: 'text-primary',
    },
    {
      name: __uiText("เสร็จสิ้น"),
      value: String(analytics?.completed ?? 0),
      textColor: 'text-sky-600',
    },
    {
      name: __uiText("ยกเลิก / คืนเงิน"),
      value: String(analytics?.cancelled ?? 0),
      textColor: 'text-gray-500',
    },
    {
      name: __uiText("ออเดอร์วันนี้"),
      value: String(analytics?.orders_today ?? 0),
    },
    {
      name: __uiText("ยอดขายวันนี้"),
      value: analytics ? formatMoney(analytics.revenue_today) : '-',
      textColor: 'text-green-500',
    },
    {
      name: __uiText("ยอดขายรวม (ชำระแล้ว)"),
      value: analytics ? formatMoney(analytics.total_revenue) : '-',
      textColor: 'text-primary',
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-4">
      <PageHeader
        title={__uiText("คำสั่งซื้อ")}
        subtitle={__uiText("ค้นหาและติดตามคำสั่งซื้อ เปิดดูรายละเอียดและสถานะ")}
        actions={<>
          {roleCanWrite() && <ButtonLink to={ADMIN_ROUTES.orderImport} icon="upload_file">{__uiText("Order Import")}</ButtonLink>}
          <ButtonLink to={ADMIN_ROUTES.paymentTransactions} icon="payments">{__uiText("รายการชำระเงิน")}</ButtonLink>
        </>}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cardData.map((card) => (
          <CardAdmin
            key={card.name}
            name={card.name}
            value={analytics ? card.value : '—'}
            textColor={card.textColor}
          />
        ))}
      </div>

      <div className="bg-surface-container-lowest border border-secondary-container p-4 flex flex-wrap items-end justify-between gap-3 rounded-xl">
        <div className="flex min-w-0 flex-wrap gap-4 items-end">
          <AiOutlineFilter size={24} />
          <div className="w-64 max-w-full">
            <Select
              label={__uiText("สถานะออเดอร์")}
              data={orderStatusOptions}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <DateRangeInput
            label={__uiText("ช่วงวันที่สั่งซื้อ")}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={(value) => {
              setStartDate(value);
              setCurrentPage(1);
            }}
            onEndDateChange={(value) => {
              setEndDate(value);
              setCurrentPage(1);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TableViewBar views={views} columns={columns} />
          <Button text={exporting ? __uiText("กำลังส่งออก…") : __uiText("export CSV")} disabled={exporting || loading || !totalItems} onClick={exportCsv} />
        </div>
      </div>
      <div>
        {loading ? (
          <div className="py-8 text-center text-gray-500 text-sm">{__uiText("กำลังโหลด...")}</div>
        ) : (
          <Table
            columns={columns}
            data={orders}
            idKey="order_id"
            hiddenKeys={views.hidden}
            sortKey={sortKey}
            sortOrder={sortOrder}
            onSort={handleSort}
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            onPageChange={setCurrentPage}
            selectedIds={selectedIds}
            onSelectRow={handleSelectRow}
            onSelectAll={handleSelectAll}
            totalItems={totalItems}
            emptyTitle={__uiText("ยังไม่มีคำสั่งซื้อ")}
            emptyDescription={__uiText("ลองเปลี่ยนสถานะหรือช่วงวันที่")}
          />
        )}
      </div>
    </div>
  );
};

export default Order;
