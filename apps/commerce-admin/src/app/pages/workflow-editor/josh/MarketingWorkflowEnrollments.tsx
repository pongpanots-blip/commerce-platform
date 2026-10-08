// ui-date-locale: display formatting only; stored dates and request values are unchanged
import { getUiLocale as __dateLocale } from '@cp/ui';
// ui-metadata-migration: static labels and UI notices only
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getMarketingWorkflowEnrollments,
  type MarketingWorkflowEnrollment,
  type MarketingWorkflowEnrollmentStatus,
} from './shared-api';
import { Select, Table, TableColumn } from './shared-ui';
import AdminListHeader from './AdminListHeader';
import { ADMIN_ROUTES } from './admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS_STYLES: Record<MarketingWorkflowEnrollmentStatus, string> = {
  pending: 'text-gray-400',
  running: 'text-blue-600 font-semibold',
  completed: 'text-green-600 font-semibold',
  skipped: 'text-amber-600',
  failed: 'text-red-500 font-semibold',
};

const STATUS_OPTIONS = [
  { value: 'all', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'pending', get label(){return __uiText("pending");} },
  { value: 'running', get label(){return __uiText("running");} },
  { value: 'completed', get label(){return __uiText("completed");} },
  { value: 'skipped', get label(){return __uiText("skipped");} },
  { value: 'failed', get label(){return __uiText("failed");} },
];

/** Map common machine skip codes → short Thai explanation for CS. */
function explainSkipReason(raw: string | null): string {
  if (!raw) return '-';
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    holdout: __uiText("อยู่ในกลุ่ม holdout (ไม่ส่งข้อความเพื่อวัดผล)"),
    already_enrolled: __uiText("เคย enroll workflow นี้อยู่แล้ว (cooldown)"),
    cooldown: __uiText("ยังอยู่ในช่วง cooldown หลัง enrollment ก่อนหน้า"),
    goal_reached: __uiText("ถึง goal แล้ว จึงออกจาก workflow"),
    exit_on_goal: __uiText("ถึง goal แล้ว จึงออกจาก workflow"),
    unsubscribed: __uiText("ผู้ใช้ยกเลิกการรับข้อความ"),
    no_channel: __uiText("ไม่มีช่องทางส่ง (email/push/line)"),
    inactive_user: __uiText("บัญชีผู้ใช้ไม่พร้อมรับแคมเปญ"),
    filter_mismatch: __uiText("ไม่ผ่านเงื่อนไข audience / filter"),
    missing_template: __uiText("ไม่พบ notify template"),
  };
  for (const [code, label] of Object.entries(map)) {
    if (key === code || key.includes(code)) {
      return `${label} (${raw})`;
    }
  }
  return raw;
}

export default function MarketingWorkflowEnrollments() {
  __useUiLocale();
  const { id } = useParams<{ id: string }>();
  const [enrollments, setEnrollments] = useState<MarketingWorkflowEnrollment[]>(
    [],
  );
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const loadData = async () => {
      setLoading(true);
      try {
        const response = await getMarketingWorkflowEnrollments(id);
        const data = response.data.data;
        setEnrollments(Array.isArray(data) ? data : []);
      } catch (error: any) {
        console.error('load workflow enrollments error:', error.message);
      } finally {
        setLoading(false);
      }
    };
    void loadData();
  }, [id]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return enrollments;
    return enrollments.filter((row) => row.status === statusFilter);
  }, [enrollments, statusFilter]);

  const skippedCount = enrollments.filter((e) => e.status === 'skipped').length;

  const columns: TableColumn<MarketingWorkflowEnrollment>[] = [
    {
      key: 'status',
      label: __uiText("สถานะ"),
      render: (value: MarketingWorkflowEnrollmentStatus) => (
        <span className={`text-xs ${STATUS_STYLES[value] ?? 'text-gray-400'}`}>
          {value}
        </span>
      ),
    },
    {
      key: 'user_id',
      label: __uiText("User ID"),
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
      key: 'skip_reason',
      label: __uiText("ทำไมถูก skip"),
      render: (value: string | null, row) =>
        row.status === 'skipped' || value ? (
          <span className="text-xs text-amber-800" title={value ?? ''}>
            {explainSkipReason(value)}
          </span>
        ) : (
          <span className="text-xs text-gray-400">-</span>
        ),
    },
    {
      key: 'started_at',
      label: __uiText("เริ่มเมื่อ"),
      render: (value: string | null) =>
        value ? new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : '-',
    },
  ];

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">{__uiText("กำลังโหลด...")}</div>;
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <Link
          to={
            id
              ? ADMIN_ROUTES.marketingWorkflowEdit(id)
              : ADMIN_ROUTES.marketingWorkflows
          }
          className="text-xs text-primary hover:underline"
        >
          {__uiText("&larr; กลับไปหน้าแก้ไข Workflow")}</Link>
      </div>
      <AdminListHeader
        title={__uiText("Workflow Enrollments")}
        subtitle={
          skippedCount > 0
            ? __uiText("{0} รายการถูก skip — กรองสถานะ skipped เพื่อดูเหตุผล", {"0": skippedCount})
            : undefined
        }
      />
      <div className="w-48">
        <Select
          label={__uiText("สถานะการลงทะเบียน")}
          data={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          placeholder={__uiText("กรองสถานะ...")}
        />
      </div>
      <Table columns={columns} data={filtered} idKey="id" />
    </div>
  );
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
