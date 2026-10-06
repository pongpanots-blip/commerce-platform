import {
  getNotificationDeliveryLog,
  type NotificationDeliveryChannel,
  type NotificationDeliveryLogItem,
  type NotificationDeliveryLogQuery,
  type NotificationDeliveryStatus,
} from '@josh/shared-api';
import { Select, Table, TableColumn } from '@josh/shared-ui-web';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_ROUTES } from '../../config/admin-routes';

const CHANNEL_OPTIONS = [
  { value: '', label: 'ทุกช่องทาง' },
  { value: 'push', label: 'Push' },
  { value: 'inapp', label: 'ในแอป' },
  { value: 'email', label: 'อีเมล' },
] as const;

const STATUS_OPTIONS = [
  { value: '', label: 'ทุกสถานะ' },
  { value: 'sent', label: 'ส่งสำเร็จ' },
  { value: 'skipped', label: 'ไม่ได้ส่ง' },
  { value: 'failed', label: 'ล้มเหลว' },
] as const;

/** แปลเหตุผลของระบบเป็นภาษาที่ทีมซัพพอร์ตใช้ตอบลูกค้าได้ทันที */
const REASON_LABEL: Record<string, string> = {
  type_disabled: 'ปิดการแจ้งเตือนประเภทนี้ไว้ทั้งระบบ',
  channel_not_allowed: 'ไม่อนุญาตช่องทางนี้สำหรับการแจ้งเตือนประเภทนี้',
  preference_off: 'ลูกค้าปิดรับช่องทางนี้เอง',
  not_requested: 'ผู้เรียกเลือกส่งเฉพาะช่องทางอื่น',
  duplicate: 'ซ้ำกับใบที่ส่งไปแล้ว',
  not_configured: 'ยังไม่ได้ตั้งค่า OneSignal',
};

const STATUS_STYLE: Record<NotificationDeliveryStatus, string> = {
  sent: 'bg-green-50 text-green-700',
  skipped: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-50 text-red-700',
};

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('th-TH', {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function describeReason(reason: string | null): string {
  if (!reason) return '—';
  return REASON_LABEL[reason] ?? reason;
}

/**
 * log ดิบทีละแถว — ใช้ตอบเคส "ลูกค้าบอกว่าไม่ได้รับแจ้งเตือน" ซึ่งยอดสรุป
 * ในแท็บภาพรวมตอบไม่ได้ ค้นด้วย userId แล้วอ่านคอลัมน์ "เหตุผล" ได้เลย
 */
export default function NotificationDeliveryLogTab() {
  const [userId, setUserId] = useState('');
  const [type, setType] = useState('');
  const [channel, setChannel] = useState<NotificationDeliveryChannel | ''>('');
  const [status, setStatus] = useState<NotificationDeliveryStatus | ''>('');
  const [filters, setFilters] = useState<NotificationDeliveryLogQuery>({ limit: 25 });
  const [rows, setRows] = useState<NotificationDeliveryLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);

  const load = useCallback(
    async (query: NotificationDeliveryLogQuery, cursorValue?: string) => {
      setLoading(true);
      setError(null);
      try {
        const response = await getNotificationDeliveryLog({ ...query, cursor: cursorValue });
        setRows(response.data.data.items);
        setNextCursor(response.data.data.nextCursor);
      } catch {
        setRows([]);
        setNextCursor(null);
        setError('ไม่สามารถโหลด log การส่งได้');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(filters, cursor);
  }, [filters, cursor, load]);

  const applyFilters = () => {
    setCursorStack([]);
    setCursor(undefined);
    setFilters({
      userId: userId.trim() || undefined,
      type: type.trim() || undefined,
      channel: channel || undefined,
      status: status || undefined,
      limit: 25,
    });
  };

  const columns: TableColumn<NotificationDeliveryLogItem>[] = [
    {
      key: 'sentAt',
      label: 'เวลา',
      render: (value: string) => (
        <span className="whitespace-nowrap text-xs">{formatDateTime(value)}</span>
      ),
    },
    {
      key: 'userId',
      label: 'ผู้ใช้',
      render: (value: string) => (
        <Link
          to={ADMIN_ROUTES.userDetail(value)}
          className="font-mono text-xs text-primary hover:underline"
        >
          {value.slice(0, 8)}…
        </Link>
      ),
    },
    { key: 'type', label: 'ประเภท' },
    { key: 'channel', label: 'ช่องทาง' },
    {
      key: 'status',
      label: 'สถานะ',
      render: (value: NotificationDeliveryStatus) => (
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_STYLE[value]}`}>
          {value}
        </span>
      ),
    },
    {
      key: 'reason',
      label: 'เหตุผล',
      render: (value: string | null) => (
        <span className="text-xs text-gray-600">{describeReason(value)}</span>
      ),
    },
    {
      key: 'clickedAt',
      label: 'กดเปิด',
      render: (value: string | null, row: NotificationDeliveryLogItem) =>
        value ? (
          <span className="text-xs text-gray-600">
            {formatDateTime(value)}
            {row.clickPlatform ? ` · ${row.clickPlatform}` : ''}
          </span>
        ) : (
          <span className="text-xs text-gray-300">—</span>
        ),
    },
  ];

  return (
    <>
      <div className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">รหัสผู้ใช้ (User ID)</span>
          <input
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">ประเภทการแจ้งเตือน</span>
          <input
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="ประเภท เช่น order_shipped"
            value={type}
            onChange={(event) => setType(event.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">ช่องทาง</span>
          <Select
            aria-label="ช่องทาง"
            value={channel}
            onChange={(event) => setChannel(event.target.value as NotificationDeliveryChannel | '')}
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
            value={status}
            onChange={(event) => setStatus(event.target.value as NotificationDeliveryStatus | '')}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="button"
          className="self-end rounded-lg bg-primary px-4 py-2 text-sm text-white"
          onClick={applyFilters}
        >
          ค้นหา
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">กำลังโหลด...</p>
      ) : (
        <>
          <Table columns={columns} data={rows} idKey="id" />
          {!rows.length && (
            <p className="mt-3 text-sm text-gray-400">
              ไม่พบ log ในเงื่อนไขนี้ — log เริ่มเก็บตั้งแต่วันที่เปิดใช้ฟีเจอร์นี้ และเก็บย้อนหลัง 90 วัน
            </p>
          )}
          <div className="mt-4 flex items-center justify-end gap-2 text-sm">
            <button
              type="button"
              disabled={cursorStack.length === 0}
              className="rounded border px-3 py-1 disabled:opacity-40"
              onClick={() =>
                setCursorStack((previous) => {
                  if (previous.length === 0) return previous;
                  setCursor(previous[previous.length - 1]);
                  return previous.slice(0, -1);
                })
              }
            >
              ก่อนหน้า
            </button>
            <button
              type="button"
              disabled={!nextCursor}
              className="rounded border px-3 py-1 disabled:opacity-40"
              onClick={() => {
                if (!nextCursor) return;
                setCursorStack((previous) => [...previous, cursor]);
                setCursor(nextCursor);
              }}
            >
              ถัดไป
            </button>
          </div>
        </>
      )}
    </>
  );
}
