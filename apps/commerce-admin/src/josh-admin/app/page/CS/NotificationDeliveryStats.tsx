import {
  getNotificationDeliveryStats,
  type NotificationDeliveryChannel,
  type NotificationDeliveryStats,
  type NotificationDeliveryStatsRow,
} from '@josh/shared-api';
import { Select, Table, TableColumn } from '@josh/shared-ui-web';
import { useCallback, useEffect, useState } from 'react';
import AdminListHeader from '../../components/AdminListHeader';
import NotificationDeliveryLogTab from './NotificationDeliveryLogTab';

const CHANNEL_OPTIONS = [
  { value: '', label: 'ทุกช่องทาง' },
  { value: 'push', label: 'Push' },
  { value: 'inapp', label: 'In-app' },
  { value: 'email', label: 'Email' },
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

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/**
 * สรุปผลการส่งแจ้งเตือนจาก delivery log บน Mongo — ส่งถึงกี่ใบ ล้มเหลวเพราะอะไร
 * ผู้ใช้ปิดรับไปเท่าไหร่ และกดเปิดกี่เปอร์เซ็นต์ อ่านอย่างเดียว
 */
type Tab = 'summary' | 'log';

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'summary', label: 'ภาพรวม', hint: 'อัตราส่งถึงและอัตราการกด แยกตามประเภท' },
  { key: 'log', label: 'Log ดิบ', hint: 'ไล่ทีละแถวว่าใครได้/ไม่ได้รับ และเพราะอะไร' },
];

export default function NotificationDeliveryStatsPage() {
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
      setError('ไม่สามารถโหลดสถิติการส่งแจ้งเตือนได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // โหลดเฉพาะแท็บที่เปิดอยู่ — สองแท็บยิงคนละ endpoint
    if (tab === 'summary') void load(query);
  }, [tab, query, load]);

  const totals = stats?.totals ?? EMPTY_TOTALS;

  const columns: TableColumn<NotificationDeliveryStatsRow>[] = [
    { key: 'type', label: 'ประเภท' },
    { key: 'channel', label: 'ช่องทาง' },
    { key: 'attempted', label: 'ตั้งใจส่ง' },
    { key: 'sent', label: 'ส่งสำเร็จ' },
    { key: 'failed', label: 'ล้มเหลว' },
    { key: 'skipped', label: 'ไม่ได้ส่ง' },
    {
      key: 'deliveryRate',
      label: 'อัตราส่งถึง',
      render: (value: number) => percent(value),
    },
    { key: 'clicked', label: 'กดเปิด' },
    {
      key: 'clickRate',
      label: 'อัตราการกด',
      render: (value: number) => percent(value),
    },
  ];

  return (
    <div className="p-6">
      <AdminListHeader
        title="Notification Delivery Stats"
        subtitle="ผลการส่งแจ้งเตือนแยกตามประเภทและช่องทาง รวมใบที่ไม่ได้ส่งเพราะผู้ใช้ปิดรับ (อ่านอย่างเดียว)"
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
          <span className="text-xs text-gray-500">ตั้งแต่วันที่</span>
          <input
            type="date"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">ถึงวันที่</span>
          <input
            type="date"
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">ช่องทาง</span>
          <Select
            aria-label="ช่องทาง"
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
          <span className="text-xs text-gray-500">ประเภทการแจ้งเตือน</span>
          <input
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="ประเภท เช่น order_shipped"
            value={type}
            onChange={(event) => setType(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="self-end rounded-lg bg-primary px-4 py-2 text-sm text-white"
          onClick={() => setQuery({ from, to, channel: channel as never, type: type.trim() })}
        >
          กรองข้อมูล
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          label="ส่งสำเร็จ"
          value={String(totals.sent)}
          hint={`จากที่ตั้งใจส่ง ${totals.attempted} · ${percent(totals.deliveryRate)}`}
        />
        <Tile label="ล้มเหลว" value={String(totals.failed)} hint="ดูสาเหตุด้านล่าง" />
        <Tile
          label="ไม่ได้ส่ง"
          value={String(totals.skipped)}
          hint="ส่วนใหญ่คือผู้ใช้ปิดรับเอง"
        />
        <Tile
          label="กดเปิด"
          value={String(totals.clicked)}
          hint={`${percent(totals.clickRate)} ของที่ส่งสำเร็จ`}
        />
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">กำลังโหลด...</p>
      ) : (
        <>
          <Table
            columns={columns}
            data={stats?.byTypeChannel ?? []}
            idKey={'type' as never}
          />
          {!stats?.byTypeChannel.length && (
            <p className="mt-3 text-sm text-gray-400">
              ยังไม่มีข้อมูลในช่วงนี้ — delivery log เริ่มเก็บตั้งแต่วันที่เปิดใช้งานฟีเจอร์นี้
              และเก็บย้อนหลัง 90 วัน
            </p>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-100 bg-white p-5">
              <p className="mb-3 text-sm font-semibold">สาเหตุที่ไม่ถึงผู้ใช้</p>
              {stats?.topSkipAndFailReasons.length ? (
                <ul className="space-y-1 text-sm">
                  {stats.topSkipAndFailReasons.map((row) => (
                    <li key={row.reason} className="flex justify-between">
                      <span className="font-mono text-xs text-gray-600">{row.reason}</span>
                      <span>{row.count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">ไม่มี</p>
              )}
            </div>

            <div className="rounded-xl border border-gray-100 bg-white p-5">
              <p className="mb-3 text-sm font-semibold">รายวัน</p>
              {stats?.byDay.length ? (
                <ul className="space-y-1 text-sm">
                  {stats.byDay.map((row) => (
                    <li key={row.date} className="flex justify-between">
                      <span className="text-gray-600">{row.date}</span>
                      <span>
                        ส่ง {row.sent} · ล้มเหลว {row.failed} · กด {row.clicked}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">ไม่มี</p>
              )}
            </div>
          </div>
        </>
      )}
      </>
      )}
    </div>
  );
}
