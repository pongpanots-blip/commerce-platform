// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getMarketingScheduledRunOverview,
  type MarketingScheduledRunOverview,
  type MarketingWorkflowScheduledRun,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import AdminListHeader from '../../components/AdminListHeader';
import { ADMIN_ROUTES } from '../../config/admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Alert, Button, Chip, Panel, PanelHead, StatGrid, StatTile, type Tone } from "@cp/ui";
const DAY_OPTIONS = [1, 7, 30, 90] as const;

const RUN_STATUS: Record<MarketingWorkflowScheduledRun['status'], { label: string; tone: Tone }> = {
  fired: { label: 'สำเร็จ', tone: 'ok' },
  failed: { label: 'ล้มเหลว', tone: 'danger' },
  skipped: { label: 'ข้าม', tone: 'muted' },
};

const RUN_SOURCE_LABEL: Record<MarketingWorkflowScheduledRun['source'], string> = {
  job_scheduler: 'คิวตั้งเวลา',
  cron_sweep: 'รอบตรวจตามเวลา',
};

export default function MarketingQueueDashboard() {
  __useUiLocale();
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(7);
  const [bucket, setBucket] = useState<'hour' | 'day'>('hour');
  const [data, setData] = useState<MarketingScheduledRunOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getMarketingScheduledRunOverview({ days, bucket })
      .then(setData)
      .catch((err: { response?: { data?: { message?: string } } }) => {
        setError(err?.response?.data?.message || __uiMessage("โหลด queue overview ไม่สำเร็จ"));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [days, bucket]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (days === 1) setBucket('hour');
    if (days >= 30) setBucket('day');
  }, [days]);

  const workflowColumns: TableColumn<MarketingScheduledRunOverview['byWorkflow'][number]>[] = [
    {
      key: 'workflowName',
      label: __uiText("ข้อความอัตโนมัติ"),
      render: (_value, row) => (
        <div>
          <Link
            to={ADMIN_ROUTES.marketingWorkflowScheduledRuns(row.workflowId)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {row.workflowName || row.workflowId.slice(0, 8)}
          </Link>
          <p className="font-mono text-[10px] text-gray-400">{row.workflowId.slice(0, 8)}…</p>
        </div>
      ),
    },
    {
      key: 'enrolled',
      label: __uiText("ลูกค้าที่เข้าร่วม"),
      align: 'right',
      render: (value: number) => (
        <span className="font-semibold tabular-nums">{value.toLocaleString()}</span>
      ),
    },
    {
      key: 'runs',
      label: __uiText("รอบ"),
      align: 'right',
      render: (_value: number, row) => (
        <span className="tabular-nums">
          {row.runs.toLocaleString()}
          {row.attempts > row.runs && (
            <span className="ml-1 text-[10px] text-gray-400" title={__uiText("รวมการลองส่งซ้ำอัตโนมัติ")}>
              {__uiText("(ลองส่ง {0} ครั้ง)", {"0": row.attempts.toLocaleString()})}</span>
          )}
        </span>
      ),
    },
    {
      key: 'audience',
      label: __uiText("กลุ่มเป้าหมาย"),
      align: 'right',
      render: (value: number) => (
        <span className="tabular-nums" title={__uiText("ใช้ยอดสูงสุดของแต่ละวันแล้วรวมกัน ไม่นับรอบซ้ำ")}>
          {value.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'failed',
      label: __uiText("ล้มเหลว"),
      align: 'right',
      render: (value: number) => (
        <span className={`tabular-nums ${value > 0 ? 'font-semibold text-danger' : 'text-gray-400'}`}>
          {value.toLocaleString()}
        </span>
      ),
    },
  ];

  const recentColumns: TableColumn<MarketingWorkflowScheduledRun>[] = [
    {
      key: 'firedAt',
      label: __uiText("เวลา"),
      render: (value: string) => new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')),
    },
    {
      key: 'workflowName',
      label: __uiText("ข้อความอัตโนมัติ"),
      render: (_value, row) => (
        <Link
          to={ADMIN_ROUTES.marketingWorkflowEdit(row.workflowId)}
          className="text-xs text-primary hover:underline"
        >
          {row.workflowName || row.workflowId.slice(0, 8)}
        </Link>
      ),
    },
    {
      key: 'source',
      label: __uiText("แหล่ง"),
      render: (value: MarketingWorkflowScheduledRun['source']) =>
        __uiText(RUN_SOURCE_LABEL[value] ?? value),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (_value, row) => {
        const status = RUN_STATUS[row.status];
        return status ? (
          <Chip tone={status.tone} statusCode={row.status} dot>{__uiText(status.label)}</Chip>
        ) : (
          <Chip>{row.status}</Chip>
        );
      },
    },
    {
      key: 'enrolledCount',
      label: __uiText("ลูกค้าที่เข้าร่วม"),
      align: 'right',
      render: (value: number) => <span className="tabular-nums">{value.toLocaleString()}</span>,
    },
  ];

  const topWorkflow = data?.byWorkflow[0] ?? null;

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("คิวงานการตลาด")}
        subtitle={__uiText("ข้อความการตลาดที่รอส่งและที่ส่งแล้ว")}
      >
        <a
          href="/api/admin/queues"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center rounded-lg px-3.5 py-2 text-[13px] font-medium text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
        >
          {__uiText("ดูคิวในระบบเบื้องหลัง ↗")}</a>
        <Button icon="refresh" onClick={load} disabled={loading}>
          {loading ? __uiText("กำลังโหลด...") : __uiText("รีเฟรช")}
        </Button>
      </AdminListHeader>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-gray-500">{__uiText("ช่วง")}</span>
        {DAY_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setDays(option)}
            className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
              days === option
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {option === 1 ? __uiText("24 ชม.") : __uiText("{0} วัน", {"0": option})}
          </button>
        ))}
        <span className="ml-2 text-[11px] font-medium text-gray-500">{__uiText("แบ่งตาม")}</span>
        {(['hour', 'day'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setBucket(option)}
            className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
              bucket === option
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {option === 'hour' ? __uiText("ชั่วโมง") : __uiText("วัน")}
          </button>
        ))}
      </div>

      {error && (
        <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert>
      )}

      {data && (
        <>
          <StatGrid cols={6}>
            <StatTile
              label={__uiText("รอบ")}
              value={data.totals.runs.toLocaleString()}
              foot={
                data.totals.attempts > data.totals.runs
                  ? __uiText("ลองส่ง {0} ครั้ง (รวมการลองซ้ำอัตโนมัติ)", {"0": data.totals.attempts.toLocaleString()})
                  : __uiText("นับครั้งเดียวต่อรอบต่อวัน")
              }
            />
            <StatTile label={__uiText("ส่งสำเร็จ (ครั้งที่ลอง)")} value={data.totals.fired.toLocaleString()} />
            <StatTile label={__uiText("ล้มเหลว")} tone={data.totals.failed > 0 ? 'danger' : undefined} value={data.totals.failed.toLocaleString()} />
            <StatTile label={__uiText("ข้าม")} value={data.totals.skipped.toLocaleString()} />
            <StatTile
              label={__uiText("ลูกค้าที่เข้าร่วมรวม")}
              value={data.totals.enrolled.toLocaleString()}
              foot={__uiText("ลูกค้าที่เข้าสู่ข้อความอัตโนมัติ")}
            />
            <StatTile
              label={__uiText("กลุ่มเป้าหมาย")}
              value={data.totals.audience.toLocaleString()}
              foot={__uiText("ใช้ยอดสูงสุดของแต่ละวันแล้วรวมกัน")}
            />
          </StatGrid>

          {topWorkflow && (
            <Alert tone="info">
              {__uiText("ช่วงนี้มีลูกค้าเข้าร่วมมากที่สุด:")}{' '}
              <Link
                to={ADMIN_ROUTES.marketingWorkflowEdit(topWorkflow.workflowId)}
                className="font-semibold underline"
              >
                {topWorkflow.workflowName || topWorkflow.workflowId}
              </Link>{' '}
              — {__uiText("ลูกค้าเข้าร่วม {0} คน จาก {1} รอบ", {"0": topWorkflow.enrolled.toLocaleString(), "1": topWorkflow.runs.toLocaleString()})}</Alert>
          )}

          <Panel className="p-3">
            <p className="mb-2 text-xs font-semibold text-gray-700">
              {__uiText("ลูกค้าที่เข้าร่วมตามช่วงเวลา")}{' '}
              <span className="font-normal text-gray-400">({data.timezone}, {data.bucket === 'hour' ? __uiText("ชั่วโมง") : __uiText("วัน")})</span>
            </p>
            {data.byBucket.length === 0 ? (
              <p className="text-xs text-gray-400">{__uiText("ยังไม่มีข้อมูลในช่วงนี้")}</p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byBucket}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="enrolled" name={__uiText("ลูกค้าที่เข้าร่วม")} fill="#059669" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="runs" name={__uiText("รอบ")} fill="#94a3b8" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHead title={__uiText("ข้อความอัตโนมัติที่มีลูกค้าเข้าร่วมมากที่สุด")} />
              <Table
                columns={workflowColumns}
                data={data.byWorkflow}
                idKey="workflowId"
                emptyTitle="ยังไม่มีการส่งในช่วงนี้"
                emptyDescription={__uiText("ลองเลือกช่วงเวลาที่ยาวขึ้น")}
              />
            </Panel>

            <Panel>
              <PanelHead title={__uiText("การส่งล่าสุด")} />
              <Table
                columns={recentColumns}
                data={data.recentRuns}
                idKey="id"
                emptyTitle="ยังไม่มีการส่งในช่วงนี้"
                emptyDescription={__uiText("ลองเลือกช่วงเวลาที่ยาวขึ้น")}
              />
            </Panel>
          </div>
        </>
      )}

      {!data && !error && !loading && (
        <p className="text-sm text-gray-400">{__uiText("ยังไม่มีข้อมูล")}</p>
      )}
    </div>
  );
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
