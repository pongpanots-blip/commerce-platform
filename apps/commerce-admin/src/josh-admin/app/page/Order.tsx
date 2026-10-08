// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { getOrderAnalytics, getOrders, type AdminOrderUiStatus, type OrderAnalytics } from '@josh/shared-api';
import { Button, CardAdmin, DateRangeInput, Select, Table, TableColumn } from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AiOutlineEdit, AiOutlineEye, AiOutlineFilter } from 'react-icons/ai';
import { ADMIN_ROUTES } from '../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
import { ButtonLink, PageHeader, useNavAllows } from '@cp/ui';
const PAGE_SIZE = 20;

const ORDER_STATUS_LABELS: Record<AdminOrderUiStatus, string> = {
  get pending(){return __uiText("รอชำระเงิน");},
  get paid(){return __uiText("ชำระแล้ว");},
  get preparing(){return __uiText("กำลังเตรียม");},
  get shipped(){return __uiText("กำลังจัดส่ง");},
  get complete(){return __uiText("เสร็จสิ้น");},
  get cancelled(){return __uiText("ยกเลิก / คืนเงิน");},
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
  const navAllows = useNavAllows();
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
    { key: 'order_id', label: __uiText("เลขที่ออเดอร์"), sortable: true },
    { key: 'customer_name', label: __uiText("ชื่อลูกค้า") },
    {
      key: 'total_price',
      label: __uiText("ยอดรวม"),
      sortable: true,
      render: (value) => (
        <span className="font-medium">{__uiText("฿")}{Number(value).toLocaleString()}</span>
      ),
    },
    { key: 'branch', label: __uiText("สาขาที่จัดส่ง"), sortable: true },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: OrderData['status']) => {
        const badgeStyles: Record<AdminOrderUiStatus, string> = {
          pending: 'bg-amber-50 text-amber-700 border-amber-200',
          paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          preparing: 'bg-lime-50 text-lime-700 border-lime-200',
          shipped: 'bg-primary/10 text-primary border-primary/20',
          complete: 'bg-sky-50 text-sky-700 border-sky-200',
          cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
        };
        const badgeLabels = ORDER_STATUS_LABELS;

        return (
          <span
            className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${badgeStyles[value]}`}
          >
            {badgeLabels[value]}
          </span>
        );
      },
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
    <div className="flex flex-col gap-4">
      <PageHeader
        title={__uiText("All Orders")}
        subtitle={__uiText("Click the edit icon on an order to change its status")}
        actions={<>
          {navAllows(ADMIN_ROUTES.paymentTransactions) && <ButtonLink to={ADMIN_ROUTES.paymentTransactions} icon="payments">{__uiText("Payment Transactions")}</ButtonLink>}
          {navAllows(ADMIN_ROUTES.orderImport) && <ButtonLink to={ADMIN_ROUTES.orderImport} variant="primary" icon="cloud_upload">{__uiText("Order Import")}</ButtonLink>}
        </>}
      />

      <div className="grid grid-cols-4 gap-5">
        {cardData.map((card) => (
          <CardAdmin
            key={card.name}
            name={card.name}
            value={analytics ? card.value : '—'}
            textColor={card.textColor}
          />
        ))}
      </div>

      <div className="bg-white border border-gray-200 p-3 flex justify-between mt-2 shadow-lg rounded-md">
        <div className="flex gap-4 items-center">
          <AiOutlineFilter size={24} />
          <div className="w-64">
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
        <div>
          <Button text={__uiText("export CSV")} />
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
          />
        )}
      </div>
    </div>
  );
};

export default Order;
