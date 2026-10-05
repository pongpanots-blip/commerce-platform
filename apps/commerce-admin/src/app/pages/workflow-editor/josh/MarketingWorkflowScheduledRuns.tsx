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

function formatSource(source: MarketingWorkflowScheduledRun['source']): string {
  return source === 'job_scheduler' ? 'BullMQ' : 'Cron safety net';
}

function formatStatus(run: MarketingWorkflowScheduledRun): string {
  if (run.status === 'fired') return 'สำเร็จ';
  if (run.status === 'failed') return 'ล้มเหลว';
  if (run.skipReason === 'not_due') return 'ข้าม (ยังไม่ถึงเวลา)';
  if (run.skipReason === 'outside_schedule') return 'ข้าม (นอก schedule)';
  if (run.skipReason === 'inactive_or_missing') return 'ข้าม (ไม่ active)';
  if (run.skipReason === 'empty_audience') return 'ข้าม (audience ว่าง)';
  return 'ข้าม';
}

function statusClass(status: MarketingWorkflowScheduledRun['status']): string {
  if (status === 'failed') return 'text-red-600 font-semibold';
  if (status === 'skipped') return 'text-amber-600';
  return 'text-emerald-700 font-semibold';
}

export default function MarketingWorkflowScheduledRuns() {
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
      setError(message || 'โหลดประวัติการยิงไม่สำเร็จ');
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
      label: 'เวลา',
      render: (value: string) => new Date(value).toLocaleString('th-TH'),
    },
    {
      key: 'source',
      label: 'แหล่ง',
      render: (value: MarketingWorkflowScheduledRun['source']) => formatSource(value),
    },
    {
      key: 'status',
      label: 'สถานะ',
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
      label: 'Audience',
      render: (value: number) => value.toLocaleString(),
    },
    {
      key: 'enrolledCount',
      label: 'Enrolled',
      render: (value: number) => (
        <span className="font-medium tabular-nums">{value.toLocaleString()}</span>
      ),
    },
  ];

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          to={id ? ADMIN_ROUTES.marketingWorkflowEdit(id) : ADMIN_ROUTES.marketingWorkflows}
          className="text-xs text-primary hover:underline"
        >
          &larr; กลับไปหน้าแก้ไข Workflow
        </Link>
        <div className="flex items-center gap-3">
          <a
            href="/api/admin/queues"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-gray-600 hover:underline"
          >
            Queue Board ↗
          </a>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs text-primary hover:underline"
          >
            รีเฟรช
          </button>
        </div>
      </div>

      <AdminListHeader
        title={
          workflow
            ? `Scheduled fire log — ${workflow.name}`
            : 'Scheduled fire log'
        }
      />

      {workflow && workflow.trigger_type !== 'scheduled' && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Workflow นี้ไม่ใช่ trigger แบบ scheduled — จะมีประวัติก็ต่อเมื่อเคยเป็น scheduled และถูกยิงมาก่อน
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {!error && runs.length === 0 ? (
        <p className="text-sm text-gray-400">
          ยังไม่มีประวัติการยิง — จะปรากฏหลัง activate และถึงเวลาที่ตั้งไว้
        </p>
      ) : (
        <Table columns={columns} data={runs} idKey="id" />
      )}
    </div>
  );
}
