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

const STATUS_STYLES: Record<MarketingWorkflowEnrollmentStatus, string> = {
  pending: 'text-gray-400',
  running: 'text-blue-600 font-semibold',
  completed: 'text-green-600 font-semibold',
  skipped: 'text-amber-600',
  failed: 'text-red-500 font-semibold',
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'ทุกสถานะ' },
  { value: 'pending', label: 'pending' },
  { value: 'running', label: 'running' },
  { value: 'completed', label: 'completed' },
  { value: 'skipped', label: 'skipped' },
  { value: 'failed', label: 'failed' },
];

/** Map common machine skip codes → short Thai explanation for CS. */
function explainSkipReason(raw: string | null): string {
  if (!raw) return '-';
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    holdout: 'อยู่ในกลุ่ม holdout (ไม่ส่งข้อความเพื่อวัดผล)',
    already_enrolled: 'เคย enroll workflow นี้อยู่แล้ว (cooldown)',
    cooldown: 'ยังอยู่ในช่วง cooldown หลัง enrollment ก่อนหน้า',
    goal_reached: 'ถึง goal แล้ว จึงออกจาก workflow',
    exit_on_goal: 'ถึง goal แล้ว จึงออกจาก workflow',
    unsubscribed: 'ผู้ใช้ยกเลิกการรับข้อความ',
    no_channel: 'ไม่มีช่องทางส่ง (email/push/line)',
    inactive_user: 'บัญชีผู้ใช้ไม่พร้อมรับแคมเปญ',
    filter_mismatch: 'ไม่ผ่านเงื่อนไข audience / filter',
    missing_template: 'ไม่พบ notify template',
  };
  for (const [code, label] of Object.entries(map)) {
    if (key === code || key.includes(code)) {
      return `${label} (${raw})`;
    }
  }
  return raw;
}

export default function MarketingWorkflowEnrollments() {
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
      label: 'สถานะ',
      render: (value: MarketingWorkflowEnrollmentStatus) => (
        <span className={`text-xs ${STATUS_STYLES[value] ?? 'text-gray-400'}`}>
          {value}
        </span>
      ),
    },
    {
      key: 'user_id',
      label: 'User ID',
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
      label: 'ทำไมถูก skip',
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
      label: 'เริ่มเมื่อ',
      render: (value: string | null) =>
        value ? new Date(value).toLocaleString('th-TH') : '-',
    },
  ];

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
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
          &larr; กลับไปหน้าแก้ไข Workflow
        </Link>
      </div>
      <AdminListHeader
        title="Workflow Enrollments"
        subtitle={
          skippedCount > 0
            ? `${skippedCount} รายการถูก skip — กรองสถานะ skipped เพื่อดูเหตุผล`
            : undefined
        }
      />
      <div className="w-48">
        <Select
          label="สถานะการลงทะเบียน"
          data={STATUS_OPTIONS}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          placeholder="กรองสถานะ..."
        />
      </div>
      <Table columns={columns} data={filtered} idKey="id" />
    </div>
  );
}
