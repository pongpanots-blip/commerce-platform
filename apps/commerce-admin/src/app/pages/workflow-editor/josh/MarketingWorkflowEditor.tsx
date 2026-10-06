import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  activateMarketingWorkflow,
  createMarketingWorkflow,
  getCoupons,
  getMarketingWorkflow,
  getMarketingWorkflowAnalytics,
  getMarketingWorkflowConversionStats,
  getMarketingWorkflowRevisions,
  getUserSegments,
  MAX_MARKETING_CONDITION_STEPS,
  MAX_MARKETING_WAIT_STEPS,
  MARKETING_CONDITION_WARN_THRESHOLD,
  pauseMarketingWorkflow,
  previewMarketingWorkflow,
  restoreMarketingWorkflowRevision,
  testMarketingWorkflow,
  updateMarketingWorkflow,
  type MarketingConversionStats,
  type MarketingGoalConfig,
  type MarketingWorkflowAnalytics,
  type MarketingStep,
  type MarketingTriggerConfig,
  type MarketingTriggerType,
  type MarketingWorkflow,
  type MarketingWorkflowPreviewResult,
  type MarketingWorkflowRevision,
  type MarketingWorkflowSchedule,
  type MarketingWorkflowTestResult,
  type UserSegmentListItem,
} from './shared-api';
import { Select } from './shared-ui';
import { ADMIN_ROUTES } from './admin-routes';
import {
  describeMarketingSchedule,
  MarketingFlowCanvas,
  NODE_GAP_Y,
  TRIGGER_NODE_ID,
  type MarketingCanvasPosition,
} from './MarketingFlowCanvas';
import {
  MarketingStepSidePanel,
  type MarketingSidePanelSelection,
} from './MarketingStepSidePanel';
import { TriggerRuleBuilder } from './TriggerRuleBuilder';
import { defaultTriggerConfigFor } from './trigger-rule.helpers';

type CouponOption = { id: string; coupon_code: string; title: string };

const STATUS_LABEL: Record<MarketingWorkflow['status'], string> = {
  draft: 'ร่าง (Draft)',
  active: 'ใช้งานอยู่ (Active)',
  paused: 'หยุดชั่วคราว (Paused)',
};

const STATUS_STYLE: Record<MarketingWorkflow['status'], string> = {
  draft: 'bg-gray-100 text-gray-500',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
};

/** Shared shell for the header's settings row so every chip lines up. */
const CHIP_CLASS =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-500';

const CHIP_INPUT_CLASS =
  '-my-0.5 w-12 rounded-md border border-gray-200 px-1.5 py-0.5 text-xs text-gray-800 focus:border-primary focus:outline-none';

function SettingChip({
  label,
  suffix,
  title,
  htmlFor,
  children,
}: {
  label: string;
  suffix?: string;
  title?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={CHIP_CLASS} title={title}>
      <label htmlFor={htmlFor} className="font-medium text-gray-400">{label}</label>
      {children}
      {suffix ? <span>{suffix}</span> : null}
    </div>
  );
}

function HeaderButton({
  children,
  onClick,
  disabled,
  variant = 'secondary',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const styles =
    variant === 'primary'
      ? 'bg-gray-900 text-white hover:bg-gray-800'
      : variant === 'secondary'
        ? 'bg-white border border-gray-300 text-gray-800 hover:bg-gray-50'
        : 'text-primary hover:underline bg-transparent';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none';
const FIELD_LABEL = 'mb-1 block text-xs font-medium text-gray-500';

const SCHEDULE_DOW_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'อา' },
  { value: 1, label: 'จ' },
  { value: 2, label: 'อ' },
  { value: 3, label: 'พ' },
  { value: 4, label: 'พฤ' },
  { value: 5, label: 'ศ' },
  { value: 6, label: 'ส' },
];

function defaultSchedule(): MarketingWorkflowSchedule {
  return {
    timezone: 'Asia/Bangkok',
    daysOfWeek: [],
    startTime: '00:00',
    endTime: '24:00',
    activeFrom: null,
    activeTo: null,
  };
}

function toDateInputValue(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

function fromDateInputValue(value: string): string | null {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

/** Dense schedule form — collapsed to a one-line summary + "ตลอดเวลา" toggle when `null`. */
function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: MarketingWorkflowSchedule;
  onChange: (schedule: MarketingWorkflowSchedule) => void;
}) {
  if (!schedule) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>ตลอดเวลา (ไม่จำกัดช่วงเวลา) — ทุก trigger จะทำงานได้ตลอด 24 ชม.</span>
        <HeaderButton onClick={() => onChange(defaultSchedule())}>ตั้งช่วงเวลาเฉพาะ</HeaderButton>
      </div>
    );
  }

  const days = schedule.daysOfWeek ?? [];
  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    onChange({ ...schedule, daysOfWeek: next });
  };
  const timezoneSelectId = useId();
  const startTimeInputId = useId();
  const endTimeInputId = useId();
  const activeFromInputId = useId();
  const activeToInputId = useId();

  return (
    <div className="space-y-2.5 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1.5">
          <label htmlFor={timezoneSelectId} className="font-medium text-gray-500">เขตเวลา (Timezone)</label>
          <Select
            id={timezoneSelectId}
            value={schedule.timezone}
            onChange={(event) => onChange({ ...schedule, timezone: event.target.value })}
          >
            <option value="Asia/Bangkok">Asia/Bangkok</option>
            <option value="UTC">UTC</option>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor={startTimeInputId} className="font-medium text-gray-500">เวลา</label>
          <input
            id={startTimeInputId}
            type="time"
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-primary focus:outline-none"
            value={schedule.startTime ?? '00:00'}
            onChange={(event) => onChange({ ...schedule, startTime: event.target.value })}
          />
          <span className="text-gray-400">–</span>
          <label htmlFor={endTimeInputId} className="font-medium text-gray-500">ถึง</label>
          <input
            id={endTimeInputId}
            type="time"
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-primary focus:outline-none"
            value={schedule.endTime ?? '24:00'}
            onChange={(event) => onChange({ ...schedule, endTime: event.target.value })}
          />
        </div>
        <HeaderButton onClick={() => onChange(null)}>ตลอดเวลา</HeaderButton>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-gray-500">วัน</span>
        {SCHEDULE_DOW_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`cursor-pointer rounded-full border px-2 py-0.5 ${
              days.includes(opt.value)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-gray-200 text-gray-500'
            }`}
          >
            <input
              type="checkbox"
              className="hidden"
              checked={days.includes(opt.value)}
              onChange={() => toggleDay(opt.value)}
            />
            {opt.label}
          </label>
        ))}
        {days.length === 0 && <span className="text-gray-400">(ว่าง = ทุกวัน)</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <label htmlFor={activeFromInputId} className="font-medium text-gray-500">เริ่มแคมเปญ</label>
          <input
            id={activeFromInputId}
            type="date"
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-primary focus:outline-none"
            value={toDateInputValue(schedule.activeFrom)}
            onChange={(event) =>
              onChange({ ...schedule, activeFrom: fromDateInputValue(event.target.value) })
            }
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor={activeToInputId} className="font-medium text-gray-500">สิ้นสุดแคมเปญ</label>
          <input
            id={activeToInputId}
            type="date"
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-primary focus:outline-none"
            value={toDateInputValue(schedule.activeTo)}
            onChange={(event) =>
              onChange({ ...schedule, activeTo: fromDateInputValue(event.target.value) })
            }
          />
        </div>
      </div>
    </div>
  );
}

