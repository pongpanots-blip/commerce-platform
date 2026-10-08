// ui-metadata-migration: static labels and UI notices only
import {
  formatShipmentDuration,
  formatShipmentDurationMinutes,
  getAdminShipments,
  getShipmentAnalytics,
  getUsers,
  type AdminShipmentListItem,
  type ShipmentAnalytics,
  type ShipmentUiStatus,
} from '@josh/shared-api';
import {
  Button,
  CardAdmin,
  DateRangeInput,
  Input,
  Select,
  Table,
  TableColumn,
} from '@josh/shared-ui-web';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AiOutlineClose, AiOutlineEye, AiOutlineFilter } from 'react-icons/ai';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
import { ButtonLink, PageHeader } from '@cp/ui';
const PAGE_SIZE = 20;
const CUSTOMER_SEARCH_DEBOUNCE_MS = 300;

const STATUS_LABELS: Record<ShipmentUiStatus, string> = {
  get to_ship(){return __uiText("รอส่ง");},
  get shipping(){return __uiText("กำลังจัดส่ง");},
  get delivered(){return __uiText("ส่งแล้ว");},
  get cancelled(){return __uiText("ยกเลิก");},
};

type CustomerPick = {
  id: string;
  label: string;
};

type UserSearchRow = {
  id: string;
  full_name?: string;
  email?: string;
  custcode?: string | null;
};

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatUserOptionLabel = (row: UserSearchRow) => {
  const name = row.full_name?.trim() || '-';
  const parts = [name];
  if (row.custcode) parts.push(row.custcode);
  if (row.email) parts.push(row.email);
  return parts.join(' · ');
};

