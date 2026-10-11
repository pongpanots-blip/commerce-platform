// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getMarketingWorkflow,
  getMarketingWorkflowScheduledRuns,
  type MarketingWorkflow,
  type MarketingWorkflowScheduledRun,
} from './shared-api';
import { Table, TableColumn } from './shared-ui';
import { ADMIN_ROUTES } from './admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { Alert, Button, Chip, PageHeader, type Tone, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
function formatSource(source: MarketingWorkflowScheduledRun['source']): string {
  return source === 'job_scheduler' ? __uiText('ตามรอบปกติ') : __uiText('รอบสำรอง');
}

function formatStatus(run: MarketingWorkflowScheduledRun): string {
  if (run.status === 'fired') return __uiText("สำเร็จ");
  if (run.status === 'failed') return __uiText("ล้มเหลว");
  if (run.skipReason === 'not_due') return __uiText("ข้าม (ยังไม่ถึงเวลา)");
  if (run.skipReason === 'outside_schedule') return __uiText("ข้าม (นอกช่วงเวลาที่ตั้งไว้)");
  if (run.skipReason === 'inactive_or_missing') return __uiText("ข้าม (ไม่ได้เปิดใช้งาน)");
  if (run.skipReason === 'empty_audience') return __uiText("ข้าม (ไม่มีลูกค้าเข้าเงื่อนไข)");
  return __uiText("ข้าม");
}

function statusTone(status: MarketingWorkflowScheduledRun['status']): Tone {
  if (status === 'failed') return 'danger';
  if (status === 'skipped') return 'warn';
  return 'ok';
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
      setError(message || __uiMessage("โหลดประวัติการส่งตามเวลาไม่สำเร็จ"));
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
          <Chip tone={statusTone(row.status)} statusCode={row.status} dot>{formatStatus(row)}</Chip>
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
      label: __uiText("ลูกค้าที่เข้าเงื่อนไข"),
      align: 'right',
      render: (value: number) => <span className="tabular-nums">{value.toLocaleString('en-US')}</span>,
    },
    {
      key: 'enrolledCount',
      label: __uiText("ลูกค้าที่เข้าแล้ว"),
      align: 'right',
      render: (value: number) => (
        <span className="font-medium tabular-nums">{value.toLocaleString('en-US')}</span>
      ),
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <PageHeader
        back={{ to: id ? ADMIN_ROUTES.marketingWorkflowEdit(id) : ADMIN_ROUTES.marketingWorkflows, label: 'กลับไปหน้าแก้ข้อความอัตโนมัติ' }}
        title={
          workflow
            ? __uiText("ประวัติการส่งตามเวลา — {0}", {"0": workflow.name})
            : __uiText("ประวัติการส่งตามเวลา")
        }
        subtitle={__uiText("แต่ละรอบที่ถึงเวลาส่ง ส่งได้กี่คน หรือข้ามเพราะอะไร")}
        actions={
          <>
            <a href="/api/admin/queues" target="_blank" rel="noreferrer" className="text-xs text-gray-600 hover:underline">
              {__uiText("ดูคิวงานของระบบ ↗")}</a>
            <Button size="sm" icon="refresh" onClick={() => void load()}>{__uiText("รีเฟรช")}</Button>
          </>
        }
      />

      {workflow && workflow.trigger_type !== 'scheduled' && (
        <Alert tone="warn">
          {__uiText("ข้อความอัตโนมัตินี้ไม่ได้เริ่มตามเวลา — จะมีประวัติก็ต่อเมื่อเคยตั้งให้ส่งตามเวลามาก่อน")}</Alert>
      )}

      {error && (
        <Alert tone="danger">
          {(typeof error === 'string' ? __uiText(error) : error)}
        </Alert>
      )}

      <Table
        columns={columns}
        data={runs}
        idKey="id"
        loading={loading}
        emptyTitle={__uiText("ยังไม่มีประวัติการส่งตามเวลา")}
        emptyDescription={__uiText("จะเห็นรายการหลังเปิดใช้งานและถึงเวลาที่ตั้งไว้")}
      />
    </div>
  );
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