function formatLift(lift: number | null): string {
  if (lift === null || Number.isNaN(lift)) return 'ยังไม่มีข้อมูลเพียงพอ';
  const sign = lift > 0 ? '+' : '';
  return `${sign}${lift.toFixed(1)}%`;
}

function StatTile({
  label,
  enrolled,
  converted,
  rate,
}: {
  label: string;
  enrolled: number;
  converted: number;
  rate: number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="text-[11px] font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-800">{rate.toFixed(1)}%</p>
      <p className="mt-0.5 text-[11px] text-gray-400">
        {converted.toLocaleString()} / {enrolled.toLocaleString()} conversion
      </p>
    </div>
  );
}

/** Sent-vs-holdout conversion comparison for the workflow's control-arm A/B test. */
function ConversionStatsPanel({ workflowId }: { workflowId: string }) {
  const [stats, setStats] = useState<MarketingConversionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getMarketingWorkflowConversionStats(workflowId)
      .then(setStats)
      .catch((err: any) => setError(err?.response?.data?.message || 'โหลดสถิติไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [workflowId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700">
          Conversion Stats — Sent vs Holdout
        </p>
        <HeaderButton onClick={load} disabled={loading}>
          {loading ? 'กำลังโหลด...' : 'รีเฟรช'}
        </HeaderButton>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Sent (ได้รับข้อความ)"
              enrolled={stats.sent.enrolled}
              converted={stats.sent.converted}
              rate={stats.sent.rate}
            />
            <StatTile
              label={`Holdout (${stats.holdoutPercent}% ควบคุม)`}
              enrolled={stats.holdout.enrolled}
              converted={stats.holdout.converted}
              rate={stats.holdout.rate}
            />
          </div>
          <p className="text-[11px] text-gray-500">
            Lift: <span className="font-semibold text-gray-700">{formatLift(stats.lift)}</span>{' '}
            · หน้าต่างวัดผล {stats.conversionWindowDays} วันหลัง enroll
          </p>
        </>
      )}
    </div>
  );
}

