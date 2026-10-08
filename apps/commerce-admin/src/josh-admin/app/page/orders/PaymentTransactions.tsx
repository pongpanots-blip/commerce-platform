// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import {
  getPaymentTransactionAnalytics,
  getPaymentTransactions,
  type PaymentTransactionAnalytics,
  type PaymentTransactionItem,
} from '@josh/shared-api';
import {
  Button,
  CardAdmin,
  DateRangeInput,
  Select,
  Table,
  TableColumn,
} from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AiOutlineEye, AiOutlineFilter } from 'react-icons/ai';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
import { Button as UiButton, ButtonLink, PageHeader } from '@cp/ui';
const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: 'all', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'pending', get label(){return __uiText("รอชำระ");} },
  { value: 'success', get label(){return __uiText("สำเร็จ");} },
  { value: 'failed', get label(){return __uiText("ล้มเหลว");} },
  { value: 'cancelled', get label(){return __uiText("ยกเลิก");} },
];

const METHOD_OPTIONS = [
  { value: 'all', get label(){return __uiText("ทุกช่องทาง");} },
  { value: 'qr', get label(){return __uiText("QR / PromptPay");} },
  { value: 'credit', get label(){return __uiText("บัตรเครดิต");} },
  { value: 'customer_credit', get label(){return __uiText("เครดิตลูกค้า");} },
  { value: 'cod', get label(){return __uiText("เก็บเงินปลายทาง");} },
];

const GATEWAY_OPTIONS = [
  { value: 'all', get label(){return __uiText("ทุก Gateway");} },
  { value: 'omise', get label(){return __uiText("Omise");} },
  { value: 'stripe', get label(){return __uiText("Stripe");} },
  { value: 'credit_terms', get label(){return __uiText("Credit Terms");} },
  { value: 'cod', get label(){return __uiText("COD");} },
];

const STATUS_BADGE: Record<
  PaymentTransactionItem['status'],
  { label: string; className: string }
