// ui-metadata-migration: static labels and UI notices only
import { useEffect, useId, useState } from 'react';
import {
  checkMarketingCustomSource,
  createMarketingTriggerPreset,
  deleteMarketingTriggerPreset,
  getMarketingTriggerPresets,
  probeMarketingCustomSource,
  resolveMarketingProductSku,
  type MarketingCustomSourceCheckResult,
  type MarketingCustomSourceOperator,
  type MarketingCustomSourceProbeField,
  type MarketingCustomTriggerConfig,
  type MarketingCustomTriggerSource,
  type MarketingOrderMilestoneMetric,
  type MarketingOrderMilestoneTriggerConfig,
  type MarketingPageAffinityPageType,
  type MarketingScheduledTriggerConfig,
  type MarketingPageAffinityTriggerConfig,
  type MarketingTriggerConfig,
  type MarketingTriggerPreset,
  type MarketingTriggerType,
  type MarketingWorkflowSchedule,
} from './shared-api';
import { Select } from './shared-ui';
import { scheduleStripChips, TRIGGER_TYPE_CARDS } from './trigger-rule.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const FIELD_LABEL = 'mb-1 block text-xs font-medium text-gray-500';
const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none';

const RULE_BLOCK_CLASS = 'rounded-lg border border-gray-200 bg-gray-50 p-3';

const PAGE_AFFINITY_PAGE_TYPE_OPTIONS: Array<{ value: MarketingPageAffinityPageType; label: string }> = [
  { value: 'pdp', get label(){return __uiText("สินค้า (PDP)");} },
  { value: 'category', get label(){return __uiText("หมวดหมู่ (Category)");} },
  { value: 'cart', get label(){return __uiText("ตะกร้า (Cart)");} },
  { value: 'path', get label(){return __uiText("Path เอง");} },
];

const CUSTOM_SOURCE_OPERATOR_OPTIONS: Array<{
  value: MarketingCustomSourceOperator;
  label: string;
}> = [
  { value: '==', get label(){return __uiText("เท่ากับ");} },
  { value: '!=', get label(){return __uiText("ไม่เท่ากับ");} },
  { value: 'contains', get label(){return __uiText("มีคำว่า");} },
  { value: '>', get label(){return __uiText(">");} },
  { value: '>=', get label(){return __uiText("≥");} },
  { value: '<', get label(){return __uiText("<");} },
  { value: '<=', get label(){return __uiText("≤");} },
];

/**
 * External on/off source for a `custom` trigger — เช่น เช็คฝนตกจาก weather API.
 * Manual = กด Activate/Pause เอง; http = backend ดึงค่าจาก URL แล้วเทียบเงื่อนไข.
 */
