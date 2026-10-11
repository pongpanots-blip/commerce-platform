// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
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

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Chip, type Tone } from "@cp/ui";
const CHANNEL_OPTIONS = [
  { value: '', get label(){return __uiText("ทุกช่องทาง");} },
  { value: 'push', get label(){return __uiText("แจ้งเตือนบนมือถือ");} },
  { value: 'inapp', get label(){return __uiText("ในแอป");} },
  { value: 'email', get label(){return __uiText("อีเมล");} },
] as const;

const STATUS_OPTIONS = [
  { value: '', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'sent', get label(){return __uiText("ส่งสำเร็จ");} },
  { value: 'skipped', get label(){return __uiText("ไม่ได้ส่ง");} },
  { value: 'failed', get label(){return __uiText("ล้มเหลว");} },
] as const;

/** แปลเหตุผลของระบบเป็นภาษาที่ทีมซัพพอร์ตใช้ตอบลูกค้าได้ทันที */
const REASON_LABEL: Record<string, string> = {
  get type_disabled(){return __uiText("ปิดการแจ้งเตือนประเภทนี้ไว้ทั้งระบบ");},
  get channel_not_allowed(){return __uiText("ไม่อนุญาตช่องทางนี้สำหรับการแจ้งเตือนประเภทนี้");},
  get preference_off(){return __uiText("ลูกค้าปิดรับช่องทางนี้เอง");},
  get not_requested(){return __uiText("ผู้เรียกเลือกส่งเฉพาะช่องทางอื่น");},
  get duplicate(){return __uiText("ซ้ำกับใบที่ส่งไปแล้ว");},
  get not_configured(){return __uiText("ยังไม่ได้ตั้งค่า OneSignal");},
};

/** ป้ายช่องทางสำหรับแสดงผล — ค่าที่ส่งไป API ยังเป็นรหัสเดิม */
export const CHANNEL_LABEL: Record<string, string> = {
  get push(){return __uiText("แจ้งเตือนบนมือถือ");},
  get inapp(){return __uiText("ในแอป");},
  get email(){return __uiText("อีเมล");},
};

export const channelLabel = (channel: string) => CHANNEL_LABEL[channel] ?? channel;

const STATUS_TONE: Record<NotificationDeliveryStatus, Tone> = {
  sent: 'ok',
  skipped: 'muted',
  failed: 'danger',
};

const STATUS_LABEL: Record<NotificationDeliveryStatus, string> = {
  get sent(){return __uiText("ส่งสำเร็จ");},
  get skipped(){return __uiText("ไม่ได้ส่ง");},
  get failed(){return __uiText("ล้มเหลว");},
};

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB'), {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

export function describeReason(reason: string | null): string {
  if (!reason) return '—';
  return REASON_LABEL[reason] ?? reason;
}

/**
 * log ดิบทีละแถว — ใช้ตอบเคส "ลูกค้าบอกว่าไม่ได้รับแจ้งเตือน" ซึ่งยอดสรุป
 * ในแท็บภาพรวมตอบไม่ได้ ค้นด้วย userId แล้วอ่านคอลัมน์ "เหตุผล" ได้เลย
 */
export default function NotificationDeliveryLogTab() {
  __useUiLocale();
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
        setError(__uiMessage("ไม่สามารถโหลด log การส่งได้"));
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
      label: __uiText("เวลา"),
      render: (value: string) => (
        <span className="whitespace-nowrap text-xs tabular-nums">{formatDateTime(value)}</span>
      ),
    },
    {
      key: 'userId',
      label: __uiText("ผู้ใช้"),
      render: (value: string) => (
        <Link
          to={ADMIN_ROUTES.userDetail(value)}
          className="font-mono text-xs text-primary hover:underline"
        >
          {value.slice(0, 8)}…
        </Link>
      ),
    },
    {
      key: 'type',
      label: __uiText("ประเภท"),
      render: (value: string) => <Chip className="font-mono">{value}</Chip>,
    },
    { key: 'channel', label: __uiText("ช่องทาง"), render: (value: string) => channelLabel(value) },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: NotificationDeliveryStatus) => (
        <Chip tone={STATUS_TONE[value] ?? 'muted'} statusCode={value} dot>
          {STATUS_LABEL[value] ?? value}
        </Chip>
      ),
    },
    {
      key: 'reason',
      label: __uiText("เหตุผล"),
      render: (value: string | null) => (
        <span className="text-xs text-gray-600">{describeReason(value)}</span>
      ),
    },
    {
      key: 'clickedAt',
      label: __uiText("กดเปิด"),
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
          <span className="text-xs text-gray-500">{__uiText("รหัสผู้ใช้ (User ID)")}</span>
          <input
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{__uiText("ประเภทการแจ้งเตือน")}</span>
          <input
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder={__uiText("ประเภท เช่น order_shipped")}
            value={type}
            onChange={(event) => setType(event.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{__uiText("ช่องทาง")}</span>
          <Select
            aria-label={__uiText("ช่องทาง")}
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
          <span className="text-xs text-gray-500">{__uiText("สถานะ")}</span>
          <Select
            aria-label={__uiText("สถานะ")}
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
          {__uiText("ค้นหา")}</button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : (
        <>
          <Table
            columns={columns}
            data={rows}
            idKey="id"
            emptyTitle={__uiText("ไม่พบรายการส่งในเงื่อนไขนี้")}
            emptyDescription={__uiText("ลองเปลี่ยนตัวกรอง ระบบเก็บรายการส่งย้อนหลัง 90 วัน นับจากวันที่เริ่มเก็บ")}
          />
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
              {__uiText("ก่อนหน้า")}</button>
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
              {__uiText("ถัดไป")}</button>
          </div>
        </>
      )}
    </>
  );
}