> = {
  pending: {
    get label(){return __uiText("รอชำระ");},
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  success: {
    get label(){return __uiText("สำเร็จ");},
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  failed: {
    get label(){return __uiText("ล้มเหลว");},
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  cancelled: {
    get label(){return __uiText("ยกเลิก");},
    className: 'bg-gray-100 text-gray-600 border-gray-200',
  },
};

function formatMoney(value: number) {
  return `฿${Number(value).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const PaymentTransactions = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState<PaymentTransactionAnalytics | null>(
    null,
  );
  const [transactions, setTransactions] = useState<PaymentTransactionItem[]>(
    [],
  );
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [gatewayFilter, setGatewayFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, listRes] = await Promise.all([
        getPaymentTransactionAnalytics(),
        getPaymentTransactions({
          page: currentPage,
          limit: PAGE_SIZE,
          status: statusFilter === 'all' ? undefined : statusFilter,
          paymentMethod: methodFilter === 'all' ? undefined : methodFilter,
          gatewayProvider: gatewayFilter === 'all' ? undefined : gatewayFilter,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          search: search.trim() || undefined,
        }),
      ]);

      setAnalytics(analyticsRes?.data ?? null);

      if (listRes?.status === 200 && listRes.data?.status === true) {
        const payload = listRes.data.data;
        setTransactions(payload.data ?? []);
        setTotalItems(Number(payload.meta?.total ?? 0));
      } else {
        setTransactions([]);
        setTotalItems(0);
      }
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [
    currentPage,
    statusFilter,
    methodFilter,
    gatewayFilter,
    startDate,
    endDate,
    search,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const cardData = [
    {
      name: __uiText("รายการทั้งหมด"),
      value: String(analytics?.total ?? 0),
    },
    {
      name: __uiText("รอชำระ"),
      value: String(analytics?.pending ?? 0),
      textColor: 'text-amber-600',
    },
    {
      name: __uiText("ชำระสำเร็จ"),
      value: String(analytics?.success ?? 0),
      textColor: 'text-emerald-600',
    },
    {
      name: __uiText("ล้มเหลว"),
      value: String(analytics?.failed ?? 0),
      textColor: 'text-red-500',
    },
    {
      name: __uiText("ยอดสำเร็จรวม"),
      value: analytics ? formatMoney(analytics.success_amount) : '-',
      textColor: 'text-primary',
    },
    {
      name: __uiText("รอชำระ (มูลค่า)"),
      value: analytics ? formatMoney(analytics.pending_amount) : '-',
      textColor: 'text-orange-500',
    },
    {
      name: __uiText("วันนี้ (รายการ)"),
      value: String(analytics?.today_count ?? 0),
    },
    {
      name: __uiText("วันนี้ (ยอดสำเร็จ)"),
      value: analytics ? formatMoney(analytics.today_success_amount) : '-',
      textColor: 'text-green-500',
    },
  ];

  const columns: TableColumn<PaymentTransactionItem>[] = [
    {
      key: 'created_at',
      label: __uiText("วันที่"),
      render: (value) =>
        new Date(String(value)).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
    },
    {
      key: 'order_number',
      label: __uiText("เลขออเดอร์"),
      render: (value) => <span className="font-mono">{String(value)}</span>,
    },
    { key: 'customer_name', label: __uiText("ลูกค้า") },
    {
      key: 'amount',
      label: __uiText("ยอดเงิน"),
      render: (value, row) => (
        <span className="font-medium">{formatMoney(Number(value))}</span>
      ),
    },
    {
      key: 'payment_method',
      label: __uiText("ช่องทาง"),
      render: (value) => <span className="uppercase text-xs">{String(value)}</span>,
    },
    {
      key: 'gateway_provider',
      label: __uiText("Gateway"),
      render: (value) => <span className="capitalize">{String(value)}</span>,
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: PaymentTransactionItem['status']) => {
        const badge = STATUS_BADGE[value] ?? STATUS_BADGE.pending;
        return (
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badge.className}`}
          >
            {badge.label}
          </span>
        );
      },
    },
    {
      key: 'gateway_charge_id',
      label: __uiText("Charge ID"),
      render: (value) =>
        value ? (
          <span className="font-mono text-xs text-gray-600">{String(value)}</span>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      key: 'paid_at',
      label: __uiText("ชำระเมื่อ"),
      render: (value) =>
        value
          ? new Date(String(value)).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })
          : '-',
    },
    {
      key: 'actions',
      label: __uiText("ออเดอร์"),
      render: (_, row) => (
        <button
          onClick={() => navigate(ADMIN_ROUTES.orderDetail(row.order_id))}
          className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-primary"
          title={__uiText("ดูออเดอร์")}
        >
          <AiOutlineEye size={18} />
        </button>
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const handleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSelectAll = () => {
    const allIds = transactions.map((t) => t.id);
    const isAllSelected = transactions.every((row) => selectedIds.includes(row.id));
    setSelectedIds(isAllSelected ? [] : allIds);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={__uiText("Payment Transactions")}
        subtitle={__uiText("บันทึกการชำระเงินจาก Omise, Stripe, เครดิตลูกค้า และ COD")}
        actions={<>
          <ButtonLink to={ADMIN_ROUTES.orders} icon="receipt_long">{__uiText("ดูออเดอร์ทั้งหมด")}</ButtonLink>
          <UiButton icon="refresh" onClick={() => void loadData()}>{__uiText("Refresh")}</UiButton>
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

      <div className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-md border border-gray-200 bg-white p-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-4">
          <AiOutlineFilter size={24} />
          <div className="w-48">
            <Select
              label={__uiText("สถานะ")}
              data={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <div className="w-48">
            <Select
              label={__uiText("ช่องทางชำระเงิน")}
              data={METHOD_OPTIONS}
              value={methodFilter}
              onChange={(e) => {
                setMethodFilter(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <div className="w-48">
            <Select
              label={__uiText("ผู้ให้บริการชำระเงิน (Gateway)")}
              data={GATEWAY_OPTIONS}
              value={gatewayFilter}
              onChange={(e) => {
                setGatewayFilter(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <DateRangeInput
            label={__uiText("ช่วงวันที่ชำระเงิน")}
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
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-500">{__uiText("ค้นหา")}</span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder={__uiText("ค้นหาเลขออเดอร์ / Charge ID")}
              className="w-64 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : (
        <Table
          columns={columns}
          data={transactions}
          idKey="id"
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
  );
};

export default PaymentTransactions;