function formatAnalyticsRate(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(1)}%`;
}

function HourBars({ label, values }: { label: string; values: number[] }) {
  const max = Math.max(1, ...values);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700">{label}</p>
        <span className="text-[10px] text-gray-400">เวลาไทย (Bangkok)</span>
      </div>
      <div className="flex h-16 items-end gap-0.5" aria-label={label}>
        {values.map((value, hour) => (
          <div
            key={hour}
            title={`${hour.toString().padStart(2, '0')}:00 — ${value.toLocaleString()}`}
            className="min-w-0 flex-1 rounded-sm bg-gray-300"
            style={{
              height: `${(value / max) * 100}%`,
              minHeight: value > 0 ? 2 : 0,
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}

function AnalyticsPanel({ workflowId }: { workflowId: string }) {
  const [days, setDays] = useState(30);
  const [analytics, setAnalytics] = useState<MarketingWorkflowAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - days);

    setLoading(true);
    setError(null);
    getMarketingWorkflowAnalytics(workflowId, {
      from: from.toISOString(),
      to: to.toISOString(),
    })
      .then(setAnalytics)
      .catch((err: any) => setError(err?.response?.data?.message || 'โหลด Analytics ไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [days, workflowId]);

  useEffect(() => {
    load();
  }, [load]);

  const funnelItems = analytics
    ? [
        { label: 'Enroll', value: analytics.funnel.enrolled },
        { label: 'Notify sent', value: analytics.funnel.notifySent },
        { label: 'Offer shown', value: analytics.funnel.offerShown },
        { label: 'Coupon granted', value: analytics.funnel.couponGranted },
        { label: 'Coupon redeemed', value: analytics.funnel.couponRedeemed },
        { label: 'Order converted', value: analytics.funnel.orderConverted },
      ]
    : [];
  const isEmpty = funnelItems.every(({ value }) => value === 0);

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700">Analytics</p>
        <div className="flex items-center gap-1">
          {[7, 30, 90].map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                days === range
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {range} วัน
            </button>
          ))}
          <HeaderButton onClick={load} disabled={loading}>
            {loading ? 'กำลังโหลด...' : 'รีเฟรช'}
          </HeaderButton>
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      {analytics && (
        <>
          {isEmpty ? (
            <p className="text-xs text-gray-400">
              ยังไม่มี event ในช่วงเวลานี้ — ระบบเริ่มเก็บหลัง deploy เท่านั้น
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {funnelItems.map(({ label, value }) => (
                  <div key={label} className="rounded-md border border-gray-100 bg-gray-50 px-2.5 py-2">
                    <p className="text-[10px] font-medium text-gray-500">{label}</p>
                    <p className="mt-0.5 text-base font-semibold text-gray-800">
                      {value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span>Enroll → Notify: {formatAnalyticsRate(analytics.rates.enrollToNotify)}</span>
                <span>Enroll → Offer: {formatAnalyticsRate(analytics.rates.enrollToOffer)}</span>
                <span>Grant → Redeem: {formatAnalyticsRate(analytics.rates.grantToRedeem)}</span>
                <span>Enroll → Order: {formatAnalyticsRate(analytics.rates.enrollToOrder)}</span>
              </div>
              {(analytics.funnel.holdoutEnrolled > 0 || analytics.funnel.holdoutConverted > 0) && (
                <p className="text-[11px] text-gray-400">
                  Holdout: {analytics.funnel.holdoutEnrolled.toLocaleString()} enrolled ·{' '}
                  {analytics.funnel.holdoutConverted.toLocaleString()} converted
                </p>
              )}
            </>
          )}
          {!isEmpty && (
            <div className="grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2">
              <HourBars label="Coupon granted by hour" values={analytics.byHour.granted} />
              <HourBars label="Coupon redeemed by hour" values={analytics.byHour.redeemed} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function formatRevisionDate(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** Last 20 saved snapshots, each restorable back into the live workflow. */
function RevisionHistoryPanel({
  workflowId,
  onRestored,
}: {
  workflowId: string;
  onRestored: () => void;
}) {
  const [revisions, setRevisions] = useState<MarketingWorkflowRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getMarketingWorkflowRevisions(workflowId)
      .then((rows) => setRevisions(rows.slice(0, 20)))
      .catch((err: any) => setError(err?.response?.data?.message || 'โหลดประวัติไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [workflowId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRestore = async (revisionId: string) => {
    if (!window.confirm('ย้อนกลับไปใช้เวอร์ชันนี้? การแก้ไขปัจจุบันที่ยังไม่ได้บันทึกจะหายไป')) {
      return;
    }
    setRestoringId(revisionId);
    setError(null);
    try {
      await restoreMarketingWorkflowRevision(workflowId, revisionId);
      onRestored();
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'ย้อนกลับไม่สำเร็จ');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700">ประวัติการแก้ไข (20 รายการล่าสุด)</p>
        <HeaderButton onClick={load} disabled={loading}>
          {loading ? 'กำลังโหลด...' : 'รีเฟรช'}
        </HeaderButton>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {revisions.length === 0 && !loading ? (
        <p className="text-xs text-gray-400">ยังไม่มีประวัติการแก้ไข</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {revisions.map((rev) => (
            <li key={rev.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
              <span className="text-gray-600">
                {formatRevisionDate(rev.created_at)}
                {rev.updated_by && <span className="text-gray-400"> · {rev.updated_by}</span>}
              </span>
              <HeaderButton
                onClick={() => handleRestore(rev.id)}
                disabled={restoringId === rev.id}
              >
                {restoringId === rev.id ? 'กำลังย้อนกลับ...' : 'ย้อนกลับ'}
              </HeaderButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function buildDefaultPositions(
  steps: MarketingStep[],
  savedPositions: Record<string, MarketingCanvasPosition>,
): Record<string, MarketingCanvasPosition> {
  const next: Record<string, MarketingCanvasPosition> = {
    [TRIGGER_NODE_ID]: savedPositions[TRIGGER_NODE_ID] ?? { x: 0, y: 0 },
  };
  steps.forEach((step, index) => {
    next[step.id] = savedPositions[step.id] ?? { x: 0, y: NODE_GAP_Y * (index + 1) };
  });
  return next;
}

/** Create-mode screen for `/marketing/workflows/new` — creates a draft then redirects to the editor. */
function CreateWorkflowScreen() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<MarketingTriggerType>('cart_idle');
  const [triggerConfig, setTriggerConfig] = useState<MarketingTriggerConfig>(
    defaultTriggerConfigFor('cart_idle'),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputId = useId();

  const handleSelectTrigger = (type: MarketingTriggerType) => {
    setTriggerType(type);
    setTriggerConfig(defaultTriggerConfigFor(type));
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('กรุณาระบุชื่อ workflow');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const seedSteps =
        triggerType === 'first_visit' || triggerType === 'first_login' || triggerType === 'custom'
          ? [
              {
                id: crypto.randomUUID(),
                type: 'action' as const,
                action: {
                  kind: 'show_offer' as const,
                  // displayOnly so Activate works without picking a coupon;
                  // marketer can uncheck and attach a coupon later.
                  displayOnly: true,
                  hideCode: true,
                  title:
                    triggerType === 'first_visit'
                      ? 'ยินดีต้อนรับ'
                      : triggerType === 'custom'
                        ? (triggerConfig as { label?: string }).label?.trim() || 'ข้อเสนอพิเศษ'
                        : 'ยินดีต้อนรับสมาชิกใหม่',
                  body: 'ดูข้อเสนอพิเศษจากเราได้ที่นี่',
                },
              },
            ]
          : undefined;

      const response = await createMarketingWorkflow({
        name: name.trim(),
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        ...(seedSteps ? { steps: seedSteps } : {}),
      });
      const created: MarketingWorkflow = response.data.data;
      navigate(ADMIN_ROUTES.marketingWorkflowEdit(created.id), { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || 'สร้าง workflow ไม่สำเร็จ');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
      <Link to={ADMIN_ROUTES.marketingWorkflows} className="text-xs text-primary hover:underline">
        &larr; กลับไปหน้ารายการ Workflow
      </Link>
      <div>
        <h1 className="text-xl font-bold text-gray-800">สร้าง Marketing Workflow ใหม่</h1>
        <p className="mt-1 text-xs text-gray-500">
          ตั้งชื่อ แล้วสร้างเงื่อนไขเริ่มต้นเอง (เลือกประเภท + ปรับค่า) — Audience ไม่บังคับ
          (ทุกคนที่เข้าเงื่อนไข trigger ได้) · ขั้นตอน action แก้ต่อใน canvas ได้หลังสร้าง
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-[10px] font-semibold tracking-wide text-gray-400">1 · ชื่อ Workflow</h2>
        <div>
          <label htmlFor={nameInputId} className={FIELD_LABEL}>ชื่อ</label>
          <input
            id={nameInputId}
            type="text"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="เช่น ตะกร้าค้าง 30 นาที + แจกคูปอง"
            className={INPUT_CLASS}
          />
        </div>
      </section>

      <section className="rounded-xl border border-amber-200/80 bg-amber-50/40 p-4 shadow-sm">
        <TriggerRuleBuilder
          variant="create"
          triggerType={triggerType}
          triggerConfig={triggerConfig}
          onUpdateTriggerType={handleSelectTrigger}
          onUpdateTrigger={setTriggerConfig}
          showScheduleStrip={false}
        />
      </section>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <HeaderButton variant="primary" onClick={handleCreate} disabled={creating}>
        {creating ? 'กำลังสร้าง...' : 'สร้าง Workflow'}
      </HeaderButton>
    </div>
  );
}

function EditWorkflowScreen({ id }: { id: string }) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [status, setStatus] = useState<MarketingWorkflow['status']>('draft');
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<MarketingTriggerType>('cart_idle');
  const [triggerConfig, setTriggerConfig] = useState<MarketingTriggerConfig>({ idleHours: 24 });
  const [schedule, setSchedule] = useState<MarketingWorkflowSchedule>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [steps, setSteps] = useState<MarketingStep[]>([]);
  const [positions, setPositions] = useState<Record<string, MarketingCanvasPosition>>({});
  const [cooldownDays, setCooldownDays] = useState(7);
  const [holdoutPercent, setHoldoutPercent] = useState(0);
  const [conversionWindowDays, setConversionWindowDays] = useState(7);
  const [exitOnGoal, setExitOnGoal] = useState<MarketingGoalConfig>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(TRIGGER_NODE_ID);
  const nameInputId = useId();
  const cooldownInputId = useId();
  const holdoutInputId = useId();
  const conversionWindowInputId = useId();
  const exitOnGoalSelectId = useId();
  const testUserIdInputId = useId();
  const testSecondaryInputId = useId();
  const testOptionalUserIdInputId = useId();

  const [segments, setSegments] = useState<UserSegmentListItem[]>([]);
  const [coupons, setCoupons] = useState<CouponOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<MarketingWorkflowPreviewResult | null>(null);

  const [testOpen, setTestOpen] = useState(false);
  const [testUserId, setTestUserId] = useState('');
  const [testIndividualId, setTestIndividualId] = useState('');
  const [testDryRun, setTestDryRun] = useState(true);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<MarketingWorkflowTestResult | null>(null);

  const loadWorkflow = useCallback(
    (opts: { showLoading?: boolean } = {}) => {
      const { showLoading = true } = opts;
      if (showLoading) setLoading(true);
      return getMarketingWorkflow(id)
        .then((response) => {
          const wf: MarketingWorkflow = response.data.data;
          const nextSteps = wf.steps ?? [];
          const savedPositions = (wf.graph_ui as Record<string, MarketingCanvasPosition>) ?? {};

          const nextTriggerType = wf.trigger_type ?? 'cart_idle';

          setStatus(wf.status);
          setName(wf.name);
          setTriggerType(nextTriggerType);
          setTriggerConfig(wf.trigger_config ?? defaultTriggerConfigFor(nextTriggerType));
          setSchedule(wf.schedule ?? null);
          setSteps(nextSteps);
          setCooldownDays(wf.cooldown_days ?? 7);
          setHoldoutPercent(wf.holdout_percent ?? 0);
          setConversionWindowDays(wf.conversion_window_days ?? 7);
          setExitOnGoal(wf.exit_on_goal ?? null);
          setPositions(buildDefaultPositions(nextSteps, savedPositions));
          setSelectedNodeId(TRIGGER_NODE_ID);
        })
        .catch((error) => {
          console.error('load marketing workflow error:', error.message);
          setErrorMsg('โหลด workflow ไม่สำเร็จ');
        })
        .finally(() => {
          if (showLoading) setLoading(false);
        });
    },
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    loadWorkflow().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    getUserSegments()
      .then(setSegments)
      .catch(() => setSegments([]));
    getCoupons(1, 200)
      .then((response) => {
        const rows = response?.data?.data?.data ?? [];
        setCoupons(
          (Array.isArray(rows) ? rows : []).map((row: any) => ({
            id: row.id,
            coupon_code: row.coupon_code,
            title: row.title,
          })),
        );
      })
      .catch(() => setCoupons([]));
  }, []);

  const waitCount = steps.filter((step) => step.type === 'wait').length;
  const canAddWait = waitCount < MAX_MARKETING_WAIT_STEPS;
  const hasGate = steps.some((step) => step.type === 'gate');
  const hasAudience = steps.some((step) => step.type === 'audience');
  const conditionCount = steps.filter((step) => step.type === 'condition').length;
  const canAddCondition = conditionCount < MAX_MARKETING_CONDITION_STEPS;

  const selection: MarketingSidePanelSelection | null = useMemo(() => {
    if (!selectedNodeId) return null;
    if (selectedNodeId === TRIGGER_NODE_ID) return { kind: 'trigger' };
    const step = steps.find((s) => s.id === selectedNodeId);
    return step ? { kind: 'step', step } : null;
  }, [selectedNodeId, steps]);

  const selectedCondition =
    selection?.kind === 'step' && selection.step.type === 'condition'
      ? selection.step
      : null;

  type AddTarget =
    | { mode: 'append' }
    | { mode: 'branch'; conditionId: string; branch: 'yes' | 'no' };

  const placeStep = (step: MarketingStep, target: AddTarget = { mode: 'append' }) => {
    setSteps((prev) => {
      if (target.mode === 'append') return [...prev, step];

      const parent = prev.find((s) => s.id === target.conditionId);
      if (!parent || parent.type !== 'condition') return [...prev, step];

      const existingTarget =
        target.branch === 'yes' ? parent.yesNextId : parent.noNextId;
      const placed: MarketingStep =
        existingTarget && (step.type === 'action' || step.type === 'gate')
          ? { ...step, nextId: existingTarget }
          : step;

      return [
        ...prev.map((s) => {
          if (s.id !== target.conditionId || s.type !== 'condition') return s;
          return target.branch === 'yes'
            ? { ...s, yesNextId: placed.id }
            : { ...s, noNextId: placed.id };
        }),
        placed,
      ];
    });

    setPositions((prev) => {
      if (target.mode === 'branch') {
        const parentPos = prev[target.conditionId] ?? { x: 0, y: 0 };
        const offsetX = target.branch === 'yes' ? 320 : -320;
        return {
          ...prev,
          [step.id]: { x: parentPos.x + offsetX, y: parentPos.y + NODE_GAP_Y },
        };
      }
      const maxY = Math.max(0, ...Object.values(prev).map((p) => p.y));
      return { ...prev, [step.id]: { x: 0, y: maxY + NODE_GAP_Y } };
    });
    setSelectedNodeId(step.id);
  };

  const makeWait = (): MarketingStep => ({
    id: crypto.randomUUID(),
    type: 'wait',
    hours: 24,
    minutes: 0,
  });
  const makeAudience = (): MarketingStep => ({
    id: crypto.randomUUID(),
    type: 'audience',
    segmentIds: [],
  });
  const makeGate = (): MarketingStep => ({
    id: crypto.randomUUID(),
    type: 'gate',
    kind: 'cart_still_open',
  });
  const makeGrantCoupon = (): MarketingStep => ({
    id: crypto.randomUUID(),
    type: 'action',
    action: { kind: 'grant_coupon', couponId: '' },
  });
  const makeNotify = (): MarketingStep => ({
    id: crypto.randomUUID(),
    type: 'action',
    action: { kind: 'notify', channels: [], templateKey: '' },
  });
  const makeShowOffer = (): MarketingStep => ({
    id: crypto.randomUUID(),
    type: 'action',
    action: { kind: 'show_offer', couponId: '', title: '', body: '' },
  });
  const makeCondition = (): MarketingStep => ({
    id: crypto.randomUUID(),
    type: 'condition',
    expression: 'cart.still_open == true',
    yesNextId: null,
    noNextId: null,
  });

  const handleUpdateTriggerType = useCallback((type: MarketingTriggerType) => {
    setTriggerType(type);
    setTriggerConfig(defaultTriggerConfigFor(type));
  }, []);

  const handleAddWait = () => placeStep(makeWait());
  const handleAddAudience = () => placeStep(makeAudience());
  const handleAddGate = () => placeStep(makeGate());
  const handleAddGrantCoupon = (target?: AddTarget) =>
    placeStep(makeGrantCoupon(), target);
  const handleAddNotify = (target?: AddTarget) => placeStep(makeNotify(), target);
  const handleAddShowOffer = (target?: AddTarget) => placeStep(makeShowOffer(), target);
  const handleAddCondition = (target?: AddTarget) =>
    placeStep(makeCondition(), target);

  const handleDeleteStep = (stepId: string) => {
    setSteps((prev) =>
      prev
        .filter((s) => s.id !== stepId)
        .map((s) => {
          if (s.type === 'condition') {
            return {
              ...s,
              yesNextId: s.yesNextId === stepId ? null : s.yesNextId,
              noNextId: s.noNextId === stepId ? null : s.noNextId,
            };
          }
          if (
            (s.type === 'audience' ||
              s.type === 'wait' ||
              s.type === 'gate' ||
              s.type === 'action') &&
            s.nextId === stepId
          ) {
            const { nextId: _removed, ...rest } = s;
            return rest as MarketingStep;
          }
          return s;
        }),
    );
    setPositions((prev) => {
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
    setSelectedNodeId((prev) => (prev === stepId ? null : prev));
  };

  const handleConnectSteps = useCallback(
    (connection: { source: string; target: string; sourceHandle?: string | null }) => {
      const { source, target, sourceHandle } = connection;
      if (!source || !target || source === target) return;

      setSteps((prev) => {
        if (source === TRIGGER_NODE_ID) {
          const moved = prev.find((s) => s.id === target);
          if (!moved) return prev;
          return [moved, ...prev.filter((s) => s.id !== target)];
        }

        return prev.map((s) => {
          if (s.id !== source) return s;
          if (s.type === 'condition') {
            if (sourceHandle === 'no') return { ...s, noNextId: target };
            return { ...s, yesNextId: target };
          }
          if (
            s.type === 'audience' ||
            s.type === 'wait' ||
            s.type === 'gate' ||
            s.type === 'action'
          ) {
            return { ...s, nextId: target };
          }
          return s;
        });
      });
    },
    [],
  );

  const handleDisconnectEdge = useCallback(
    (edge: { source: string; target: string; sourceHandle?: string | null }) => {
      const { source, target, sourceHandle } = edge;
      if (source === TRIGGER_NODE_ID) return;

      setSteps((prev) =>
        prev.map((s) => {
          if (s.id !== source) return s;
          if (s.type === 'condition') {
            if (sourceHandle === 'no' && s.noNextId === target) {
              return { ...s, noNextId: null };
            }
            if ((sourceHandle === 'yes' || !sourceHandle) && s.yesNextId === target) {
              return { ...s, yesNextId: null };
            }
            return s;
          }
          if (
            (s.type === 'audience' ||
              s.type === 'wait' ||
              s.type === 'gate' ||
              s.type === 'action') &&
            s.nextId === target
          ) {
            const { nextId: _removed, ...rest } = s;
            return rest as MarketingStep;
          }
          return s;
        }),
      );
    },
    [],
  );

  const handleUpdateStep = (stepId: string, next: MarketingStep) => {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? next : s)));
  };

  const handleNodeMove = (nodeId: string, position: MarketingCanvasPosition) => {
    setPositions((prev) => ({ ...prev, [nodeId]: position }));
  };

  const buildOrderedSteps = () =>
    [...steps].sort(
      (a, b) =>
        (positions[a.id]?.y ?? Number.MAX_SAFE_INTEGER) -
        (positions[b.id]?.y ?? Number.MAX_SAFE_INTEGER),
    );

  const saveWorkflow = async (): Promise<boolean> => {
    try {
      const orderedSteps = buildOrderedSteps();
      const response = await updateMarketingWorkflow(id, {
        name,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
        steps: orderedSteps,
        graph_ui: positions,
        cooldown_days: cooldownDays,
        holdout_percent: holdoutPercent,
        conversion_window_days: conversionWindowDays,
        exit_on_goal: exitOnGoal,
        schedule,
      });
      const saved: MarketingWorkflow = response.data.data;
      setStatus(saved.status);
      setTriggerType(saved.trigger_type ?? triggerType);
      setTriggerConfig(saved.trigger_config ?? triggerConfig);
      setSchedule(saved.schedule ?? null);
      setSteps(saved.steps ?? orderedSteps);
      setHoldoutPercent(saved.holdout_percent ?? holdoutPercent);
      setConversionWindowDays(saved.conversion_window_days ?? conversionWindowDays);
      setExitOnGoal(saved.exit_on_goal ?? null);
      return true;
    } catch (error: any) {
      setErrorMsg(error?.response?.data?.message || 'บันทึกไม่สำเร็จ');
      return false;
    }
  };

  const handleSaveClick = async () => {
    setSaving(true);
    setErrorMsg(null);
    await saveWorkflow();
    setSaving(false);
  };

  const handleActivate = async () => {
    setActivating(true);
    setErrorMsg(null);
    const ok = await saveWorkflow();
    if (ok) {
      try {
        const response = await activateMarketingWorkflow(id);
        setStatus(response.data.data.status);
      } catch (error: any) {
        setErrorMsg(error?.response?.data?.message || 'เปิดใช้งานไม่สำเร็จ');
      }
    }
    setActivating(false);
  };

  const handlePause = async () => {
    setErrorMsg(null);
    try {
      const response = await pauseMarketingWorkflow(id);
      setStatus(response.data.data.status);
    } catch (error: any) {
      setErrorMsg(error?.response?.data?.message || 'หยุด workflow ไม่สำเร็จ');
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setErrorMsg(null);
    try {
      const response = await previewMarketingWorkflow(id);
      setPreviewResult(response.data.data);
    } catch (error: any) {
      setErrorMsg(error?.response?.data?.message || 'พรีวิวไม่สำเร็จ');
    } finally {
      setPreviewLoading(false);
    }
  };

  /** Triggers tested per device (guest ok) — first_visit and custom. */
  const deviceScopedTrigger = triggerType === 'first_visit' || triggerType === 'custom';

  const handleRunTest = async () => {
    if (!deviceScopedTrigger && !testUserId.trim()) {
      setErrorMsg('กรุณาใส่ User ID สำหรับทดสอบ trigger นี้');
      return;
    }

    setTestLoading(true);
    setErrorMsg(null);
    setTestResult(null);

    const hasAction = steps.some((step) => step.type === 'action');
    if (!hasAction) {
      setErrorMsg(
        'ต้องมีอย่างน้อย 1 Action (แจกคูปอง / แสดง Offer / แจ้งเตือน) ก่อนทดสอบ — กด + แจกคูปอง หรือ + แสดง Offer แล้ว Save',
      );
      setTestLoading(false);
      return;
    }

    const ok = await saveWorkflow();
    if (!ok) {
      setTestLoading(false);
      return;
    }

    const individualId =
      testIndividualId.trim() ||
      (deviceScopedTrigger && !testDryRun
        ? `test-device-${Date.now()}`
        : undefined);
    if (individualId && !testIndividualId.trim()) {
      setTestIndividualId(individualId);
    }

    try {
      const response = await testMarketingWorkflow(id, {
        userId: testUserId.trim() || undefined,
        individualId,
        dryRun: testDryRun,
      });
      setTestResult(response.data.data);
      if (!testDryRun && individualId) {
        setErrorMsg(null);
      }
    } catch (error: any) {
      setErrorMsg(error?.response?.data?.message || 'ทดสอบไม่สำเร็จ');
    } finally {
      setTestLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">กำลังโหลด...</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link to={ADMIN_ROUTES.marketingWorkflows} className="text-xs text-primary hover:underline">
        &larr; กลับไปหน้ารายการ Workflow
      </Link>

      {/* Two rows on purpose: cramming identity + 6 settings + 7 buttons onto
          one line squeezed the buttons into a vertical stack and wrapped every
          Thai label mid-phrase. */}
      <div className="flex flex-col gap-3 border-b border-gray-100 pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-end gap-2">
            <div className="min-w-0">
              <label htmlFor={nameInputId} className="mb-0.5 block text-[10px] font-medium text-gray-400">
                ชื่อ Workflow
              </label>
              <input
                id={nameInputId}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full max-w-md rounded-lg border border-gray-200 px-3 py-2 text-base font-semibold text-gray-800 focus:border-primary focus:outline-none sm:w-72"
              />
            </div>
            <span
              className={`w-fit shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}
            >
              {STATUS_LABEL[status]}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <HeaderButton onClick={() => setSelectedNodeId(TRIGGER_NODE_ID)}>
              แก้เงื่อนไขเริ่มต้น
            </HeaderButton>
            <HeaderButton onClick={handlePreview} disabled={previewLoading}>
              {previewLoading ? 'กำลังพรีวิว...' : 'Preview'}
            </HeaderButton>
            {/* commerce: no Test here — it can send a real message; test in josh admin. */}
            <HeaderButton onClick={() => setStatsOpen((prev) => !prev)}>สถิติ</HeaderButton>
            <HeaderButton onClick={() => setAnalyticsOpen((prev) => !prev)}>Analytics</HeaderButton>
            <HeaderButton onClick={() => setHistoryOpen((prev) => !prev)}>ประวัติ</HeaderButton>
            <span className="mx-1 hidden h-5 w-px bg-gray-200 sm:block" aria-hidden />
            {status === 'active' ? (
              <HeaderButton onClick={handlePause}>Pause</HeaderButton>
            ) : (
              <HeaderButton onClick={handleActivate} disabled={activating}>
                {activating ? 'กำลังเปิดใช้งาน...' : 'Activate'}
              </HeaderButton>
            )}
            <HeaderButton variant="primary" onClick={handleSaveClick} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : 'Save'}
            </HeaderButton>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <SettingChip label="พักหลังส่ง (Cooldown)" suffix="วัน" htmlFor={cooldownInputId}>
            <input
              id={cooldownInputId}
              type="number"
              min={0}
              value={cooldownDays}
              onChange={(event) => setCooldownDays(Math.max(0, Number(event.target.value) || 0))}
              className={CHIP_INPUT_CLASS}
            />
          </SettingChip>

          <SettingChip
            label="กลุ่มควบคุม (Holdout)"
            suffix="%"
            title="เก็บ % ของผู้ใช้ไว้เป็นกลุ่มควบคุม (ไม่ส่งข้อความ) เพื่อเปรียบเทียบผล"
            htmlFor={holdoutInputId}
          >
            <input
              id={holdoutInputId}
              type="number"
              min={0}
              max={100}
              value={holdoutPercent}
              onChange={(event) =>
                setHoldoutPercent(Math.min(100, Math.max(0, Number(event.target.value) || 0)))
              }
              className={CHIP_INPUT_CLASS}
            />
          </SettingChip>

          <SettingChip
            label="หน้าต่างวัดผล"
            suffix="วัน"
            title="จำนวนวันหลัง enroll ที่ยังนับว่าออเดอร์นั้นมาจาก workflow นี้"
            htmlFor={conversionWindowInputId}
          >
            <input
              id={conversionWindowInputId}
              type="number"
              min={1}
              value={conversionWindowDays}
              onChange={(event) =>
                setConversionWindowDays(Math.max(1, Number(event.target.value) || 1))
              }
              className={CHIP_INPUT_CLASS}
            />
          </SettingChip>

          <SettingChip
            label="ออกเมื่อสำเร็จ"
            title="ดึงผู้ใช้ออกจาก workflow ทันทีที่ทำเป้าหมายสำเร็จ — ตรวจทุกครั้งที่ resume และก่อนส่งทุกข้อความ (ไม่ใช่เช็คจุดเดียวแบบ gate)"
            htmlFor={exitOnGoalSelectId}
          >
            <Select
              id={exitOnGoalSelectId}
              value={exitOnGoal?.kind ?? ''}
              onChange={(event) =>
                setExitOnGoal(
                  event.target.value
                    ? ({ kind: event.target.value } as MarketingGoalConfig)
                    : null,
                )
              }
              className="max-w-[10rem] truncate"
            >
              <option value="">ไม่ตั้ง (วิ่งจนจบ)</option>
              <option value="order_placed">สั่งซื้อสำเร็จ</option>
              <option value="cart_converted">ตะกร้าถูกปิด</option>
            </Select>
          </SettingChip>

          <button
            type="button"
            onClick={() => setScheduleOpen((prev) => !prev)}
            title={describeMarketingSchedule(schedule)}
            className={`${CHIP_CLASS} max-w-xs hover:border-gray-300 hover:bg-gray-50`}
          >
            <span className="shrink-0 font-medium text-gray-400">Schedule</span>
            <span className="truncate text-gray-800">{describeMarketingSchedule(schedule)}</span>
          </button>

          <Link
            to={ADMIN_ROUTES.marketingWorkflowEnrollments(id)}
            className={`${CHIP_CLASS} hover:border-gray-300 hover:bg-gray-50`}
          >
            <span className="text-gray-800">ดู Enrollments</span>
            <span aria-hidden className="text-gray-400">
              &rarr;
            </span>
          </Link>

          {triggerType === 'scheduled' && (
            <Link
              to={ADMIN_ROUTES.marketingWorkflowScheduledRuns(id)}
              className={`${CHIP_CLASS} hover:border-gray-300 hover:bg-gray-50`}
            >
              <span className="text-gray-800">Fire log</span>
              <span aria-hidden className="text-gray-400">
                &rarr;
              </span>
            </Link>
          )}
        </div>
      </div>

      {scheduleOpen && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <ScheduleEditor schedule={schedule} onChange={setSchedule} />
        </div>
      )}

      {statsOpen && <ConversionStatsPanel workflowId={id} />}

      {analyticsOpen && <AnalyticsPanel workflowId={id} />}

      {historyOpen && (
        <RevisionHistoryPanel workflowId={id} onRestored={() => loadWorkflow({ showLoading: false })} />
      )}

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {errorMsg}
        </div>
      )}

      {previewResult && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          กลุ่มเป้าหมายที่เข้าเงื่อนไขตอนนี้: <strong>{previewResult.count.toLocaleString()}</strong> คน
          {previewResult.sampleUserIds.length > 0 && (
            <span className="text-blue-500"> (ตัวอย่าง user_id: {previewResult.sampleUserIds.slice(0, 5).join(', ')}
              {previewResult.sampleUserIds.length > 5 ? ', ...' : ''})</span>
          )}
        </div>
      )}

      {testOpen && (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs text-gray-600 space-y-1">
            <p className="font-medium text-gray-700">วิธีทดสอบ (Test)</p>
            <ol className="list-decimal pl-4 space-y-0.5 text-gray-500">
              <li>
                ต้องมี Action อย่างน้อย 1 ขั้น — กดรันแล้วจะ Save ให้ก่อน
              </li>
              {deviceScopedTrigger ? (
                <li>
                  Trigger{' '}
                  <strong>{triggerType === 'first_visit' ? 'เข้าเว็บครั้งแรก' : 'กำหนดเอง (Custom)'}</strong>:
                  ใส่ Device ID (หรือปล่อยว่างให้ระบบสร้าง)
                  แล้วปิด Dry run เพื่อสร้าง offer จริง — ต้อง <strong>Activate</strong> ก่อนถึงจะขึ้น popup บน shop
                  จาก traffic จริง{triggerType === 'custom' ? ' (custom: ทุกคนที่เข้าเว็บระหว่าง Active)' : ''}
                </li>
              ) : (
                <li>ใส่ <code className="rounded bg-white px-1">user_id</code> จริงจากระบบ</li>
              )}
              <li>
                เปิด <strong>Dry run</strong> = ดูแผน action อย่างเดียว ไม่ยิงคูปอง/popup
              </li>
              <li>
                ปิด Dry run = รันจริงบน enrollment แบบ <code className="rounded bg-white px-1">test:</code>
              </li>
            </ol>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {!deviceScopedTrigger && (
              <div>
                <label htmlFor={testUserIdInputId} className="mb-1 block text-[10px] text-gray-400">
                  รหัสผู้ใช้ที่จะทดสอบ (User ID)
                </label>
                <input
                  id={testUserIdInputId}
                  type="text"
                  placeholder="User ID ที่จะทดสอบ"
                  value={testUserId}
                  onChange={(event) => setTestUserId(event.target.value)}
                  className="w-64 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 focus:border-primary focus:outline-none"
                />
              </div>
            )}
            {(deviceScopedTrigger || triggerType === 'first_login') && (
              <div>
                <label htmlFor={testSecondaryInputId} className="mb-1 block text-[10px] text-gray-400">
                  {deviceScopedTrigger ? 'รหัสอุปกรณ์ (individual_id)' : 'รหัสผู้ใช้ที่จะทดสอบ (User ID)'}
                </label>
                <input
                  id={testSecondaryInputId}
                  type="text"
                  placeholder={
                    deviceScopedTrigger
                      ? 'Device ID (individual_id) — ว่าง = สร้างให้อัตโนมัติ'
                      : 'User ID ที่จะทดสอบ'
                  }
                  value={deviceScopedTrigger ? testIndividualId : testUserId}
                  onChange={(event) =>
                    deviceScopedTrigger
                      ? setTestIndividualId(event.target.value)
                      : setTestUserId(event.target.value)
                  }
                  className="w-80 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 focus:border-primary focus:outline-none"
                />
              </div>
            )}
            {deviceScopedTrigger && (
              <div>
                <label htmlFor={testOptionalUserIdInputId} className="mb-1 block text-[10px] text-gray-400">
                  รหัสผู้ใช้ (User ID) — ไม่บังคับ
                </label>
                <input
                  id={testOptionalUserIdInputId}
                  type="text"
                  placeholder="User ID (optional ถ้าอยากทดสอบแบบมี login)"
                  value={testUserId}
                  onChange={(event) => setTestUserId(event.target.value)}
                  className="w-64 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 focus:border-primary focus:outline-none"
                />
              </div>
            )}
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={testDryRun}
                onChange={(event) => setTestDryRun(event.target.checked)}
              />
              Dry run (ไม่ยิงจริง)
            </label>
            <HeaderButton
              onClick={handleRunTest}
              disabled={
                testLoading ||
                (!deviceScopedTrigger &&
                  triggerType !== 'first_login' &&
                  !testUserId.trim()) ||
                (triggerType === 'first_login' && !testUserId.trim())
              }
            >
              {testLoading
                ? 'กำลังทดสอบ...'
                : triggerType === 'first_visit'
                  ? 'จำลองเข้าเว็บครั้งแรก'
                  : triggerType === 'custom'
                    ? 'จำลองลูกค้าเข้าเว็บช่วงเงื่อนไข'
                    : 'รันทดสอบ'}
            </HeaderButton>
          </div>
          {testResult && (
            <pre className="max-h-40 overflow-auto rounded-lg bg-white p-2 text-[11px] text-gray-600">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          )}
          {!testDryRun && testResult && 'howToSeePopup' in testResult && testResult.howToSeePopup && (
            <p className="text-[11px] text-blue-700">{testResult.howToSeePopup}</p>
          )}
          {!testDryRun &&
            testResult &&
            'offerIds' in testResult &&
            Array.isArray(testResult.offerIds) &&
            testResult.offerIds.length === 0 && (
              <p className="text-[11px] text-amber-700">
                ยังไม่มี show_offer ในผลรัน — เพิ่ม Action &quot;แสดง Offer&quot; เลือกคูปอง แล้วทดสอบอีกครั้ง
                (ปิด Dry run)
              </p>
            )}
          {!testDryRun &&
            testResult &&
            'individualId' in testResult &&
            testResult.individualId && (
              <p className="text-[11px] text-blue-600">
                Device <code>{testResult.individualId}</code> — เปิด shop (guest) หรือเรียก{' '}
                <code>/api/marketing-offers/active?individual_id=…</code>
              </p>
            )}
          {!testDryRun &&
            testResult &&
            'userId' in testResult &&
            testResult.userId &&
            !testResult.individualId && (
              <p className="text-[11px] text-blue-600">
                Offer ผูกกับ user <code>{testResult.userId}</code> — ต้อง{' '}
                <strong>login เป็น user นี้บน shop</strong> ถึงจะเห็น popup (เปิด guest จะไม่ขึ้น)
              </p>
            )}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-gray-500">
            {selectedCondition ? (
              <>
                เลือก <span className="font-semibold text-orange-600">If / Else</span> อยู่ —
                ปุ่มด้านล่างจะต่อเข้าเส้น <span className="font-semibold text-emerald-600">Yes</span> /{' '}
                <span className="font-semibold text-red-600">No</span> อัตโนมัติ
              </>
            ) : selection?.kind === 'trigger' ? (
              <>
                กำลังสร้าง/แก้ <span className="font-semibold text-amber-700">เงื่อนไขเริ่ม Workflow</span>{' '}
                ในแผงขวา — เพิ่มขั้นตอนถัดไปด้วยปุ่มด้านล่าง
              </>
            ) : selection?.kind === 'step' ? (
              <>
                เลือก{' '}
                <span className="font-semibold text-gray-700">{selection.step.type}</span> —
                ปุ่มด้านล่างเพิ่มต่อท้าย flow (หรือเลือก If/Else เพื่อแยกกิ่ง)
              </>
            ) : (
              <>คลิกการ์ดในแผนภาพเพื่อแก้รายละเอียด · ใช้ปุ่มด้านล่างเพิ่มขั้นตอน</>
            )}
          </div>
          {conditionCount > 0 && (
            <span
              className={`text-[11px] ${
                conditionCount > MARKETING_CONDITION_WARN_THRESHOLD
                  ? 'text-amber-600'
                  : 'text-gray-400'
              }`}
            >
              If/Else {conditionCount}/{MAX_MARKETING_CONDITION_STEPS}
            </span>
          )}
          {waitCount > 0 && (
            <span className="text-[11px] text-gray-400">
              Wait {waitCount}/{MAX_MARKETING_WAIT_STEPS}
            </span>
          )}
        </div>

        {selectedCondition ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(['yes', 'no'] as const).map((branch) => {
              const wired =
                branch === 'yes' ? selectedCondition.yesNextId : selectedCondition.noNextId;
              const label = branch === 'yes' ? 'Yes (จริง)' : 'No (เท็จ)';
              const tint =
                branch === 'yes'
                  ? 'border-emerald-200 bg-emerald-50/50'
                  : 'border-red-200 bg-red-50/50';
              const target: AddTarget = {
                mode: 'branch',
                conditionId: selectedCondition.id,
                branch,
              };
              return (
                <div key={branch} className={`rounded-lg border p-2 space-y-1.5 ${tint}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-gray-700">{label}</span>
                    <span className="text-[10px] text-gray-400">
                      {wired ? 'มีเส้นทางแล้ว · แทรกด้านหน้า' : 'ยังว่าง'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <HeaderButton onClick={() => handleAddGrantCoupon(target)}>
                      + คูปอง
                    </HeaderButton>
                    <HeaderButton onClick={() => handleAddShowOffer(target)}>+ Offer</HeaderButton>
                    <HeaderButton onClick={() => handleAddNotify(target)}>+ แจ้งเตือน</HeaderButton>
                    <HeaderButton
                      onClick={() => handleAddCondition(target)}
                      disabled={!canAddCondition}
                    >
                      + If/Else
                    </HeaderButton>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {!hasAudience && (
              <HeaderButton onClick={handleAddAudience}>+ Audience</HeaderButton>
            )}
            <HeaderButton onClick={handleAddWait} disabled={!canAddWait}>
              + Wait
            </HeaderButton>
            {!hasGate && (
              <HeaderButton onClick={handleAddGate}>+ Gate</HeaderButton>
            )}
            <HeaderButton onClick={() => handleAddGrantCoupon()}>+ แจกคูปอง</HeaderButton>
            <HeaderButton onClick={() => handleAddShowOffer()}>+ แสดง Offer</HeaderButton>
            <HeaderButton onClick={() => handleAddNotify()}>+ แจ้งเตือน</HeaderButton>
            <HeaderButton
              onClick={() => handleAddCondition()}
              disabled={!canAddCondition}
            >
              + If / Else
            </HeaderButton>
            {hasGate && (
              <span className="text-[11px] text-gray-400">
                Gate มีแล้ว (สูงสุด 1)
              </span>
            )}
          </div>
        )}

        {selectedCondition && (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
            <span className="text-[11px] text-gray-400">เพิ่มใน flow หลัก (ไม่ผูกกิ่ง):</span>
            {!hasAudience && (
              <HeaderButton onClick={handleAddAudience}>+ Audience</HeaderButton>
            )}
            <HeaderButton onClick={handleAddWait} disabled={!canAddWait}>
              + Wait
            </HeaderButton>
            {!hasGate && <HeaderButton onClick={handleAddGate}>+ Gate</HeaderButton>}
            <HeaderButton onClick={() => handleAddGrantCoupon()}>+ คูปอง</HeaderButton>
            <HeaderButton onClick={() => handleAddShowOffer()}>+ Offer</HeaderButton>
            <HeaderButton onClick={() => handleAddNotify()}>+ แจ้งเตือน</HeaderButton>
            <HeaderButton onClick={() => handleAddCondition()} disabled={!canAddCondition}>
              + If / Else
            </HeaderButton>
          </div>
        )}
      </div>

      <div className="flex h-[65vh] min-h-[520px] gap-4">
        <div className="flex-1">
          <MarketingFlowCanvas
            triggerType={triggerType}
            triggerConfig={triggerConfig}
            schedule={schedule}
            steps={steps}
            positions={positions}
            segments={segments}
            coupons={coupons}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onNodeMove={handleNodeMove}
            onDeleteStep={handleDeleteStep}
            onUpdateTriggerType={handleUpdateTriggerType}
            onConnectSteps={handleConnectSteps}
            onDisconnectEdge={handleDisconnectEdge}
          />
        </div>
        <div className="w-80 shrink-0 overflow-y-auto">
          <MarketingStepSidePanel
            selection={selection}
            triggerType={triggerType}
            triggerConfig={triggerConfig}
            segments={segments}
            coupons={coupons}
            steps={steps}
            schedule={schedule}
            onOpenScheduleEditor={() => setScheduleOpen(true)}
            onUpdateTriggerType={handleUpdateTriggerType}
            onUpdateTrigger={setTriggerConfig}
            onUpdateStep={handleUpdateStep}
            onDeleteStep={handleDeleteStep}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * `/marketing/workflows/new` renders `CreateWorkflowScreen`;
 * `/marketing/workflows/:id` renders the full Agently-style canvas editor.
 */
export default function MarketingWorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <CreateWorkflowScreen />;
  return <EditWorkflowScreen id={id} />;
}