function CustomSourceFields({
  config,
  onUpdateTrigger,
}: {
  config: MarketingCustomTriggerConfig;
  onUpdateTrigger: (config: MarketingTriggerConfig) => void;
}) {
  __useUiLocale();
  const source = config.source ?? { kind: 'manual' as const };
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<MarketingCustomSourceCheckResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeFields, setProbeFields] = useState<MarketingCustomSourceProbeField[] | null>(null);
  const [probeTruncated, setProbeTruncated] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [selectedProbePath, setSelectedProbePath] = useState<string | null>(null);
  const sourceKindSelectId = useId();
  const urlInputId = useId();
  const valuePathInputId = useId();
  const operatorSelectId = useId();
  const valueInputId = useId();
  const intervalInputId = useId();

  const clearProbeState = () => {
    setProbeFields(null);
    setProbeError(null);
    setProbeTruncated(false);
    setSelectedProbePath(null);
  };

  const patchSource = (next: MarketingCustomTriggerSource | undefined) => {
    setCheckResult(null);
    onUpdateTrigger({ ...config, source: next });
  };

  const httpSource =
    source.kind === 'http'
      ? source
      : {
          kind: 'http' as const,
          url: '',
          valuePath: '',
          operator: '==' as MarketingCustomSourceOperator,
          value: '',
          intervalMinutes: 5,
        };

  const handleProbe = async () => {
    if (source.kind !== 'http') return;
    setProbing(true);
    setProbeError(null);
    setProbeFields(null);
    setProbeTruncated(false);
    setSelectedProbePath(null);
    try {
      const result = await probeMarketingCustomSource({ url: source.url });
      if (result.error) {
        setProbeError(result.error);
        return;
      }
      setProbeFields(result.fields ?? []);
      setProbeTruncated(Boolean(result.truncated));
    } catch (err: any) {
      setProbeError(err?.response?.data?.message || __uiMessage("เรียก fetch ไม่สำเร็จ"));
    } finally {
      setProbing(false);
    }
  };

  const handleSelectField = (field: MarketingCustomSourceProbeField) => {
    if (source.kind !== 'http') return;
    setSelectedProbePath(field.path);
    setCheckResult(null);
    onUpdateTrigger({
      ...config,
      source: {
        ...source,
        valuePath: field.path,
        value: field.sampleValue,
      },
    });
  };

  const handleCheck = async () => {
    if (source.kind !== 'http') return;
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await checkMarketingCustomSource({
        url: source.url,
        valuePath: source.valuePath,
        operator: source.operator,
        value: source.value,
      });
      setCheckResult(result);
    } catch (err: any) {
      setCheckResult({
        matched: false,
        error: err?.response?.data?.message || 'เรียกเช็คไม่สำเร็จ',
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-dashed border-gray-200 pt-2">
      <div>
        <label htmlFor={sourceKindSelectId} className={FIELD_LABEL}>{__uiText("แหล่งข้อมูลเงื่อนไข (เปิด/ปิดจากอะไร)")}</label>
        <Select
          id={sourceKindSelectId}
          className="w-full"
          value={source.kind}
          onChange={(event) => {
            clearProbeState();
            patchSource(
              event.target.value === 'http' ? httpSource : { kind: 'manual' },
            );
          }}
        >
          <option value="manual">{__uiText("เปิด/ปิดเอง (กด Activate เมื่อเริ่ม, Pause เมื่อจบ)")}</option>
          <option value="http">{__uiText("เช็คอัตโนมัติจาก URL (API ภายนอก เช่น weather API)")}</option>
        </Select>
      </div>

      {source.kind === 'http' && (
        <div className="space-y-2">
          <div>
            <label htmlFor={urlInputId} className={FIELD_LABEL}>{__uiText("URL (ตอบกลับเป็น JSON)")}</label>
            <input
              id={urlInputId}
              type="text"
              placeholder="https://api.openweathermap.org/data/2.5/weather?q=Bangkok&appid=..."
              className={`${INPUT_CLASS} font-mono text-xs`}
              value={source.url}
              onChange={(event) => {
                clearProbeState();
                patchSource({ ...source, url: event.target.value });
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={probing || !source.url.trim()}
              onClick={handleProbe}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {probing ? __uiText("กำลัง fetch...") : __uiText("ลอง fetch")}
            </button>
            <span className="text-[11px] text-gray-400">{__uiText("ดึง sample เพื่อเลือก field")}</span>
          </div>
          {probeError && (
            <p className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-600">
              {__uiText("ดึงค่าไม่สำเร็จ: ")}{(typeof (probeError) === 'string' ? __uiText(probeError) : probeError)}
            </p>
          )}
          {probeFields && (
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <div className="border-b border-gray-200 bg-gray-50 px-2.5 py-1.5 text-[11px] font-medium text-gray-600">
                {__uiText("เลือก field (")}{probeFields.length}{__uiText(") — กดแล้วเติม path + ค่าที่ต้องการ")}</div>
              {probeFields.length === 0 ? (
                <p className="px-2.5 py-2 text-[11px] text-gray-500">{__uiText("ไม่พบ field ที่เลือกได้")}</p>
              ) : (
                <div className="max-h-48 overflow-auto">
                  {probeFields.map((field) => (
                    <label
                      key={field.path}
                      className={`flex cursor-pointer items-center gap-2 border-b border-gray-50 px-2.5 py-1.5 last:border-b-0 ${
                        selectedProbePath === field.path ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="custom-source-probe-field"
                        checked={selectedProbePath === field.path}
                        onChange={() => handleSelectField(field)}
                        className="shrink-0"
                      />
                      <span className="flex-1 truncate font-mono text-[11px] text-gray-700">
                        {field.path}
                      </span>
                      <span className="shrink-0 text-[11px] text-emerald-700">
                        {field.sampleValue}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {probeTruncated && (
                <p className="border-t border-gray-100 px-2.5 py-1 text-[10px] text-amber-700">
                  {__uiText("แสดงสูงสุด 100 field — response ถูกตัดบางส่วน")}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor={valuePathInputId} className={FIELD_LABEL}>{__uiText("อ่านค่าจาก (dot path)")}</label>
              <input
                id={valuePathInputId}
                type="text"
                placeholder={__uiText("weather.0.main")}
                className={`${INPUT_CLASS} font-mono text-xs`}
                value={source.valuePath}
                onChange={(event) => patchSource({ ...source, valuePath: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor={operatorSelectId} className={FIELD_LABEL}>{__uiText("เงื่อนไข")}</label>
              <Select
                id={operatorSelectId}
                className="w-full"
                value={source.operator}
                onChange={(event) =>
                  patchSource({
                    ...source,
                    operator: event.target.value as MarketingCustomSourceOperator,
                  })
                }
              >
                {CUSTOM_SOURCE_OPERATOR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor={valueInputId} className={FIELD_LABEL}>{__uiText("ค่าที่ต้องการ")}</label>
              <input
                id={valueInputId}
                type="text"
                placeholder={__uiText("Rain")}
                className={INPUT_CLASS}
                value={String(source.value ?? '')}
                onChange={(event) => patchSource({ ...source, value: event.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <label htmlFor={intervalInputId}>{__uiText("เช็คทุก")}</label>
              <input
                id={intervalInputId}
                type="number"
                min={1}
                className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-primary focus:outline-none"
                value={source.intervalMinutes ?? 5}
                onChange={(event) =>
                  patchSource({
                    ...source,
                    intervalMinutes: Math.max(1, Number(event.target.value) || 5),
                  })
                }
              />
              {__uiText("นาที")}</div>
            <button
              type="button"
              disabled={checking || !source.url.trim() || !source.valuePath.trim()}
              onClick={handleCheck}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {checking ? __uiText("กำลังเช็ค...") : __uiText("ทดสอบดึงค่าตอนนี้")}
            </button>
          </div>
          {checkResult && (
            <p
              className={`rounded-md px-2 py-1.5 text-[11px] ${
                checkResult.error
                  ? 'bg-red-50 text-red-600'
                  : checkResult.matched
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
              }`}
            >
              {checkResult.error
                ? __uiText("ดึงค่าไม่สำเร็จ: {0}", {"0": checkResult.error})
                : __uiText("ค่าปัจจุบัน = \"{0}\" → {1}", {"0": checkResult.actualValue, "1": checkResult.matched ? 'เข้าเงื่อนไข ✓ (workflow จะทำงาน)' : 'ยังไม่เข้าเงื่อนไข (workflow จะเงียบ)'})}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-gray-400">
            {__uiText("ตัวอย่างฝนตก: URL ของ weather API + path ")}<code className="rounded bg-white px-1">{__uiText("weather.0.main")}</code>{' '}
            {__uiText("เงื่อนไข ")}<strong>{__uiText("เท่ากับ")}</strong> {__uiText(" ค่า ")}<code className="rounded bg-white px-1">{__uiText("Rain")}</code> {__uiText(" — ระบบเช็คให้เองระหว่าง Active ไม่ต้องมากด Pause เมื่อฝนหยุด (ดึงไม่สำเร็จ = ถือว่าไม่เข้าเงื่อนไข)")}</p>
        </div>
      )}
    </div>
  );
}

const ORDER_MILESTONE_METRIC_OPTIONS: Array<{
  value: MarketingOrderMilestoneMetric;
  label: string;
  unit: string;
}> = [
  { value: 'single_order_total', get label(){return __uiText("ยอดออเดอร์ครั้งเดียว");}, unit: 'บาท' },
  { value: 'lifetime_spend', get label(){return __uiText("ยอดสั่งซื้อสะสมทั้งหมด");}, unit: 'บาท' },
  { value: 'lifetime_order_count', get label(){return __uiText("จำนวนออเดอร์สะสม");}, unit: 'ครั้ง' },
];

/**
 * Visual builder for order milestones — ประกอบเงื่อนไขจาก dropdown:
 * [ตัวชี้วัด] [ถึง/เกิน] [ตัวเลข] เช่น "ยอดออเดอร์ครั้งเดียว ≥ 5,000 บาท".
 */
function OrderMilestoneFields({
  config,
  onUpdateTrigger,
}: {
  config: MarketingOrderMilestoneTriggerConfig;
  onUpdateTrigger: (config: MarketingTriggerConfig) => void;
}) {
  __useUiLocale();
  const metric = config.metric ?? 'single_order_total';
  const unit =
    ORDER_MILESTONE_METRIC_OPTIONS.find((opt) => opt.value === metric)?.unit ?? 'บาท';

  const patch = (next: Partial<MarketingOrderMilestoneTriggerConfig>) =>
    onUpdateTrigger({
      metric,
      operator: config.operator ?? '>=',
      value: config.value ?? 5000,
      ...next,
    });
  const metricSelectId = useId();
  const operatorSelectId = useId();
  const valueInputId = useId();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
        <div>
          <label htmlFor={metricSelectId} className={FIELD_LABEL}>{__uiText("ตัวชี้วัด")}</label>
          <Select
            id={metricSelectId}
            className="w-full"
            value={metric}
            onChange={(event) =>
              patch({ metric: event.target.value as MarketingOrderMilestoneMetric })
            }
          >
            {ORDER_MILESTONE_METRIC_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.unit})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={operatorSelectId} className={FIELD_LABEL}>{__uiText("เงื่อนไข")}</label>
          <Select
            id={operatorSelectId}
            className="w-full"
            value={config.operator ?? '>='}
            onChange={(event) => patch({ operator: event.target.value as '>=' | '>' })}
          >
            <option value=">=">{__uiText("ถึง/เกิน (≥)")}</option>
            <option value=">">{__uiText("มากกว่า (&gt;)")}</option>
          </Select>
        </div>
        <div>
          <label htmlFor={valueInputId} className={FIELD_LABEL}>{__uiText("ค่าเป้าหมาย (")}{unit})</label>
          <input
            id={valueInputId}
            type="number"
            min={1}
            className={`${INPUT_CLASS} w-36`}
            value={config.value ?? 5000}
            onChange={(event) =>
              patch({ value: Math.max(1, Number(event.target.value) || 1) })
            }
          />
        </div>
      </div>
      <p className="rounded-md bg-white px-2 py-1.5 text-[11px] text-gray-600">
        {__uiText("สรุป: ลูกค้าที่")}{' '}
        <strong>
          {ORDER_MILESTONE_METRIC_OPTIONS.find((opt) => opt.value === metric)?.label}
        </strong>{' '}
        {config.operator === '>' ? __uiText("มากกว่า") : __uiText("ถึง/เกิน")}{' '}
        <strong>{Number(config.value ?? 5000).toLocaleString()}</strong> {unit} {__uiText(" — ทำงาน")}<strong>{__uiText("ครั้งแรกที่เข้าเงื่อนไข")}</strong> {__uiText(" (คนละ 1 ครั้ง)")}</p>
      <p className="text-[11px] leading-relaxed text-gray-400">
        {__uiText("นับจากออเดอร์ที่ชำระเงินแล้ว · ระบบสแกนทุก ~15 นาที เฉพาะคนที่มีออเดอร์ใหม่ช่วงนี้ · เหมาะกับ แจกคูปอง/แจ้งเตือน ขอบคุณลูกค้า")}</p>
    </div>
  );
}

const SCHEDULED_DOW_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, get label(){return __uiText("อา");} },
  { value: 1, get label(){return __uiText("จ");} },
  { value: 2, get label(){return __uiText("อ");} },
  { value: 3, get label(){return __uiText("พ");} },
  { value: 4, get label(){return __uiText("พฤ");} },
  { value: 5, get label(){return __uiText("ศ");} },
  { value: 6, get label(){return __uiText("ส");} },
];

/** Visual builder for the clock trigger — เวลา + วันในสัปดาห์ (ว่าง = ทุกวัน). */
function ScheduledTriggerFields({
  config,
  onUpdateTrigger,
}: {
  config: MarketingScheduledTriggerConfig;
  onUpdateTrigger: (config: MarketingTriggerConfig) => void;
}) {
  __useUiLocale();
  const days = config.daysOfWeek ?? [];
  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort();
    onUpdateTrigger({ ...config, daysOfWeek: next });
  };
  const timeInputId = useId();

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={timeInputId} className={FIELD_LABEL}>{__uiText("เวลา")}</label>
        <input
          id={timeInputId}
          type="time"
          className={`${INPUT_CLASS} w-32`}
          value={config.time ?? '18:00'}
          onChange={(event) => onUpdateTrigger({ ...config, time: event.target.value })}
        />
      </div>
      <div>
        <span className={FIELD_LABEL}>{__uiText("วัน (ไม่เลือก = ทุกวัน)")}</span>
        <div className="flex flex-wrap gap-1.5">
          {SCHEDULED_DOW_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                days.includes(opt.value)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-gray-200 bg-white text-gray-500'
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
        </div>
      </div>
      <p className="rounded-md bg-white px-2 py-1.5 text-[11px] text-gray-600">
        {__uiText("สรุป: ยิงทุก")}{' '}
        {days.length === 0
          ? __uiText("วัน")
          : days
              .map((d) => SCHEDULED_DOW_OPTIONS.find((opt) => opt.value === d)?.label)
              .join(', ')}{' '}
        {__uiText("เวลา ")}<strong>{config.time ?? '18:00'}</strong> {__uiText(" น. — ส่งให้ Audience ที่เลือกด้านล่าง (ไม่เลือก Audience = ทุกคน) คนละ 1 ครั้งต่อรอบ")}</p>
    </div>
  );
}

function DurationFields({
  hours,
  minutes,
  onChange,
  hoursLabel = 'ชั่วโมง',
  minutesLabel = 'นาที',
}: {
  hours: number;
  minutes: number;
  onChange: (next: { hours: number; minutes: number }) => void;
  hoursLabel?: string;
  minutesLabel?: string;
}) {
  __useUiLocale();
  const hoursInputId = useId();
  const minutesInputId = useId();

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label htmlFor={hoursInputId} className={FIELD_LABEL}>{__uiText(hoursLabel)}</label>
        <input
          id={hoursInputId}
          type="number"
          min={0}
          className={INPUT_CLASS}
          value={hours}
          onChange={(event) =>
            onChange({ hours: Math.max(0, Number(event.target.value) || 0), minutes })
          }
        />
      </div>
      <div>
        <label htmlFor={minutesInputId} className={FIELD_LABEL}>{__uiText(minutesLabel)}</label>
        <input
          id={minutesInputId}
          type="number"
          min={0}
          max={59}
          className={INPUT_CLASS}
          value={minutes}
          onChange={(event) =>
            onChange({
              hours,
              minutes: Math.min(59, Math.max(0, Number(event.target.value) || 0)),
            })
          }
        />
      </div>
    </div>
  );
}

/**
 * "Trigger ที่บันทึกไว้" — pick a saved preset to apply, or save the current
 * type+config as a new preset. Applying copies the values onto the workflow;
 * editing the preset later does not change workflows that already used it.
 */
function TriggerPresetBar({
  triggerType,
  triggerConfig,
  onApply,
}: {
  triggerType: MarketingTriggerType;
  triggerConfig: MarketingTriggerConfig;
  onApply: (preset: MarketingTriggerPreset) => void;
}) {
  __useUiLocale();
  const [presets, setPresets] = useState<MarketingTriggerPreset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [savingName, setSavingName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presetSelectId = useId();
  const presetNameInputId = useId();

  useEffect(() => {
    let cancelled = false;
    getMarketingTriggerPresets()
      .then((rows) => {
        if (!cancelled) setPresets(Array.isArray(rows) ? rows : []);
      })
      .catch((err: unknown) => {
        console.error('load marketing trigger presets error:', err);
        if (!cancelled) setPresets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const typeTitleOf = (type: MarketingTriggerType) =>
    TRIGGER_TYPE_CARDS.find((c) => c.type === type)?.title ?? type;

  const handleApply = (id: string) => {
    setSelectedId(id);
    const preset = presets.find((p) => p.id === id);
    if (preset) onApply(preset);
  };

  const handleSave = async () => {
    const name = (savingName ?? '').trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createMarketingTriggerPreset({
        name,
        trigger_type: triggerType,
        trigger_config: triggerConfig,
      });
      setPresets((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setSavingName(null);
    } catch (err: any) {
      setError(err?.response?.data?.message || __uiMessage("บันทึก Preset ไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMarketingTriggerPreset(selectedId);
      setPresets((prev) => prev.filter((p) => p.id !== selectedId));
      setSelectedId('');
    } catch (err: any) {
      setError(err?.response?.data?.message || __uiMessage("ลบ Preset ไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={presetSelectId} className="text-[10px] font-semibold tracking-wide text-gray-400">
          {__uiText("TRIGGER ที่บันทึกไว้ (PRESET)")}</label>
        {savingName === null && (
          <button
            type="button"
            onClick={() => setSavingName('')}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {__uiText("+ บันทึก trigger นี้เป็น Preset")}</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          id={presetSelectId}
          className="min-w-0 flex-1"
          value={selectedId}
          onChange={(event) => handleApply(event.target.value)}
        >
          <option value="">
            {presets.length === 0 ? __uiText("ยังไม่มี Preset ที่บันทึกไว้") : __uiText("— เลือก Preset เพื่อนำมาใช้ —")}
          </option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name} · {typeTitleOf(preset.trigger_type)}
            </option>
          ))}
        </Select>
        {selectedId && (
          <button
            type="button"
            disabled={busy}
            onClick={handleDelete}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] text-gray-500 hover:border-red-200 hover:text-red-500 disabled:opacity-50"
            title={__uiText("ลบ Preset ที่เลือก")}
          >
            {__uiText("ลบ")}</button>
        )}
      </div>

      {savingName !== null && (
        <div className="flex flex-wrap items-end gap-1.5">
          <div className="min-w-0 flex-1">
            <label htmlFor={presetNameInputId} className="mb-0.5 block text-[10px] text-gray-400">
              {__uiText("ชื่อ Preset")}</label>
            <input
              id={presetNameInputId}
              type="text"
              autoFocus
              placeholder={__uiText("ตั้งชื่อ Preset เช่น ตะกร้าค้าง 30 นาที")}
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs text-gray-700 focus:border-primary focus:outline-none"
              value={savingName}
              onChange={(event) => setSavingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSave();
                if (event.key === 'Escape') setSavingName(null);
              }}
            />
          </div>
          <button
            type="button"
            disabled={busy || !savingName.trim()}
            onClick={handleSave}
            className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
          </button>
          <button
            type="button"
            onClick={() => setSavingName(null)}
            className="text-[11px] text-gray-400 hover:text-gray-600"
          >
            {__uiText("ยกเลิก")}</button>
        </div>
      )}

      {error && <p className="text-[11px] text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
      <p className="text-[10px] leading-relaxed text-gray-400">
        {__uiText("เลือก Preset = คัดลอกประเภท + ค่ามาใส่ workflow นี้ (แก้ต่อได้ ไม่กระทบ Preset เดิม)")}</p>
    </div>
  );
}

export type TriggerRuleBuilderProps = {
  triggerType: MarketingTriggerType;
  triggerConfig: MarketingTriggerConfig;
  onUpdateTriggerType: (type: MarketingTriggerType) => void;
  onUpdateTrigger: (config: MarketingTriggerConfig) => void;
  /** When set, show schedule chips under the rule blocks. */
  schedule?: MarketingWorkflowSchedule;
  showScheduleStrip?: boolean;
  onOpenScheduleEditor?: () => void;
  /** `create` emphasizes authoring on the new-workflow screen. */
  variant?: 'create' | 'panel';
};

export function TriggerTypeChips({
  value,
  onChange,
  size = 'md',
}: {
  value: MarketingTriggerType;
  onChange: (type: MarketingTriggerType) => void;
  size?: 'sm' | 'md';
}) {
  const isSm = size === 'sm';

  if (isSm) {
    return (
      <div className="flex flex-wrap gap-1">
        {TRIGGER_TYPE_CARDS.map((card) => {
          const selected = value === card.type;
          return (
            <button
              key={card.type}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onChange(card.type);
              }}
              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                selected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary text-gray-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}
            >
              {card.title}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {TRIGGER_TYPE_CARDS.map((card) => {
        const selected = value === card.type;
        return (
          <button
            key={card.type}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange(card.type);
            }}
            className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
              selected
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-semibold text-gray-800">{card.title}</div>
            <div className="mt-0.5 text-[11px] text-gray-500">{card.description}</div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * SKU-based product picker for `page_affinity` pdp rules — admins type the SKU
 * (e.g. J1234-S); we resolve it server-side and store the product UUID that
 * shop page views actually report as `entity_id`.
 */
function ProductSkuField({
  entityId,
  onResolve,
}: {
  entityId: string | null;
  onResolve: (productId: string | null) => void;
}) {
  __useUiLocale();
  const [sku, setSku] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState<{ sku: string; name: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skuInputId = useId();

  const handleResolve = async () => {
    const trimmed = sku.trim();
    if (!trimmed) return;
    setResolving(true);
    setError(null);
    try {
      const result = await resolveMarketingProductSku(trimmed);
      if (!result) {
        setResolved(null);
        setError(__uiMessage("ไม่พบ SKU \"{0}\"", {"0": trimmed}));
        onResolve(null);
      } else {
        setResolved({ sku: result.sku, name: result.name });
        onResolve(result.productId);
      }
    } catch {
      setError(__uiMessage("ค้นหา SKU ไม่สำเร็จ"));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div>
      <label htmlFor={skuInputId} className={FIELD_LABEL}>{__uiText("SKU สินค้า")}</label>
      <div className="flex gap-1.5">
        <input
          id={skuInputId}
          type="text"
          placeholder={__uiText("เช่น J1234-S")}
          className={`${INPUT_CLASS} font-mono text-xs`}
          value={sku}
          onChange={(event) => setSku(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleResolve();
            }
          }}
        />
        <button
          type="button"
          disabled={resolving || !sku.trim()}
          onClick={handleResolve}
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {resolving ? __uiText("กำลังค้นหา...") : __uiText("ค้นหา")}
        </button>
      </div>
      {resolved ? (
        <p className="mt-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
          ✓ {resolved.sku}
          {resolved.name ? ` — ${resolved.name}` : ''}
        </p>
      ) : entityId ? (
        <p className="mt-1 text-[11px] text-gray-400">
          {__uiText("ใช้สินค้าเดิม (ID: ")}<span className="font-mono">{entityId.slice(0, 8)}…</span>{__uiText(") — พิมพ์ SKU ใหม่แล้วกดค้นหาเพื่อเปลี่ยน")}</p>
      ) : (
        <p className="mt-1 text-[11px] text-gray-400">{__uiText("พิมพ์ SKU แล้วกดค้นหา — ระบบจะจับคู่สินค้าให้")}</p>
      )}
      {error && <p className="mt-1 text-[11px] text-red-500">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
    </div>
  );
}

function PageAffinityFields({
  triggerConfig,
  onUpdateTrigger,
}: {
  triggerConfig: Partial<MarketingPageAffinityTriggerConfig>;
  onUpdateTrigger: (config: MarketingTriggerConfig) => void;
}) {
  __useUiLocale();
  const pageType = triggerConfig.pageType ?? 'pdp';
  const pageTypeSelectId = useId();
  const categoryIdInputId = useId();
  const pathInputId = useId();
  const minViewsInputId = useId();

  const patch = (next: Partial<MarketingPageAffinityTriggerConfig>) =>
    onUpdateTrigger({
      pageType,
      entityId: triggerConfig.entityId ?? null,
      path: triggerConfig.path ?? null,
      minViews: triggerConfig.minViews ?? 3,
      windowHours: triggerConfig.windowHours ?? 24,
      windowMinutes: triggerConfig.windowMinutes ?? 0,
      ...next,
    } as MarketingTriggerConfig);

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={pageTypeSelectId} className={FIELD_LABEL}>{__uiText("ประเภทหน้า")}</label>
        <Select
          id={pageTypeSelectId}
          className="w-full"
          value={pageType}
          onChange={(event) => patch({ pageType: event.target.value as MarketingPageAffinityPageType })}
        >
          {PAGE_AFFINITY_PAGE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      {pageType === 'pdp' && (
        <ProductSkuField
          entityId={triggerConfig.entityId ?? null}
          onResolve={(productId) => patch({ entityId: productId })}
        />
      )}

      {pageType === 'category' && (
        <div>
          <label htmlFor={categoryIdInputId} className={FIELD_LABEL}>{__uiText("รหัสหมวดหมู่ (Category ID)")}</label>
          <input
            id={categoryIdInputId}
            type="text"
            placeholder="00000000-0000-0000-0000-000000000000"
            className={`${INPUT_CLASS} font-mono text-xs`}
            value={triggerConfig.entityId ?? ''}
            onChange={(event) => patch({ entityId: event.target.value.trim() || null })}
          />
        </div>
      )}

      {pageType === 'path' && (
        <div>
          <label htmlFor={pathInputId} className={FIELD_LABEL}>{__uiText("เส้นทางหน้าเว็บ (Path)")}</label>
          <input
            id={pathInputId}
            type="text"
            placeholder="/shop/product/detail/..."
            className={INPUT_CLASS}
            value={triggerConfig.path ?? ''}
            onChange={(event) => patch({ path: event.target.value || null })}
          />
        </div>
      )}

      <div>
        <label htmlFor={minViewsInputId} className={FIELD_LABEL}>{__uiText("เข้าชมขั้นต่ำ (ครั้ง)")}</label>
        <input
          id={minViewsInputId}
          type="number"
          min={1}
          className={INPUT_CLASS}
          value={triggerConfig.minViews ?? 3}
          onChange={(event) => patch({ minViews: Math.max(1, Number(event.target.value) || 1) })}
        />
      </div>

      <div>
        <span className={FIELD_LABEL}>{__uiText("ภายในช่วงเวลา")}</span>
        <DurationFields
          hours={triggerConfig.windowHours ?? 24}
          minutes={triggerConfig.windowMinutes ?? 0}
          onChange={({ hours, minutes }) => patch({ windowHours: hours, windowMinutes: minutes })}
        />
      </div>
    </div>
  );
}

export function TriggerRuleBuilder({
  triggerType,
  triggerConfig,
  onUpdateTriggerType,
  onUpdateTrigger,
  schedule,
  showScheduleStrip,
  onOpenScheduleEditor,
  variant = 'panel',
}: TriggerRuleBuilderProps) {
  __useUiLocale();
  const typeTitle = TRIGGER_TYPE_CARDS.find((c) => c.type === triggerType)?.title;
  const isCreate = variant === 'create';
  const lookbackMinutesInputId = useId();
  const customLabelInputId = useId();
  const customDescriptionInputId = useId();
  const customDelayMinutesInputId = useId();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold tracking-wide text-gray-400">{__uiText("TRIGGER")}</div>
          <h3 className="mt-0.5 text-sm font-semibold text-gray-800">
            {isCreate ? __uiText("สร้างเงื่อนไขเริ่ม Workflow") : __uiText("เงื่อนไขเริ่ม Workflow")}
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            {__uiText("เลือกประเภทด้านล่าง แล้วปรับค่าให้ตรงแคมเปญ — เปลี่ยนประเภทได้ตลอดก่อน Activate")}</p>
        </div>
        {typeTitle && (
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {typeTitle}
          </span>
        )}
      </div>

      <TriggerPresetBar
        triggerType={triggerType}
        triggerConfig={triggerConfig}
        onApply={(preset) => {
          // Order matters: switching the type resets config to that type's
          // defaults, so apply the preset's config after.
          onUpdateTriggerType(preset.trigger_type);
          onUpdateTrigger(preset.trigger_config);
        }}
      />

      <div>
        <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-gray-400">
          {__uiText("1 · เลือกประเภทเงื่อนไข")}</div>
        <TriggerTypeChips value={triggerType} onChange={onUpdateTriggerType} />
      </div>

      <div>
        <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-gray-400">
          {__uiText("2 · ตั้งค่ารายละเอียด")}</div>

      {triggerType === 'cart_idle' && (
        <div className={RULE_BLOCK_CLASS}>
          <span className={FIELD_LABEL}>{__uiText("ค้างนานเท่าไหร่จึงเริ่ม workflow")}</span>
          <DurationFields
            hours={(triggerConfig as { idleHours?: number }).idleHours ?? 24}
            minutes={(triggerConfig as { idleMinutes?: number }).idleMinutes ?? 0}
            onChange={({ hours, minutes }) =>
              onUpdateTrigger({ idleHours: hours, idleMinutes: minutes })
            }
          />
        </div>
      )}

      {triggerType === 'page_affinity' && (
        <div className={RULE_BLOCK_CLASS}>
          <PageAffinityFields
            triggerConfig={triggerConfig as Partial<MarketingPageAffinityTriggerConfig>}
            onUpdateTrigger={onUpdateTrigger}
          />
        </div>
      )}

      {triggerType === 'session_in_window' && (
        <div className={RULE_BLOCK_CLASS}>
          <label htmlFor={lookbackMinutesInputId} className={FIELD_LABEL}>{__uiText("นับ login ย้อนหลังกี่นาที")}</label>
          <input
            id={lookbackMinutesInputId}
            type="number"
            min={1}
            className={INPUT_CLASS}
            value={(triggerConfig as { lookbackMinutes?: number }).lookbackMinutes ?? 20}
            onChange={(event) =>
              onUpdateTrigger({
                lookbackMinutes: Math.max(1, Number(event.target.value) || 1),
              })
            }
          />
          <p className="mt-1 text-[11px] text-gray-400">
            {__uiText("ต้องตั้ง Schedule — รวมคนที่ login ในช่วงนี้ และคนใน segment (ถ้าเลือก)")}</p>
        </div>
      )}

      {triggerType === 'first_login' && (
        <div className={RULE_BLOCK_CLASS}>
          <p className="text-xs text-gray-500">
            {__uiText("เริ่มเมื่อลูกค้า login / สมัครครั้งแรกบนแอปหรือเว็บ (ไม่ต้องตั้งค่าเพิ่ม)")}</p>
        </div>
      )}

      {triggerType === 'first_visit' && (
        <div className={RULE_BLOCK_CLASS}>
          <p className="text-xs text-gray-500">
            {__uiText("เริ่มเมื่อเปิดเว็บครั้งแรกบนอุปกรณ์นี้ (นับจาก device id) — guest ได้ แนะนำใช้กับ แสดง Offer / popup")}</p>
        </div>
      )}

      {triggerType === 'scheduled' && (
        <div className={RULE_BLOCK_CLASS}>
          <ScheduledTriggerFields
            config={triggerConfig as MarketingScheduledTriggerConfig}
            onUpdateTrigger={onUpdateTrigger}
          />
        </div>
      )}

      {triggerType === 'order_milestone' && (
        <div className={RULE_BLOCK_CLASS}>
          <OrderMilestoneFields
            config={triggerConfig as MarketingOrderMilestoneTriggerConfig}
            onUpdateTrigger={onUpdateTrigger}
          />
        </div>
      )}

      {triggerType === 'custom' && (
        <div className={`${RULE_BLOCK_CLASS} space-y-3`}>
          <div>
            <label htmlFor={customLabelInputId} className={FIELD_LABEL}>{__uiText("ชื่อเงื่อนไข (ตั้งเอง)")}</label>
            <input
              id={customLabelInputId}
              type="text"
              placeholder={__uiText("เช่น \"ช่วงฝนตก\", \"Flash Sale หน้าร้าน\"")}
              className={INPUT_CLASS}
              value={(triggerConfig as MarketingCustomTriggerConfig).label ?? ''}
              onChange={(event) =>
                onUpdateTrigger({
                  ...(triggerConfig as MarketingCustomTriggerConfig),
                  label: event.target.value,
                })
              }
            />
          </div>
          <div>
            <label htmlFor={customDescriptionInputId} className={FIELD_LABEL}>{__uiText("คำอธิบาย (ไม่บังคับ)")}</label>
            <input
              id={customDescriptionInputId}
              type="text"
              placeholder={__uiText("โน้ตให้ทีม เช่น เปิดเมื่อฝนเริ่มตกหน้าสาขา")}
              className={INPUT_CLASS}
              value={(triggerConfig as MarketingCustomTriggerConfig).description ?? ''}
              onChange={(event) =>
                onUpdateTrigger({
                  ...(triggerConfig as MarketingCustomTriggerConfig),
                  description: event.target.value || undefined,
                })
              }
            />
          </div>
          <div>
            <label htmlFor={customDelayMinutesInputId} className={FIELD_LABEL}>{__uiText("เด้งหลังลูกค้าอยู่บนเว็บครบ (นาที)")}</label>
            <input
              id={customDelayMinutesInputId}
              type="number"
              min={0}
              className={INPUT_CLASS}
              value={(triggerConfig as MarketingCustomTriggerConfig).delayMinutes ?? 0}
              onChange={(event) =>
                onUpdateTrigger({
                  ...(triggerConfig as MarketingCustomTriggerConfig),
                  delayMinutes: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                })
              }
            />
            <p className="mt-1 text-[11px] text-gray-400">
              {__uiText("0 = เด้งทันทีที่เข้าเว็บ · เช่น 1 = อยู่บนเว็บครบ 1 นาทีแล้วค่อยเด้ง (นับจากเข้าครั้งแรกในรอบ 6 ชม.)")}</p>
          </div>
          <CustomSourceFields
            config={triggerConfig as MarketingCustomTriggerConfig}
            onUpdateTrigger={onUpdateTrigger}
          />
          <p className="text-[11px] leading-relaxed text-gray-400">
            {__uiText("วิธีใช้: กด ")}<strong>{__uiText("Activate")}</strong> {__uiText(" เมื่อเงื่อนไขเริ่ม (เช่น ฝนเริ่มตก) — ทุกคนที่เข้าเว็บช่วงนั้น จะเข้า workflow (สูงสุดวันละ 1 ครั้ง/เครื่อง) แล้วกด ")}<strong>{__uiText("Pause")}</strong> {__uiText(" เมื่อจบช่วง (หรือให้เช็คจาก URL อัตโนมัติด้านบน) · ใช้ Schedule จำกัดวัน/เวลาเพิ่มได้ · บันทึกเป็น Preset ไว้ใช้ซ้ำได้")}</p>
        </div>
      )}
      </div>

      {showScheduleStrip && (
        <div className="space-y-2 border-t border-gray-100 pt-3">
          <div className="text-[10px] font-semibold tracking-wide text-gray-400">
            {__uiText("3 · ช่วงเวลาทำงาน (Schedule)")}</div>
          <div className="flex flex-wrap gap-1.5">
            {scheduleStripChips(schedule ?? null).map((chip) => (
              <span
                key={chip}
                className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600"
              >
                {chip}
              </span>
            ))}
          </div>
          {onOpenScheduleEditor && (
            <button
              type="button"
              onClick={onOpenScheduleEditor}
              className="text-xs font-medium text-primary hover:underline"
            >
              {__uiText("แก้ไขช่วงเวลา")}</button>
          )}
        </div>
      )}
    </div>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
