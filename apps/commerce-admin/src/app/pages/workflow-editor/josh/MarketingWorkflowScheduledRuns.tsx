// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getMarketingWorkflow,
  getMarketingWorkflowScheduledRuns,
  type MarketingWorkflow,
  type MarketingWorkflowScheduledRun,
} from './shared-api';
import { Table, TableColumn } from './shared-ui';
import AdminListHeader from './AdminListHeader';
import { ADMIN_ROUTES } from './admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
function formatSource(source: MarketingWorkflowScheduledRun['source']): string {
  return source === 'job_scheduler' ? 'BullMQ' : 'Cron safety net';
}

function formatStatus(run: MarketingWorkflowScheduledRun): string {
  if (run.status === 'fired') return __uiText("สำเร็จ");
  if (run.status === 'failed') return __uiText("ล้มเหลว");
  if (run.skipReason === 'not_due') return __uiText("ข้าม (ยังไม่ถึงเวลา)");
  if (run.skipReason === 'outside_schedule') return __uiText("ข้าม (นอก schedule)");
  if (run.skipReason === 'inactive_or_missing') return __uiText("ข้าม (ไม่ active)");
  if (run.skipReason === 'empty_audience') return __uiText("ข้าม (audience ว่าง)");
  return __uiText("ข้าม");
}

function statusClass(status: MarketingWorkflowScheduledRun['status']): string {
  if (status === 'failed') return 'text-red-600 font-semibold';
  if (status === 'skipped') return 'text-amber-600';
  return 'text-emerald-700 font-semibold';
}

export default function MarketingWorkflowScheduledRuns() {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<MarketingWorkflow | null>(null);
  const [runs, setRuns] = useState<MarketingWorkflowScheduledRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [wf, rows] = await Promise.all([
        getMarketingWorkflow(id).then((res) => res.data.data as MarketingWorkflow),
        getMarketingWorkflowScheduledRuns(id, { limit: 100 }),
      ]);
      setWorkflow(wf);
      setRuns(rows);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setError(message || __uiMessage("โหลดประวัติการยิงไม่สำเร็จ"));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: TableColumn<MarketingWorkflowScheduledRun>[] = [
    {
      key: 'firedAt',
      label: __uiText("เวลา"),
      render: (value: string) => new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')),
    },
    {
      key: 'source',
      label: __uiText("แหล่ง"),
      render: (value: MarketingWorkflowScheduledRun['source']) => formatSource(value),
    },
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (_value, row) => (
        <div>
          <span className={`text-xs ${statusClass(row.status)}`}>{formatStatus(row)}</span>
          {row.errorMessage && (
            <p className="mt-0.5 max-w-md truncate text-[11px] text-red-500" title={row.errorMessage}>
              {row.errorMessage}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'audienceCount',
      label: __uiText("Audience"),
      render: (value: number) => value.toLocaleString(),
    },
    {
      key: 'enrolledCount',
      label: __uiText("Enrolled"),
      render: (value: number) => (
        <span className="font-medium tabular-nums">{value.toLocaleString()}</span>
      ),
    },
  ];

  if (loading) {
    return <div className="cp-management-page text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={id ? ADMIN_ROUTES.marketingWorkflowEdit(id) : ADMIN_ROUTES.marketingWorkflows}
          className="text-xs text-primary hover:underline"
        >
          {__uiText("&larr; กลับไปหน้าแก้ไข Workflow")}</Link>
        <div className="flex items-center gap-3">
          <a
            href="/api/admin/queues"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-gray-600 hover:underline"
          >
            {__uiText("Queue Board ↗")}</a>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-primary hover:underline"
          >
            {__uiText("รีเฟรช")}</button>
        </div>
      </div>

      <AdminListHeader
        title={
          workflow
            ? __uiText("Scheduled fire log — {0}", {"0": workflow.name})
            : __uiText("Scheduled fire log")
        }
      />

      {workflow && workflow.trigger_type !== 'scheduled' && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {__uiText("Workflow นี้ไม่ใช่ trigger แบบ scheduled — จะมีประวัติก็ต่อเมื่อเคยเป็น scheduled และถูกยิงมาก่อน")}</p>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {(typeof error === 'string' ? __uiText(error) : error)}
        </p>
      )}

      {!error && runs.length === 0 ? (
        <p className="text-sm text-gray-400">
          {__uiText("ยังไม่มีประวัติการยิง — จะปรากฏหลัง activate และถึงเวลาที่ตั้งไว้")}</p>
      ) : (
        <Table columns={columns} data={runs} idKey="id" />
      )}
    </div>
  );
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
