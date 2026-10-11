// ui-metadata-migration: static labels and UI notices only
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  getAnalyticsFunnel,
  type AnalyticsFunnelResponse,
  type AnalyticsFunnelStep,
  type AnalyticsPlatform,
  type GetAnalyticsFunnelParams,
} from '@josh/shared-api';
import { Table, TableColumn } from '@josh/shared-ui-web';
import AdminListHeader from '../../components/AdminListHeader';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale, Alert, Button, Loading } from "@cp/ui";
type AudienceFilter = GetAnalyticsFunnelParams['audience'] & string;
type PlatformFilter = AnalyticsPlatform | 'all';

const AUDIENCE_OPTIONS: { value: AudienceFilter; label: string }[] = [
  { value: 'all', get label(){return __uiText("ทั้งหมด");} },
  { value: 'guest', get label(){return __uiText("ยังไม่เข้าสู่ระบบ");} },
  { value: 'logged_in', get label(){return __uiText("เข้าสู่ระบบแล้ว");} },
];

const PLATFORM_OPTIONS: { value: PlatformFilter; label: string }[] = [
  { value: 'all', get label(){return __uiText("ทั้งหมด");} },
  { value: 'web', get label(){return __uiText("Web");} },
  { value: 'ios', get label(){return __uiText("iOS");} },
  { value: 'android', get label(){return __uiText("Android");} },
];

const STEP_LABELS: Record<AnalyticsFunnelStep, string> = {
  get view_item(){return __uiText("ดูสินค้า");},
  get add_to_cart(){return __uiText("ใส่ตะกร้า");},
  get begin_checkout(){return __uiText("เริ่มชำระเงิน");},
  get purchase(){return __uiText("สั่งซื้อสำเร็จ");},
};

type FunnelRow = {
  step: AnalyticsFunnelStep;
  label: string;
  session_count: number;
  conversion_from_previous: number | null;
};

function toDateInputValue(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(date);
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return toDateInputValue(d);
}

function defaultTo(): string {
  return toDateInputValue(new Date());
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export default function MarketingJourneyFunnel() {
  __useUiLocale();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [audience, setAudience] = useState<AudienceFilter>('all');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [data, setData] = useState<AnalyticsFunnelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fromInputId = useId();
  const toInputId = useId();

  const load = useCallback(() => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    getAnalyticsFunnel({ from, to, audience, platform })
      .then(setData)
      .catch((err: { response?: { data?: { message?: string } } }) => {
        setError(err?.response?.data?.message || __uiMessage("โหลด journey funnel ไม่สำเร็จ"));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [from, to, audience, platform]);

  useEffect(() => {
    load();
  }, [load]);

  const rows: FunnelRow[] = useMemo(
    () =>
      (data?.steps ?? []).map((step) => ({
        step: step.step,
        label: STEP_LABELS[step.step] ?? step.step,
        session_count: step.session_count,
        conversion_from_previous: step.conversion_from_previous,
      })),
    [data],
  );

  const columns: TableColumn<FunnelRow>[] = [
    { key: 'label', label: __uiText("ขั้นตอน") },
    {
      key: 'session_count',
      label: __uiText("จำนวนการเข้าใช้งาน"),
      align: 'right',
      render: (value: number) => (
        <span className="font-semibold tabular-nums text-gray-900">{value.toLocaleString()}</span>
      ),
    },
    {
      key: 'conversion_from_previous',
      label: __uiText("ไปต่อจากขั้นก่อนหน้า"),
      align: 'right',
      render: (value: number | null) => (
        <span className={`tabular-nums ${value !== null ? 'text-gray-900' : 'text-gray-400'}`}>
          {formatPercent(value)}
        </span>
      ),
    },
  ];

  const firstStepCount = rows[0]?.session_count ?? 0;
  const lastStepCount = rows[rows.length - 1]?.session_count ?? 0;
  const overallConversion = firstStepCount > 0 ? lastStepCount / firstStepCount : null;

  return (
    <div className="cp-management-page flex flex-col gap-5">
      <AdminListHeader
        title={__uiText("เส้นทางของลูกค้า")}
        subtitle={__uiText("จำนวนลูกค้าที่ผ่านแต่ละขั้นของการใช้งาน")}
      >
        <Button icon="refresh" onClick={load} disabled={loading}>
          {loading ? __uiText("กำลังโหลด...") : __uiText("รีเฟรช")}
        </Button>
      </AdminListHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={fromInputId} className="mb-1 block text-[11px] font-medium text-gray-500">{__uiText("จาก")}</label>
          <input
            id={fromInputId}
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-primary focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor={toInputId} className="mb-1 block text-[11px] font-medium text-gray-500">{__uiText("ถึง")}</label>
          <input
            id={toInputId}
            type="date"
            value={to}
            min={from}
            max={defaultTo()}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-primary focus:outline-none"
          />
        </div>

        <div>
          <span className="mb-1 block text-[11px] font-medium text-gray-500">{__uiText("กลุ่มลูกค้า")}</span>
          <div className="flex gap-1">
            {AUDIENCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setAudience(option.value)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                  audience === option.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1 block text-[11px] font-medium text-gray-500">{__uiText("ช่องทาง")}</span>
          <div className="flex gap-1">
            {PLATFORM_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPlatform(option.value)}
                className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                  platform === option.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <Alert tone="danger">{(typeof error === 'string' ? __uiText(error) : error)}</Alert>
      )}

      {!error && loading && !data && (
        <Loading />
      )}

      {!error && data && (
        <>
          <Table
            columns={columns}
            data={rows}
            idKey="step"
            emptyTitle="ยังไม่มีข้อมูลในช่วงที่เลือก"
            emptyDescription={__uiText("ลองเลือกช่วงวันที่ที่ยาวขึ้น หรือเปลี่ยนกลุ่มลูกค้าและช่องทาง")}
          />

          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <span>
              {__uiText("การเข้าใช้งานที่มีการเข้าสู่ระบบ:")}{' '}
              <span className="font-semibold tabular-nums text-gray-900">
                {data.login_sessions.toLocaleString()}
              </span>
            </span>
            <span>
              {__uiText("จากดูสินค้าจนสั่งซื้อสำเร็จ:")}{' '}
              <span className="font-semibold tabular-nums text-gray-900">
                {formatPercent(overallConversion)}
              </span>
            </span>
          </div>

          {firstStepCount === 0 && (
            <p className="text-xs text-gray-400">{__uiText("ยังไม่มีลูกค้าในช่วงหรือตัวกรองที่เลือก ลองเลือกช่วงวันที่ที่ยาวขึ้น")}</p>
          )}
        </>
      )}
    </div>
  );
}
