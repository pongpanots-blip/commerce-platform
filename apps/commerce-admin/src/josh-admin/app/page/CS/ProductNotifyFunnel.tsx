// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
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

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Button, Chip, StatTile, type Tone } from "@cp/ui";

/** ป้ายสำหรับแสดงผล — ค่าที่ส่งไป API ยังเป็นรหัสเดิม */
const CHANNEL_LABEL: Record<string, string> = {
  get back_in_stock(){return __uiText("สินค้ากลับมามีสต๊อก");},
  get marketing_remind(){return __uiText("แจ้งเตือนการตลาด");},
};

const STATUS_LABEL: Record<string, string> = {
  get active(){return __uiText("ยังแจ้งเตือนอยู่");},
  get converted(){return __uiText("สั่งซื้อแล้ว");},
  get cancelled(){return __uiText("ยกเลิก");},
};

const STATUS_TONE: Record<string, Tone> = {
  active: 'info',
  converted: 'ok',
  cancelled: 'muted',
};

const CHANNEL_OPTIONS = [
  { value: '', get label(){return __uiText("ทุกช่องทาง");} },
  { value: 'back_in_stock', get label(){return CHANNEL_LABEL.back_in_stock;} },
  { value: 'marketing_remind', get label(){return CHANNEL_LABEL.marketing_remind;} },
] as const;

const STATUS_OPTIONS = [
  { value: '', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'active', get label(){return STATUS_LABEL.active;} },
  { value: 'converted', get label(){return STATUS_LABEL.converted;} },
  { value: 'cancelled', get label(){return STATUS_LABEL.cancelled;} },
] as const;

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function AggregateTile({ aggregate }: { aggregate: ProductNotifyFunnelAggregate }) {
  __useUiLocale();
  return (
    <StatTile
      label={CHANNEL_LABEL[aggregate.channel_type] ?? aggregate.channel_type}
      value={aggregate.avg_notify_count.toFixed(1)}
      foot={__uiText("ครั้งเฉลี่ยก่อนสั่งซื้อ · สั่งซื้อแล้ว {0} ครั้ง", {"0": aggregate.converted_count.toLocaleString()})}
    />
  );
}

export default function ProductNotifyFunnelPage() {
  __useUiLocale();
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
      setError(__uiMessage("ไม่สามารถโหลดผลการแจ้งเตือนสินค้าได้"));
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
      label: __uiText("ผู้ใช้"),
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
      label: __uiText("รหัสสินค้า"),
      render: (value: string) => <span className="font-mono text-xs">{value}</span>,
    },
    {
      key: 'channel_type',
      label: __uiText("ช่องทาง"),
      render: (value: string) => CHANNEL_LABEL[value] ?? value,
    },
    {
      key: 'notify_count',
      label: __uiText("จำนวนแจ้ง"),
      align: 'right',
      render: (value: number) => <span className="tabular-nums">{value.toLocaleString()}</span>,
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: ProductNotifyFunnel['status']) => (
        <Chip tone={STATUS_TONE[value] ?? 'muted'} statusCode={value} dot>
          {STATUS_LABEL[value] ?? value}
        </Chip>
      ),
    },
    {
      key: 'last_notified_at',
      label: __uiText("แจ้งล่าสุด"),
      render: (value: string | null) => (
        <span className="whitespace-nowrap tabular-nums">{formatDate(value)}</span>
      ),
    },
    {
      key: 'converted_order_id',
      label: __uiText("คำสั่งซื้อที่เกิดขึ้น"),
      render: (value: string | null) =>
        value ? <span className="font-mono text-xs">{value}</span> : '—',
    },
  ];

  return (
    <div className="cp-management-page">
      <AdminListHeader
        title={__uiText("ผลการแจ้งเตือนสินค้า")}
        subtitle={__uiText("ผลของการแจ้งเตือนสินค้า ตั้งแต่ส่งจนถึงสั่งซื้อ")}
      />

      <div className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{__uiText("ช่องทางแจ้งเตือน")}</span>
          <Select
            aria-label={__uiText("ช่องทางแจ้งเตือน")}
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
          <span className="text-xs text-gray-500">{__uiText("สถานะ")}</span>
          <Select
            aria-label={__uiText("สถานะ")}
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
          <span className="text-xs text-gray-500">{__uiText("รหัสผู้ใช้ (User ID)")}</span>
          <input
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{__uiText("รหัสสินค้าคงคลัง (Product Inventory ID)")}</span>
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
          {__uiText("กรองข้อมูล")}</button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>}

      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {aggregates.length ? (
          aggregates.map((aggregate) => (
            <AggregateTile key={aggregate.channel_type} aggregate={aggregate} />
          ))
        ) : (
          <p className="text-sm text-gray-400">{__uiText("ยังไม่มีการสั่งซื้อจากการแจ้งเตือนในตัวกรองนี้")}</p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : (
        <>
          <Table
            columns={columns}
            data={rows}
            idKey="id"
            emptyTitle={__uiText("ไม่พบผลการแจ้งเตือนสินค้า")}
            emptyDescription={__uiText("ลองล้างหรือเปลี่ยนตัวกรอง แล้วกดกรองข้อมูลอีกครั้ง")}
          />
          <div className="mt-4 flex items-center justify-end gap-2 text-sm">
            <Button size="sm" disabled={cursorStack.length === 0} onClick={handlePrevious}>
              {__uiText("ก่อนหน้า")}</Button>
            <Button size="sm" disabled={!nextCursor} onClick={handleNext}>
              {__uiText("ถัดไป")}</Button>
          </div>
        </>
      )}
    </div>
  );
}
