import {
  getProductNotifyFunnel,
  type ProductNotifyFunnel,
  type ProductNotifyFunnelAggregate,
  type ProductNotifyFunnelQuery,
} from '@josh/shared-api';
import { Select, Table, TableColumn } from '@josh/shared-ui-web';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const CHANNEL_OPTIONS = [
  { value: '', label: 'ทุกช่องทาง' },
  { value: 'back_in_stock', label: 'Back in stock' },
  { value: 'marketing_remind', label: 'Marketing remind' },
] as const;

const STATUS_OPTIONS = [
  { value: '', label: 'ทุกสถานะ' },
  { value: 'active', label: 'Active' },
  { value: 'converted', label: 'Converted' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function AggregateTile({ aggregate }: { aggregate: ProductNotifyFunnelAggregate }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5">
      <p className="text-xs font-semibold text-gray-500">{aggregate.channel_type}</p>
      <p className="mt-1 text-2xl font-semibold">{aggregate.avg_notify_count.toFixed(1)}</p>
      <p className="mt-1 text-xs text-gray-500">
        ครั้งเฉลี่ยก่อนสั่งซื้อ · {aggregate.converted_count} conversions
      </p>
    </div>
  );
}

export default function ProductNotifyFunnelPage() {
  const [channelType, setChannelType] = useState<ProductNotifyFunnelQuery['channel_type']>();
  const [status, setStatus] = useState<ProductNotifyFunnelQuery['status']>();
  const [userId, setUserId] = useState('');
  const [productInventoryId, setProductInventoryId] = useState('');
  const [activeFilters, setActiveFilters] = useState<ProductNotifyFunnelQuery>({ limit: 20 });
  const [rows, setRows] = useState<ProductNotifyFunnel[]>([]);
  const [aggregates, setAggregates] = useState<ProductNotifyFunnelAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);

  const filters = (): ProductNotifyFunnelQuery => ({
    channel_type: channelType,
    status,
    userId: userId.trim() || undefined,
    productInventoryId: productInventoryId.trim() || undefined,
    limit: 20,
  });

  const load = useCallback(async (query: ProductNotifyFunnelQuery, cursorValue?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getProductNotifyFunnel({ ...query, cursor: cursorValue });
      const payload = response.data.data;
      setRows(payload.items);
      setAggregates(payload.aggregates.byChannel);
      setNextCursor(payload.nextCursor);
    } catch {
      setRows([]);
      setAggregates([]);
      setNextCursor(null);
      setError('ไม่สามารถโหลดข้อมูล Product Notify Funnel ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(activeFilters, cursor);
  }, [activeFilters, cursor, load]);

  const applyFilters = () => {
    setCursorStack([]);
    setCursor(undefined);
    setActiveFilters(filters());
  };

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorStack((previous) => [...previous, cursor]);
    setCursor(nextCursor);
  };

  const handlePrevious = () => {
    setCursorStack((previous) => {
      if (previous.length === 0) return previous;
      setCursor(previous[previous.length - 1]);
      return previous.slice(0, -1);
    });
  };

  const columns: TableColumn<ProductNotifyFunnel>[] = [
    {
      key: 'user_id',
      label: 'ผู้ใช้',
      render: (value: string) => (
        <Link
          to={ADMIN_ROUTES.userDetail(value)}
          className="font-mono text-xs text-primary hover:underline"
        >
          {value}
        </Link>
      ),
    },
    {
      key: 'product_inventory_id',
      label: 'SKU / Inventory',
      render: (value: string) => <span className="font-mono text-xs">{value}</span>,
    },
    { key: 'channel_type', label: 'ช่องทาง' },
    { key: 'notify_count', label: 'จำนวนแจ้ง' },
    {
      key: 'status',
      label: 'สถานะ',
      render: (value: ProductNotifyFunnel['status']) => (
        <span
          className={`rounded-full px-2 py-1 text-xs font-semibold ${
            value === 'converted'
              ? 'bg-green-50 text-green-700'
              : value === 'active'
                ? 'bg-blue-50 text-blue-700'
                : 'bg-gray-100 text-gray-600'
          }`}
        >
          {value}
        </span>
      ),
    },
    {
      key: 'last_notified_at',
      label: 'แจ้งล่าสุด',
      render: (value: string | null) => formatDate(value),
    },
    {
      key: 'converted_order_id',
      label: 'คำสั่งซื้อที่ convert',
      render: (value: string | null) =>
        value ? <span className="font-mono text-xs">{value}</span> : '—',
    },
  ];

  return (
    <div className="p-6">
      <AdminListHeader
        title="Product Notify Funnel"
        subtitle="จำนวนครั้งที่แจ้งเตือนก่อนลูกค้าสั่งซื้อ แยกตามช่องทาง (อ่านอย่างเดียว)"
      />

      <div className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">ช่องทางแจ้งเตือน</span>
          <Select
            aria-label="ช่องทางแจ้งเตือน"
            value={channelType ?? ''}
            onChange={(event) =>
              setChannelType(
                (event.target.value || undefined) as ProductNotifyFunnelQuery['channel_type'],
              )
            }
          >
            {CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">สถานะ</span>
          <Select
            aria-label="สถานะ"
            value={status ?? ''}
            onChange={(event) =>
              setStatus((event.target.value || undefined) as ProductNotifyFunnelQuery['status'])
            }
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">รหัสผู้ใช้ (User ID)</span>
          <input
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">รหัสสินค้าคงคลัง (Product Inventory ID)</span>
          <input
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={productInventoryId}
            onChange={(event) => setProductInventoryId(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="self-end rounded-lg bg-primary px-4 py-2 text-sm text-white"
          onClick={applyFilters}
        >
          กรองข้อมูล
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {aggregates.length ? (
          aggregates.map((aggregate) => (
            <AggregateTile key={aggregate.channel_type} aggregate={aggregate} />
          ))
        ) : (
          <p className="text-sm text-gray-400">ยังไม่มี conversion สำหรับตัวกรองนี้</p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">กำลังโหลด...</p>
      ) : (
        <>
          <Table columns={columns} data={rows} idKey="id" />
          {!rows.length && <p className="mt-3 text-sm text-gray-400">ไม่พบข้อมูล funnel</p>}
          <div className="mt-4 flex items-center justify-end gap-2 text-sm">
            <button
              type="button"
              disabled={cursorStack.length === 0}
              className="rounded border px-3 py-1 disabled:opacity-40"
              onClick={handlePrevious}
            >
              ก่อนหน้า
            </button>
            <button
              type="button"
              disabled={!nextCursor}
              className="rounded border px-3 py-1 disabled:opacity-40"
              onClick={handleNext}
            >
              ถัดไป
            </button>
          </div>
        </>
      )}
    </div>
  );
}