const Shipments = () => {
  __useUiLocale();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState<ShipmentAnalytics | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerPick | null>(
    null,
  );
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerOptions, setCustomerOptions] = useState<UserSearchRow[]>([]);
  const [customerSearching, setCustomerSearching] = useState(false);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerPickerRef = useRef<HTMLDivElement>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [sortKey, setSortKey] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [currentPage, setCurrentPage] = useState(1);
  const [rows, setRows] = useState<AdminShipmentListItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);

  const statusOptions = [
    { value: 'all', label: __uiText("ทุกสถานะ") },
    { value: 'to_ship', label: __uiText("รอส่ง") },
    { value: 'shipping', label: __uiText("กำลังจัดส่ง") },
    { value: 'delivered', label: __uiText("ส่งแล้ว") },
    { value: 'cancelled', label: __uiText("ยกเลิก") },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, listRes] = await Promise.all([
        getShipmentAnalytics(),
        getAdminShipments({
          page: currentPage,
          limit: PAGE_SIZE,
          status:
            statusFilter === 'all'
              ? undefined
              : (statusFilter as ShipmentUiStatus),
          search: search || undefined,
          customerId,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          sortKey: sortKey as AdminShipmentsParamsSort,
          sortOrder,
        }),
      ]);
      setAnalytics(analyticsRes?.data ?? null);
      if (listRes?.status === 200 && listRes.data) {
        setRows(listRes.data.items ?? []);
        setTotalItems(Number(listRes.data.total ?? 0));
      }
    } catch (error: unknown) {
      console.error(
        'load shipments error:',
        error instanceof Error ? error.message : error,
      );
    } finally {
      setLoading(false);
    }
  }, [
    currentPage,
    statusFilter,
    search,
    customerId,
    startDate,
    endDate,
    sortKey,
    sortOrder,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selectedCustomer) {
      setCustomerOptions([]);
      setCustomerDropdownOpen(false);
      return;
    }

    const trimmed = customerQuery.trim();
    if (trimmed.length < 2) {
      setCustomerOptions([]);
      setCustomerSearching(false);
      return;
    }

    let cancelled = false;
    setCustomerSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response: {
          status?: number;
          data?: { status?: boolean; data?: { data?: UserSearchRow[] } };
        } = await getUsers({ search: trimmed, limit: 10, page: 1 });
        if (cancelled) return;
        if (response?.status === 200 && response.data?.status === true) {
          setCustomerOptions(response.data.data?.data ?? []);
          setCustomerDropdownOpen(true);
        } else {
          setCustomerOptions([]);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          console.error(
            'customer customer search error:',
            error instanceof Error ? error.message : error,
          );
          setCustomerOptions([]);
        }
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    }, CUSTOMER_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerQuery, selectedCustomer]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (
        customerPickerRef.current &&
        !customerPickerRef.current.contains(event.target as Node)
      ) {
        setCustomerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const selectCustomer = (row: UserSearchRow) => {
    setSelectedCustomer({ id: row.id, label: formatUserOptionLabel(row) });
    setCustomerId(row.id);
    setCustomerQuery('');
    setCustomerOptions([]);
    setCustomerDropdownOpen(false);
    setCurrentPage(1);
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setCustomerId(undefined);
    setCustomerQuery('');
    setCustomerOptions([]);
    setCustomerDropdownOpen(false);
    setCurrentPage(1);
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

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const cardData = [
    { name: __uiText("Shipments ทั้งหมด"), value: String(analytics?.total ?? 0) },
    {
      name: __uiText("รอส่ง"),
      value: String(analytics?.toShip ?? 0),
      textColor: 'text-lime-600',
    },
    {
      name: __uiText("กำลังจัดส่ง"),
      value: String(analytics?.shipping ?? 0),
      textColor: 'text-primary',
    },
    {
      name: __uiText("ส่งแล้ว"),
      value: String(analytics?.delivered ?? 0),
      textColor: 'text-sky-600',
    },
    {
      name: __uiText("ยกเลิก"),
      value: String(analytics?.cancelled ?? 0),
      textColor: 'text-gray-500',
    },
    {
      name: __uiText("ยังไม่จ่าย"),
      value: String(analytics?.unpaid ?? 0),
      textColor: 'text-amber-600',
    },
    {
      name: __uiText("สร้างวันนี้"),
      value: String(analytics?.createdToday ?? 0),
    },
    {
      name: __uiText("Avg รอส่ง"),
      value: formatShipmentDurationMinutes(analytics?.avgToShipMinutes),
      textColor: 'text-lime-700',
    },
    {
      name: __uiText("Avg จัดส่ง"),
      value: formatShipmentDurationMinutes(analytics?.avgShippingMinutes),
      textColor: 'text-primary',
    },
    {
      name: __uiText("Avg รวม (สร้าง→ส่งถึง)"),
      value: formatShipmentDurationMinutes(analytics?.avgTotalMinutes),
      textColor: 'text-sky-700',
    },
  ];

  const columns: TableColumn<AdminShipmentListItem>[] = [
    {
      key: 'shipmentNumber',
      label: __uiText("Shipment"),
      sortable: true,
      render: (value, row) => (
        <button
          type="button"
          className="font-mono text-sm text-primary hover:underline"
          onClick={() => navigate(ADMIN_ROUTES.shipmentDetail(row.shipmentId))}
        >
          {String(value)}
        </button>
      ),
    },
    {
      key: 'orderNumber',
      label: __uiText("Order"),
      render: (value, row) =>
        value ? (
          <Link
            to={ADMIN_ROUTES.orderDetail(row.orderId)}
            className="font-mono text-sm text-primary hover:underline"
          >
            {String(value)}
          </Link>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      key: 'customerName',
      label: __uiText("ลูกค้า"),
      render: (value) => String(value || '-'),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: AdminShipmentListItem['status']) => {
        if (!value) {
          return (
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full border bg-amber-50 text-amber-700 border-amber-200">
              {__uiText("รอชำระ")}</span>
          );
        }
        const badgeStyles: Record<ShipmentUiStatus, string> = {
          to_ship: 'bg-lime-50 text-lime-700 border-lime-200',
          shipping: 'bg-primary/10 text-primary border-primary/20',
          delivered: 'bg-sky-50 text-sky-700 border-sky-200',
          cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
        };
        return (
          <span
            className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${badgeStyles[value]}`}
          >
            {STATUS_LABELS[value]}
          </span>
        );
      },
    },
    {
      key: 'courierName',
      label: __uiText("Courier"),
      render: (value) => String(value || '-'),
    },
    {
      key: 'timing',
      label: __uiText("สร้างเมื่อ"),
      sortable: true,
      render: (_, row) => (
        <span className="text-gray-600 font-mono text-xs">
          {formatDateTime(row.timing?.createdAt)}
        </span>
      ),
    },
    {
      key: 'toShip',
      label: __uiText("รอส่ง (นาที)"),
      render: (_, row) =>
        row.timing?.toShipMinutes != null
          ? formatShipmentDurationMinutes(row.timing.toShipMinutes)
          : formatShipmentDuration(row.timing?.toShipSeconds),
    },
    {
      key: 'shippingDur',
      label: __uiText("จัดส่ง (นาที)"),
      render: (_, row) =>
        row.timing?.shippingMinutes != null
          ? formatShipmentDurationMinutes(row.timing.shippingMinutes)
          : formatShipmentDuration(row.timing?.shippingSeconds),
    },
    {
      key: 'totalDur',
      label: __uiText("รวม (นาที)"),
      render: (_, row) => (
        <span className="font-medium">
          {row.timing?.totalMinutes != null
            ? formatShipmentDurationMinutes(row.timing.totalMinutes)
            : formatShipmentDuration(row.timing?.totalSeconds)}
        </span>
      ),
    },
    {
      key: 'totalIncVat',
      label: __uiText("ยอด"),
      sortable: true,
      render: (value) => (
        <span className="font-medium">
          {__uiText("฿")}{Number(value).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_, row) => (
        <button
          type="button"
          className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
          title={__uiText("ดูรายละเอียด")}
          onClick={() => navigate(ADMIN_ROUTES.shipmentDetail(row.shipmentId))}
        >
          <AiOutlineEye size={18} />
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={__uiText("Shipments")}
        subtitle={__uiText("ดู shipment แยกจาก order — timing ต่อสถานะ + ลิงก์กลับ order")}
        actions={<ButtonLink to={ADMIN_ROUTES.orders} icon="receipt_long">{__uiText("All Orders")}</ButtonLink>}
      />

      <div className="grid grid-cols-5 gap-4">
        {cardData.map((card) => (
          <CardAdmin
            key={card.name}
            name={card.name}
            value={analytics ? card.value : '—'}
            textColor={card.textColor}
          />
        ))}
      </div>

      <div className="bg-white border border-gray-200 p-3 flex flex-wrap justify-between gap-3 mt-2 shadow-lg rounded-md">
        <div className="flex flex-wrap gap-4 items-end">
          <AiOutlineFilter size={24} className="mb-2 text-gray-500" />
          <div className="w-48">
            <Select
              label={__uiText("สถานะ")}
              data={statusOptions}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <div className="w-64">
            <Input
              label={__uiText("ค้นหา shipment / order / ลูกค้า")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSearch(searchInput.trim());
                  setCurrentPage(1);
                }
              }}
            />
          </div>
          <Button
            text={__uiText("ค้นหา")}
            onClick={() => {
              setSearch(searchInput.trim());
              setCurrentPage(1);
            }}
          />
          <div className="relative w-72" ref={customerPickerRef}>
            {selectedCustomer ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-gray-600">{__uiText("ลูกค้า")}</span>
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-gray-800">
                    {selectedCustomer.label}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-white hover:text-gray-800"
                    title={__uiText("ล้างลูกค้า")}
                    onClick={clearCustomer}
                  >
                    <AiOutlineClose size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Input
                  label={__uiText("เลือกลูกค้า")}
                  value={customerQuery}
                  placeholder={__uiText("ชื่อ / email / custcode")}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    setCustomerDropdownOpen(true);
                  }}
                  onFocus={() => {
                    if (customerOptions.length > 0) {
                      setCustomerDropdownOpen(true);
                    }
                  }}
                />
                {customerDropdownOpen &&
                  (customerSearching ||
                    customerOptions.length > 0 ||
                    customerQuery.trim().length >= 2) && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                      {customerSearching ? (
                        <div className="px-3 py-2 text-xs text-gray-500">
                          {__uiText("กำลังค้นหา...")}</div>
                      ) : customerOptions.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-gray-500">
                          {__uiText("ไม่พบลูกค้า")}</div>
                      ) : (
                        customerOptions.map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            className="block w-full truncate px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                            onClick={() => selectCustomer(row)}
                          >
                            {formatUserOptionLabel(row)}
                          </button>
                        ))
                      )}
                    </div>
                  )}
              </>
            )}
          </div>
          <DateRangeInput
            label={__uiText("ช่วงวันที่สร้าง")}
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
      </div>

      <div>
        {loading ? (
          <div className="py-8 text-center text-gray-500 text-sm">
            {__uiText("กำลังโหลด...")}</div>
        ) : (
          <Table
            columns={columns}
            data={rows}
            idKey="shipmentId"
            sortKey={sortKey}
            sortOrder={sortOrder}
            onSort={handleSort}
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={PAGE_SIZE}
            onPageChange={setCurrentPage}
            totalItems={totalItems}
          />
        )}
      </div>
    </div>
  );
};

type AdminShipmentsParamsSort =
  | 'createdAt'
  | 'deliveryDate'
  | 'totalIncVat'
  | 'shippedAt'
  | 'deliveredAt';

export default Shipments;
