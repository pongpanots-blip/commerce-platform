// ui-metadata-migration: static labels and UI notices only
import {
  getNotificationDeliveryStats,
  type NotificationDeliveryChannel,
  type NotificationDeliveryStats,
  type NotificationDeliveryStatsRow,
} from '@josh/shared-api';
import { Select, Table, TableColumn } from '@josh/shared-ui-web';
import { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import NotificationDeliveryLogTab, { channelLabel, describeReason } from './NotificationDeliveryLogTab';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Chip, StatTile } from "@cp/ui";
const CHANNEL_OPTIONS = [
  { value: '', get label(){return __uiText("ทุกช่องทาง");} },
  { value: 'push', get label(){return __uiText("แจ้งเตือนบนมือถือ");} },
  { value: 'inapp', get label(){return __uiText("ในแอป");} },
  { value: 'email', get label(){return __uiText("อีเมล");} },
] as const;

const EMPTY_TOTALS: NotificationDeliveryStats['totals'] = {
  attempted: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  clicked: 0,
  deliveryRate: 0,
  clickRate: 0,
};

/** backend ส่ง rate มาเป็น 0–1 แล้ว หน้าจอแค่แสดงผล ไม่คำนวณเอง */
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

const toDateInput = (date: Date) => date.toISOString().slice(0, 10);

const num = (value: number) => value.toLocaleString();

/**
 * สรุปผลการส่งแจ้งเตือนจาก delivery log บน Mongo — ส่งถึงกี่ใบ ล้มเหลวเพราะอะไร
 * ผู้ใช้ปิดรับไปเท่าไหร่ และกดเปิดกี่เปอร์เซ็นต์ อ่านอย่างเดียว
 */
type Tab = 'summary' | 'log';

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'summary', get label(){return __uiText("ภาพรวม");}, get hint(){return __uiText("อัตราส่งถึงและอัตราการกด แยกตามประเภท");} },
  { key: 'log', get label(){return __uiText("รายการส่งทีละรายการ");}, get hint(){return __uiText("ไล่ทีละแถวว่าใครได้/ไม่ได้รับ และเพราะอะไร");} },
];

