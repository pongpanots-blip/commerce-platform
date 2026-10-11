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
import { ADMIN_ROUTES } from './admin-routes';

// ui-copy-migration: only literal UI copy and notification templates
import { Chip, PageHeader, type Tone, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const STATUS_TONE: Record<MarketingWorkflowEnrollmentStatus, Tone> = {
  pending: 'muted',
  running: 'info',
  completed: 'ok',
  skipped: 'warn',
  failed: 'danger',
};

const STATUS_LABEL: Record<MarketingWorkflowEnrollmentStatus, () => string> = {
  pending: () => __uiText("รอเริ่ม"),
  running: () => __uiText("อยู่ระหว่างขั้นตอน"),
  completed: () => __uiText("ครบทุกขั้นตอนแล้ว"),
  skipped: () => __uiText("ข้าม"),
  failed: () => __uiText("ล้มเหลว"),
};

const STATUS_OPTIONS = [
  { value: 'all', get label(){return __uiText("ทุกสถานะ");} },
  { value: 'pending', get label(){return STATUS_LABEL.pending();} },
  { value: 'running', get label(){return STATUS_LABEL.running();} },
  { value: 'completed', get label(){return STATUS_LABEL.completed();} },
  { value: 'skipped', get label(){return STATUS_LABEL.skipped();} },
  { value: 'failed', get label(){return STATUS_LABEL.failed();} },
];

/** Map common machine skip codes → short Thai explanation for CS. */
function explainSkipReason(raw: string | null): string {
  if (!raw) return '-';
  const key = raw.trim().toLowerCase();
  const map: Record<string, string> = {
    holdout: __uiText("อยู่ในกลุ่มที่ไม่ส่งข้อความ เพื่อใช้เทียบผล"),
    already_enrolled: __uiText("เคยเข้าข้อความอัตโนมัตินี้แล้ว ยังไม่ถึงเวลาเข้าซ้ำ"),
    cooldown: __uiText("ยังไม่ถึงเวลาเข้าซ้ำหลังรอบก่อน"),
    goal_reached: __uiText("ลูกค้าทำตามเป้าหมายแล้ว จึงออกจากข้อความอัตโนมัติ"),
    exit_on_goal: __uiText("ลูกค้าทำตามเป้าหมายแล้ว จึงออกจากข้อความอัตโนมัติ"),
    unsubscribed: __uiText("ผู้ใช้ยกเลิกการรับข้อความ"),
    no_channel: __uiText("ไม่มีช่องทางส่ง (อีเมล / แจ้งเตือน / LINE)"),
    inactive_user: __uiText("บัญชีผู้ใช้ไม่พร้อมรับแคมเปญ"),
    filter_mismatch: __uiText("ไม่ผ่านเงื่อนไขกลุ่มลูกค้า"),
    missing_template: __uiText("ไม่พบแม่แบบข้อความ"),
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
        <Chip tone={STATUS_TONE[value] ?? 'muted'} statusCode={value} dot>
          {STATUS_LABEL[value]?.() ?? value}
        </Chip>
      ),
    },
    {
      key: 'user_id',
      label: __uiText("รหัสลูกค้า"),
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
      label: __uiText("เหตุผลที่ข้าม"),
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
      align: 'right',
      render: (value: string | null) =>
        value ? new Date(value).toLocaleString((__dateLocale() === 'th' ? "th-TH" : 'en-GB')) : '-',
    },
  ];

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <PageHeader
        back={{ to: id ? ADMIN_ROUTES.marketingWorkflowEdit(id) : ADMIN_ROUTES.marketingWorkflows, label: 'กลับไปหน้าแก้ข้อความอัตโนมัติ' }}
        title={__uiText("ลูกค้าที่เข้าข้อความอัตโนมัตินี้")}
        subtitle={
          skippedCount > 0
            ? __uiText("{0} รายการถูกข้าม — เลือกสถานะ \"ข้าม\" เพื่อดูเหตุผล", {"0": skippedCount})
            : __uiText("ลูกค้าแต่ละคนอยู่ขั้นไหนแล้ว และเหตุผลที่ถูกข้าม")
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
      <Table
        columns={columns}
        data={filtered}
        idKey="id"
        loading={loading}
        emptyTitle={statusFilter === 'all' ? __uiText("ยังไม่มีลูกค้าเข้าข้อความอัตโนมัตินี้") : __uiText("ไม่มีลูกค้าในสถานะนี้")}
        emptyDescription={statusFilter === 'all' ? __uiText("ลูกค้าจะเข้ามาเมื่อเปิดใช้งานและมีคนเข้าเงื่อนไข") : __uiText("ลองเลือก \"ทุกสถานะ\"")}
      />
    </div>
  );
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
