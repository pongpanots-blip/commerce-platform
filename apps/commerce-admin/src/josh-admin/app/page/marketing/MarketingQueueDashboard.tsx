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
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const DAY_OPTIONS = [1, 7, 30, 90] as const;

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

function formatStatus(run: MarketingWorkflowScheduledRun): string {
  if (run.status === 'fired') return __uiText("สำเร็จ");
  if (run.status === 'failed') return __uiText("ล้มเหลว");
  return __uiText("ข้าม");
}

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
      label: __uiText("Workflow"),
      render: (_value, row) => (
        <div>
          <Link
            to={ADMIN_ROUTES.marketingWorkflowScheduledRuns(row.workflowId)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {row.workflowName || row.workflowId.slice(0, 8)}
          </Link>
          <p className="text-[10px] text-gray-400">{row.workflowId.slice(0, 8)}…</p>
        </div>
      ),
    },
    {
      key: 'enrolled',
      label: __uiText("Enrolled"),
      render: (value: number) => (
        <span className="font-semibold tabular-nums text-emerald-700">{value.toLocaleString()}</span>
      ),
    },
    {
      key: 'runs',
      label: __uiText("รอบ"),
      render: (_value: number, row) => (
        <span className="tabular-nums">
          {row.runs.toLocaleString()}
          {row.attempts > row.runs && (
            <span className="ml-1 text-[10px] text-gray-400" title={__uiText("รวม safety-net retries")}>
              ({row.attempts} {__uiText(" attempts)")}</span>
          )}
        </span>
      ),
    },
    {
      key: 'audience',
      label: __uiText("Audience"),
      render: (value: number) => (
        <span className="tabular-nums" title={__uiText("max ต่อวัน แล้วรวม — ไม่บวก cron ซ้ำ")}>
          {value.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'failed',
      label: __uiText("Failed"),
      render: (value: number) => (
        <span className={value > 0 ? 'font-semibold text-red-600' : 'text-gray-400'}>
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
      label: __uiText("Workflow"),
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
        value === 'job_scheduler' ? 'BullMQ' : 'Cron',
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (_value, row) => (
        <span
          className={
            row.status === 'failed'
              ? 'text-red-600'
              : row.status === 'skipped'
                ? 'text-amber-600'
                : 'text-emerald-700'
          }
        >
          {formatStatus(row)}
        </span>
      ),
    },
    {
      key: 'enrolledCount',
      label: __uiText("Enrolled"),
      render: (value: number) => value.toLocaleString(),
    },
  ];

  const topWorkflow = data?.byWorkflow[0] ?? null;

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AdminListHeader
          title={__uiText("Marketing Queue")}
          subtitle={__uiText("ภาพรวม BullMQ scheduled fires ข้ามทุก workflow — ดูว่าช่วงไหน / workflow ไหน enroll เยอะสุด")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/admin/queues"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            {__uiText("Bull Board ↗")}</a>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? __uiText("กำลังโหลด...") : __uiText("รีเฟรช")}
          </button>
        </div>
      </div>

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
        <span className="ml-2 text-[11px] font-medium text-gray-500">{__uiText("Bucket")}</span>
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
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {(typeof error === 'string' ? __uiText(error) : error)}
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Tile
              label={__uiText("รอบ")}
              value={data.totals.runs.toLocaleString()}
              hint={
                data.totals.attempts > data.totals.runs
                  ? __uiText("{0} attempts (รวม safety net)", {"0": data.totals.attempts})
                  : __uiText("occurrence ต่อวัน")
              }
            />
            <Tile label={__uiText("สำเร็จ (attempts)")} value={data.totals.fired.toLocaleString()} />
            <Tile label={__uiText("Failed")} value={data.totals.failed.toLocaleString()} />
            <Tile label={__uiText("Skipped")} value={data.totals.skipped.toLocaleString()} />
            <Tile
              label={__uiText("Enrolled รวม")}
              value={data.totals.enrolled.toLocaleString()}
              hint={__uiText("คนที่ได้เข้า workflow")}
            />
            <Tile
              label={__uiText("Audience")}
              value={data.totals.audience.toLocaleString()}
              hint={__uiText("max ต่อวัน แล้วรวม")}
            />
          </div>

          {topWorkflow && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {__uiText("ช่วงนี้ enroll เยอะสุด:")}{' '}
              <Link
                to={ADMIN_ROUTES.marketingWorkflowEdit(topWorkflow.workflowId)}
                className="font-semibold underline"
              >
                {topWorkflow.workflowName || topWorkflow.workflowId}
              </Link>{' '}
              — {topWorkflow.enrolled.toLocaleString()} {__uiText(" enrolled จาก ")}{topWorkflow.runs.toLocaleString()}{' '}
              {__uiText("fires")}</div>
          )}

          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold text-gray-700">
              {__uiText("Enrolled ตามเวลา (")}{data.timezone}, {data.bucket})
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
                    <Bar dataKey="enrolled" name="Enrolled" fill="#059669" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="runs" name="รอบ" fill="#94a3b8" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-gray-700">
                {__uiText("Workflow ที่ enroll เยอะสุด")}</p>
              {data.byWorkflow.length === 0 ? (
                <p className="text-xs text-gray-400">{__uiText("ยังไม่มี fire log")}</p>
              ) : (
                <Table columns={workflowColumns} data={data.byWorkflow} idKey="workflowId" />
              )}
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold text-gray-700">{__uiText("Fires ล่าสุด")}</p>
              {data.recentRuns.length === 0 ? (
                <p className="text-xs text-gray-400">{__uiText("ยังไม่มี fire log")}</p>
              ) : (
                <Table columns={recentColumns} data={data.recentRuns} idKey="id" />
              )}
            </div>
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