export default function NotificationDeliveryStatsPage() {
  __useUiLocale();
  const [tab, setTab] = useState<Tab>('summary');
  const defaultTo = new Date();
  const defaultFrom = new Date(defaultTo.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [from, setFrom] = useState(toDateInput(defaultFrom));
  const [to, setTo] = useState(toDateInput(defaultTo));
  const [channel, setChannel] = useState<NotificationDeliveryChannel | ''>('');
  const [type, setType] = useState('');
  const [query, setQuery] = useState({ from, to, channel: '' as const, type: '' });
  const [stats, setStats] = useState<NotificationDeliveryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (params: typeof query) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getNotificationDeliveryStats({
        from: params.from ? new Date(`${params.from}T00:00:00`).toISOString() : undefined,
        to: params.to ? new Date(`${params.to}T23:59:59`).toISOString() : undefined,
        channel: (params.channel || undefined) as NotificationDeliveryChannel | undefined,
        type: params.type || undefined,
      });
      setStats(response.data.data);
    } catch {
      setStats(null);
      setError(__uiMessage("ไม่สามารถโหลดสถิติการส่งแจ้งเตือนได้"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // โหลดเฉพาะแท็บที่เปิดอยู่ — สองแท็บยิงคนละ endpoint
    if (tab === 'summary') void load(query);
  }, [tab, query, load]);

  const totals = stats?.totals ?? EMPTY_TOTALS;

  const numCell = (value: number) => <span className="tabular-nums">{num(value)}</span>;
  const pctCell = (value: number) => <span className="tabular-nums">{percent(value)}</span>;
  const columns: TableColumn<NotificationDeliveryStatsRow>[] = [
    {
      key: 'type',
      label: __uiText("ประเภท"),
      render: (value: string) => <Chip className="font-mono">{value}</Chip>,
    },
    { key: 'channel', label: __uiText("ช่องทาง"), render: (value: string) => channelLabel(value) },
    { key: 'attempted', label: __uiText("ตั้งใจส่ง"), align: 'right', render: numCell },
    { key: 'sent', label: __uiText("ส่งสำเร็จ"), align: 'right', render: numCell },
    { key: 'failed', label: __uiText("ล้มเหลว"), align: 'right', render: numCell },
    { key: 'skipped', label: __uiText("ไม่ได้ส่ง"), align: 'right', render: numCell },
    { key: 'deliveryRate', label: __uiText("อัตราส่งถึง"), align: 'right', render: pctCell },
    { key: 'clicked', label: __uiText("กดเปิด"), align: 'right', render: numCell },
    { key: 'clickRate', label: __uiText("อัตราการกด"), align: 'right', render: pctCell },
  ];

  return (
    <div className="p-6">
      <AdminListHeader
        title={__uiText("สถิติการส่งแจ้งเตือน")}
        subtitle={__uiText("สถิติการส่งแจ้งเตือนที่สำเร็จและไม่สำเร็จ")}
      />

      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            title={item.hint}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              tab === item.key
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'log' && <NotificationDeliveryLogTab />}

      {tab === 'summary' && (
      <>
      <div className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{__uiText("ตั้งแต่วันที่")}</span>
          <input
            type="date"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{__uiText("ถึงวันที่")}</span>
          <input
            type="date"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{__uiText("ช่องทาง")}</span>
          <Select
            aria-label={__uiText("ช่องทาง")}
            value={channel}
            onChange={(event) =>
              setChannel(event.target.value as NotificationDeliveryChannel | '')
            }
          >
            {CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{__uiText("ประเภทการแจ้งเตือน")}</span>
          <input
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder={__uiText("ประเภท เช่น order_shipped")}
            value={type}
            onChange={(event) => setType(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="self-end rounded-lg bg-primary px-4 py-2 text-sm text-white"
          onClick={() => setQuery({ from, to, channel: channel as never, type: type.trim() })}
        >
          {__uiText("กรองข้อมูล")}</button>
      </div>

      {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">{__uiText(error)}</p>
        <button type="button" className="mt-3 min-h-10 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm" onClick={() => void load(query)} disabled={loading}>{__uiText('ลองอีกครั้ง')}</button>
      </div>}

      {!loading && !error && stats && <>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={__uiText("ส่งสำเร็จ")}
          value={num(totals.sent)}
          foot={__uiText("จากที่ตั้งใจส่ง {0} · {1}", {"0": num(totals.attempted), "1": percent(totals.deliveryRate)})}
        />
        <StatTile label={__uiText("ล้มเหลว")} value={num(totals.failed)} tone={totals.failed > 0 ? 'danger' : undefined} foot={__uiText("ดูสาเหตุด้านล่าง")} />
        <StatTile
          label={__uiText("ไม่ได้ส่ง")}
          value={num(totals.skipped)}
          foot={__uiText("ส่วนใหญ่คือผู้ใช้ปิดรับเอง")}
        />
        <StatTile
          label={__uiText("กดเปิด")}
          value={num(totals.clicked)}
          foot={__uiText("{0} ของที่ส่งสำเร็จ", {"0": percent(totals.clickRate)})}
        />
      </div>
      </>}

      {loading ? (
        <p className="text-sm text-gray-500">{__uiText("กำลังโหลด...")}</p>
      ) : !error && stats ? (
        <>
          <Table
            columns={columns}
            data={stats?.byTypeChannel ?? []}
            idKey={'type' as never}
            emptyTitle={__uiText("ยังไม่มีข้อมูลการส่งในช่วงนี้")}
            emptyDescription={__uiText("ลองเลือกช่วงวันที่หรือตัวกรองอื่น ระบบเก็บข้อมูลการส่งย้อนหลัง 90 วัน")}
          />

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-white p-5">
              <p className="mb-3 text-sm font-semibold">{__uiText("สาเหตุที่ไม่ถึงผู้ใช้")}</p>
              {stats?.topSkipAndFailReasons.length ? (
                <ul className="space-y-1 text-sm">
                  {stats.topSkipAndFailReasons.map((row) => (
                    <li key={row.reason} className="flex justify-between gap-3">
                      <span className="text-xs text-gray-600" title={row.reason}>{describeReason(row.reason)}</span>
                      <span className="tabular-nums">{num(row.count)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">{__uiText("ไม่มี")}</p>
              )}
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-5">
              <p className="mb-3 text-sm font-semibold">{__uiText("รายวัน")}</p>
              {stats?.byDay.length ? (
                <ul className="space-y-1 text-sm">
                  {stats.byDay.map((row) => (
                    <li key={row.date} className="flex justify-between">
                      <span className="tabular-nums text-gray-600">{row.date}</span>
                      <span className="tabular-nums">
                        {__uiText("ส่ง ")}{row.sent} {__uiText(" · ล้มเหลว ")}{row.failed} {__uiText(" · กด ")}{row.clicked}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">{__uiText("ไม่มี")}</p>
              )}
            </div>
          </div>
        </>
      ) : null}
      </>
      )}
    </div>
  );
}
