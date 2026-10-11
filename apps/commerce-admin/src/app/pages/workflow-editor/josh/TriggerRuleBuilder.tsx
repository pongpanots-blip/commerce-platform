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
import { Button, Chip, FormField, uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
const FIELD_LABEL = 'mb-1 block text-xs font-medium text-on-surface';
const INPUT_CLASS =
  'w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none';
const HINT_CLASS = 'text-[11px] leading-relaxed text-on-surface-variant';
const STEP_HEADING_CLASS = 'mb-1.5 text-xs font-semibold text-on-surface';

const RULE_BLOCK_CLASS = 'rounded-lg border border-secondary-container bg-surface-container-low p-3';

const PAGE_AFFINITY_PAGE_TYPE_OPTIONS: Array<{ value: MarketingPageAffinityPageType; label: string }> = [
  { value: 'pdp', get label(){return __uiText("หน้าสินค้า");} },
  { value: 'category', get label(){return __uiText("หน้าหมวดหมู่");} },
  { value: 'cart', get label(){return __uiText("ตะกร้า");} },
  { value: 'path', get label(){return __uiText("หน้าที่ระบุเอง");} },
];

const CUSTOM_SOURCE_OPERATOR_OPTIONS: Array<{
  value: MarketingCustomSourceOperator;
  label: string;
}> = [
  { value: '==', get label(){return __uiText("เท่ากับ");} },
  { value: '!=', get label(){return __uiText("ไม่เท่ากับ");} },
  { value: 'contains', get label(){return __uiText("มีคำว่า");} },
  { value: '>', get label(){return __uiText("มากกว่า");} },
  { value: '>=', get label(){return __uiText("ตั้งแต่");} },
  { value: '<', get label(){return __uiText("น้อยกว่า");} },
  { value: '<=', get label(){return __uiText("ไม่เกิน");} },
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
      setProbeError(err?.response?.data?.message || __uiMessage("ดึงข้อมูลไม่สำเร็จ"));
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
    <div className="space-y-2 border-t border-secondary-container pt-3">
      <FormField label={__uiText("เปิดหรือปิดเงื่อนไขอย่างไร")}>
        <Select
          className="w-full"
          value={source.kind}
          onChange={(event) => {
            clearProbeState();
            patchSource(
              event.target.value === 'http' ? httpSource : { kind: 'manual' },
            );
          }}
        >
          <option value="manual">{__uiText("เปิดและปิดเอง (กดเปิดใช้งานเมื่อเริ่ม หยุดชั่วคราวเมื่อจบ)")}</option>
          <option value="http">{__uiText("ให้ระบบเช็คจากลิงก์ข้อมูลภายนอก เช่น ข้อมูลสภาพอากาศ")}</option>
        </Select>
      </FormField>

      {source.kind === 'http' && (
        <div className="space-y-2">
          <FormField label={__uiText("ลิงก์ข้อมูล")}>
            <input
              type="text"
              placeholder="https://api.openweathermap.org/data/2.5/weather?q=Bangkok&appid=..."
              className={`${INPUT_CLASS} font-mono text-xs`}
              value={source.url}
              onChange={(event) => {
                clearProbeState();
                patchSource({ ...source, url: event.target.value });
              }}
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={probing || !source.url.trim()}
              onClick={handleProbe}
            >
              {probing ? __uiText("กำลังดึงข้อมูล...") : __uiText("ลองดึงข้อมูล")}
            </Button>
            <span className={HINT_CLASS}>{__uiText("ดึงข้อมูลตัวอย่างเพื่อเลือกค่าที่จะใช้")}</span>
          </div>
          {probeError && (
            <p className="rounded-md bg-danger-container px-2 py-1.5 text-[11px] text-danger">
              {__uiText("ดึงข้อมูลไม่สำเร็จ: {0}", { "0": typeof probeError === 'string' ? __uiText(probeError) : probeError })}
            </p>
          )}
          {probeFields && (
            <div className="overflow-hidden rounded-lg border border-secondary-container">
              <div className="border-b border-secondary-container bg-surface-container-low px-2.5 py-1.5 text-[11px] font-medium text-on-surface">
                {__uiText("เลือกค่าที่จะใช้ ({0} รายการ) กดแล้วระบบเติมตำแหน่งและค่าให้", { "0": probeFields.length })}</div>
              {probeFields.length === 0 ? (
                <p className={`px-2.5 py-2 ${HINT_CLASS}`}>{__uiText("ไม่พบค่าที่เลือกได้")}</p>
              ) : (
                <div className="max-h-48 overflow-auto">
                  {probeFields.map((field) => (
                    <label
                      key={field.path}
                      className={`flex cursor-pointer items-center gap-2 border-b border-secondary-container px-2.5 py-1.5 last:border-b-0 ${
                        selectedProbePath === field.path ? 'bg-primary/10' : 'hover:bg-surface-container-low'
                      }`}
                    >
                      <input
                        type="radio"
                        name="custom-source-probe-field"
                        checked={selectedProbePath === field.path}
                        onChange={() => handleSelectField(field)}
                        className="shrink-0"
                      />
                      <span className="flex-1 truncate font-mono text-[11px] text-on-surface">
                        {field.path}
                      </span>
                      <span className="shrink-0 text-[11px] text-on-surface-variant">
                        {field.sampleValue}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {probeTruncated && (
                <p className="border-t border-secondary-container px-2.5 py-1 text-[11px] text-warn">
                  {__uiText("แสดงสูงสุด 100 รายการ ข้อมูลบางส่วนถูกตัด")}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <FormField label={__uiText("ตำแหน่งค่า")}>
              <input
                type="text"
                placeholder={__uiText("weather.0.main")}
                className={`${INPUT_CLASS} font-mono text-xs`}
                value={source.valuePath}
                onChange={(event) => patchSource({ ...source, valuePath: event.target.value })}
              />
            </FormField>
            <FormField label={__uiText("เงื่อนไข")}>
              <Select
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
            </FormField>
            <FormField label={__uiText("ค่าที่ต้องการ")}>
              <input
                type="text"
                placeholder={__uiText("Rain")}
                className={INPUT_CLASS}
                value={String(source.value ?? '')}
                onChange={(event) => patchSource({ ...source, value: event.target.value })}
              />
            </FormField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-on-surface">
              <label htmlFor={intervalInputId}>{__uiText("เช็คทุก")}</label>
              <input
                id={intervalInputId}
                type="number"
                min={1}
                className="w-16 rounded-lg border border-outline-variant bg-surface-container-lowest px-2 py-1 text-xs text-on-surface focus:border-primary focus:outline-none"
                value={source.intervalMinutes ?? 5}
                onChange={(event) =>
                  patchSource({
                    ...source,
                    intervalMinutes: Math.max(1, Number(event.target.value) || 5),
                  })
                }
              />
              {__uiText("นาที")}</div>
            <Button
              size="sm"
              disabled={checking || !source.url.trim() || !source.valuePath.trim()}
              onClick={handleCheck}
            >
              {checking ? __uiText("กำลังเช็ค...") : __uiText("ทดสอบดึงค่าตอนนี้")}
            </Button>
          </div>
          {checkResult && (
            <p
              className={`rounded-md px-2 py-1.5 text-[11px] ${
                checkResult.error
                  ? 'bg-danger-container text-danger'
                  : checkResult.matched
                    ? 'bg-ok-container text-ok'
                    : 'bg-warn-container text-warn'
              }`}
            >
              {checkResult.error
                ? __uiText("ดึงข้อมูลไม่สำเร็จ: {0}", {"0": checkResult.error})
                : checkResult.matched
                  ? __uiText("ค่าตอนนี้คือ \"{0}\" เข้าเงื่อนไขแล้ว ข้อความอัตโนมัติจะทำงาน", {"0": checkResult.actualValue})
                  : __uiText("ค่าตอนนี้คือ \"{0}\" ยังไม่เข้าเงื่อนไข ข้อความอัตโนมัติจะยังไม่ทำงาน", {"0": checkResult.actualValue})}
            </p>
          )}
          <p className={HINT_CLASS}>
            {__uiText("ตัวอย่างช่วงฝนตก: ใส่ลิงก์ข้อมูลสภาพอากาศ ตำแหน่งค่า weather.0.main เงื่อนไขเท่ากับ ค่า Rain ระบบจะเช็คให้เองระหว่างเปิดใช้งาน ไม่ต้องกดหยุดเมื่อฝนหยุด (ถ้าดึงข้อมูลไม่สำเร็จ จะถือว่ายังไม่เข้าเงื่อนไข)")}</p>
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
  { value: 'single_order_total', get label(){return __uiText("ยอดออเดอร์ครั้งเดียว");}, get unit(){return __uiText("บาท");} },
  { value: 'lifetime_spend', get label(){return __uiText("ยอดสั่งซื้อสะสมทั้งหมด");}, get unit(){return __uiText("บาท");} },
  { value: 'lifetime_order_count', get label(){return __uiText("จำนวนออเดอร์สะสม");}, get unit(){return __uiText("ครั้ง");} },
];

/**
 * Visual builder for order milestones — ประกอบเงื่อนไขจาก dropdown:
 * [ตัวชี้วัด] [ถึง/เกิน] [ตัวเลข] เช่น "ยอดออเดอร์ครั้งเดียว ≥ 5,000 บาท".
 */
export function OrderMilestoneFields({
  config,
  onUpdateTrigger,
}: {
  config: MarketingOrderMilestoneTriggerConfig;
  onUpdateTrigger: (config: MarketingTriggerConfig) => void;
}) {
  __useUiLocale();
  const metric = config.metric ?? 'single_order_total';
  const unit =
    ORDER_MILESTONE_METRIC_OPTIONS.find((opt) => opt.value === metric)?.unit ?? __uiText("บาท");

  const patch = (next: Partial<MarketingOrderMilestoneTriggerConfig>) =>
    onUpdateTrigger({
      metric,
      operator: config.operator ?? '>=',
      value: config.value ?? 5000,
      ...next,
    });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
        <FormField label={__uiText("วัดจาก")}>
          <Select
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
        </FormField>
        <FormField label={__uiText("เงื่อนไข")}>
          <Select
            className="w-full"
            value={config.operator ?? '>='}
            onChange={(event) => patch({ operator: event.target.value as '>=' | '>' })}
          >
            <option value=">=">{__uiText("ถึงหรือเกิน")}</option>
            <option value=">">{__uiText("มากกว่า")}</option>
          </Select>
        </FormField>
        <FormField label={__uiText("ค่าเป้าหมาย ({0})", { "0": unit })}>
          <input
            type="number"
            min={1}
            className={`${INPUT_CLASS} w-36`}
            value={config.value ?? 5000}
            onChange={(event) =>
              patch({ value: Math.max(1, Number(event.target.value) || 1) })
            }
          />
        </FormField>
      </div>
      <p className="rounded-md bg-surface-container-lowest px-2 py-1.5 text-[11px] text-on-surface">
        {__uiText("สรุป: ลูกค้าที่")}{' '}
        <strong>
          {ORDER_MILESTONE_METRIC_OPTIONS.find((opt) => opt.value === metric)?.label}
        </strong>{' '}
        {config.operator === '>' ? __uiText("มากกว่า") : __uiText("ถึงหรือเกิน")}{' '}
        <strong>{Number(config.value ?? 5000).toLocaleString()}</strong> {unit} {__uiText("ทำงาน")}<strong>{__uiText("ครั้งแรกที่เข้าเงื่อนไข")}</strong> {__uiText("(คนละ 1 ครั้ง)")}</p>
      <p className={HINT_CLASS}>
        {__uiText("นับจากออเดอร์ที่ชำระเงินแล้ว ระบบตรวจทุกประมาณ 15 นาที เฉพาะลูกค้าที่มีออเดอร์ใหม่ เหมาะกับแจกคูปองหรือส่งข้อความขอบคุณ")}</p>
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
export function ScheduledTriggerFields({
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

  return (
    <div className="space-y-3">
      <FormField label={__uiText("เวลา")} className="w-32">
        <input
          type="time"
          className={INPUT_CLASS}
          value={config.time ?? '18:00'}
          onChange={(event) => onUpdateTrigger({ ...config, time: event.target.value })}
        />
      </FormField>
      <div>
        <span className={FIELD_LABEL}>{__uiText("วัน (ไม่เลือก = ทุกวัน)")}</span>
        <div className="flex flex-wrap gap-1.5">
          {SCHEDULED_DOW_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                days.includes(opt.value)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-secondary-container bg-surface-container-lowest text-on-surface-variant'
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
      <p className="rounded-md bg-surface-container-lowest px-2 py-1.5 text-[11px] text-on-surface">
        {__uiText("สรุป: ส่งทุก")}{' '}
        {days.length === 0
          ? __uiText("วัน")
          : days
              .map((d) => SCHEDULED_DOW_OPTIONS.find((opt) => opt.value === d)?.label)
              .join(', ')}{' '}
        {__uiText("เวลา")} <strong>{config.time ?? '18:00'}</strong> {__uiText("น. ให้กลุ่มเป้าหมายที่เลือก (ไม่เลือก = ทุกคน) คนละ 1 ครั้งต่อรอบ")}</p>
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

  return (
    <div className="grid grid-cols-2 gap-2">
      <FormField label={__uiText(hoursLabel)}>
        <input
          type="number"
          min={0}
          className={INPUT_CLASS}
          value={hours}
          onChange={(event) =>
            onChange({ hours: Math.max(0, Number(event.target.value) || 0), minutes })
          }
        />
      </FormField>
      <FormField label={__uiText(minutesLabel)}>
        <input
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
      </FormField>
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
      setError(err?.response?.data?.message || __uiMessage("บันทึกชุดเงื่อนไขไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const name = presets.find((p) => p.id === selectedId)?.name ?? '';
    if (!window.confirm(__uiText("ลบชุดเงื่อนไข \"{0}\"? ข้อความอัตโนมัติที่นำไปใช้แล้วจะไม่เปลี่ยน", { "0": name }))) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMarketingTriggerPreset(selectedId);
      setPresets((prev) => prev.filter((p) => p.id !== selectedId));
      setSelectedId('');
    } catch (err: any) {
      setError(err?.response?.data?.message || __uiMessage("ลบชุดเงื่อนไขไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-secondary-container bg-surface-container-lowest p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={presetSelectId} className="text-xs font-semibold text-on-surface">
          {__uiText("ชุดเงื่อนไขที่บันทึกไว้")}</label>
        {savingName === null && (
          <Button variant="ghost" size="sm" icon="add" onClick={() => setSavingName('')}>
            {__uiText("บันทึกเงื่อนไขนี้ไว้ใช้ซ้ำ")}</Button>
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
            {presets.length === 0 ? __uiText("ยังไม่มีชุดเงื่อนไขที่บันทึกไว้") : __uiText("เลือกชุดเงื่อนไขเพื่อนำมาใช้")}
          </option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name} · {typeTitleOf(preset.trigger_type)}
            </option>
          ))}
        </Select>
        {selectedId && (
          <Button
            variant="danger-ghost"
            size="sm"
            icon="delete"
            disabled={busy}
            onClick={handleDelete}
            title={__uiText("ลบชุดเงื่อนไขที่เลือก")}
          >
            {__uiText("ลบ")}</Button>
        )}
      </div>

      {savingName !== null && (
        <div className="flex flex-wrap items-end gap-1.5">
          <FormField label={__uiText("ชื่อชุดเงื่อนไข")} className="flex-1">
            <input
              type="text"
              autoFocus
              placeholder={__uiText("เช่น ตะกร้าค้าง 30 นาที")}
              className={INPUT_CLASS}
              value={savingName}
              onChange={(event) => setSavingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSave();
                if (event.key === 'Escape') setSavingName(null);
              }}
            />
          </FormField>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !savingName.trim()}
            onClick={handleSave}
          >
            {busy ? __uiText("กำลังบันทึก...") : __uiText("บันทึก")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSavingName(null)}>
            {__uiText("ยกเลิก")}</Button>
        </div>
      )}

      {error && <p className="text-[11px] text-danger">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
      <p className={HINT_CLASS}>
        {__uiText("เลือกแล้วระบบคัดลอกประเภทและค่ามาใส่ที่นี่ แก้ต่อได้โดยไม่กระทบชุดที่บันทึกไว้")}</p>
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
                  ? 'border-primary bg-primary/5 ring-1 ring-primary text-on-surface'
                  : 'border-secondary-container bg-surface-container-lowest text-on-surface-variant hover:border-outline-variant'
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
                : 'border-secondary-container bg-surface-container-lowest hover:border-outline-variant'
            }`}
          >
            <div className="text-sm font-semibold text-on-surface">{card.title}</div>
            <div className="mt-0.5 text-[11px] text-on-surface-variant">{card.description}</div>
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
        setError(__uiMessage("ไม่พบรหัสสินค้า \"{0}\"", {"0": trimmed}));
        onResolve(null);
      } else {
        setResolved({ sku: result.sku, name: result.name });
        onResolve(result.productId);
      }
    } catch {
      setError(__uiMessage("ค้นหารหัสสินค้าไม่สำเร็จ"));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div>
      <label htmlFor={skuInputId} className={FIELD_LABEL}>{__uiText("รหัสสินค้า")}</label>
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
        <Button
          size="sm"
          className="shrink-0"
          disabled={resolving || !sku.trim()}
          onClick={handleResolve}
        >
          {resolving ? __uiText("กำลังค้นหา...") : __uiText("ค้นหา")}
        </Button>
      </div>
      {resolved ? (
        <p className="mt-1 rounded-md bg-ok-container px-2 py-1 text-[11px] text-ok">
          <span className="font-mono">{resolved.sku}</span>
          {resolved.name ? ` ${resolved.name}` : ''}
        </p>
      ) : entityId ? (
        <p className={`mt-1 ${HINT_CLASS}`}>
          {__uiText("ใช้สินค้าเดิมอยู่")} <span className="font-mono">{entityId.slice(0, 8)}…</span> {__uiText("พิมพ์รหัสสินค้าใหม่แล้วกดค้นหาเพื่อเปลี่ยน")}</p>
      ) : (
        <p className={`mt-1 ${HINT_CLASS}`}>{__uiText("พิมพ์รหัสสินค้าแล้วกดค้นหา ระบบจะจับคู่สินค้าให้")}</p>
      )}
      {error && <p className="mt-1 text-[11px] text-danger">{(typeof error === 'string' ? __uiText(error) : error)}</p>}
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
      <FormField label={__uiText("ประเภทหน้า")}>
        <Select
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
      </FormField>

      {pageType === 'pdp' && (
        <ProductSkuField
          entityId={triggerConfig.entityId ?? null}
          onResolve={(productId) => patch({ entityId: productId })}
        />
      )}

      {pageType === 'category' && (
        <FormField label={__uiText("รหัสหมวดหมู่")}>
          <input
            type="text"
            placeholder="00000000-0000-0000-0000-000000000000"
            className={`${INPUT_CLASS} font-mono text-xs`}
            value={triggerConfig.entityId ?? ''}
            onChange={(event) => patch({ entityId: event.target.value.trim() || null })}
          />
        </FormField>
      )}

      {pageType === 'path' && (
        <FormField label={__uiText("ที่อยู่หน้าเว็บ")}>
          <input
            type="text"
            placeholder="/shop/product/detail/..."
            className={`${INPUT_CLASS} font-mono text-xs`}
            value={triggerConfig.path ?? ''}
            onChange={(event) => patch({ path: event.target.value || null })}
          />
        </FormField>
      )}

      <FormField label={__uiText("เข้าชมอย่างน้อย (ครั้ง)")}>
        <input
          type="number"
          min={1}
          className={INPUT_CLASS}
          value={triggerConfig.minViews ?? 3}
          onChange={(event) => patch({ minViews: Math.max(1, Number(event.target.value) || 1) })}
        />
      </FormField>

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold text-primary">{__uiText("จุดเริ่ม")}</div>
          <h3 className="mt-0.5 text-[15px] font-semibold text-on-surface">
            {isCreate ? __uiText("ตั้งเงื่อนไขเริ่ม") : __uiText("เงื่อนไขเริ่ม")}
          </h3>
          <p className={`mt-1 ${HINT_CLASS}`}>
            {__uiText("เลือกประเภทด้านล่างแล้วปรับค่าให้ตรงแคมเปญ เปลี่ยนประเภทได้ก่อนเปิดใช้งาน")}</p>
        </div>
        {typeTitle && <Chip tone="primary">{typeTitle}</Chip>}
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
        <div className={STEP_HEADING_CLASS}>
          {__uiText("1 · เลือกประเภทเงื่อนไข")}</div>
        <TriggerTypeChips value={triggerType} onChange={onUpdateTriggerType} />
      </div>

      <div>
        <div className={STEP_HEADING_CLASS}>
          {__uiText("2 · ตั้งค่ารายละเอียด")}</div>

      {triggerType === 'cart_idle' && (
        <div className={RULE_BLOCK_CLASS}>
          <span className={FIELD_LABEL}>{__uiText("ตะกร้าค้างนานเท่าไรจึงเริ่ม")}</span>
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
          <FormField
            label={__uiText("นับการเข้าสู่ระบบย้อนหลัง (นาที)")}
            hint={__uiText("ต้องตั้งช่วงเวลาทำงานด้วย ระบบนับลูกค้าที่เข้าสู่ระบบในช่วงนี้")}
          >
          <input
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
          </FormField>
        </div>
      )}

      {triggerType === 'first_login' && (
        <div className={RULE_BLOCK_CLASS}>
          <p className="text-xs text-on-surface-variant">
            {__uiText("เริ่มเมื่อลูกค้าเข้าสู่ระบบหรือสมัครครั้งแรกบนแอปหรือเว็บ ไม่ต้องตั้งค่าเพิ่ม")}</p>
        </div>
      )}

      {triggerType === 'first_visit' && (
        <div className={RULE_BLOCK_CLASS}>
          <p className="text-xs text-on-surface-variant">
            {__uiText("เริ่มเมื่อเปิดเว็บครั้งแรกบนเครื่องนี้ ยังไม่เข้าสู่ระบบก็ได้ เหมาะกับการแสดงข้อเสนอหรือป๊อปอัป")}</p>
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
          <FormField label={__uiText("ชื่อเงื่อนไข")}>
            <input
              type="text"
              placeholder={__uiText("เช่น ช่วงฝนตก, ลดราคาหน้าร้าน")}
              className={INPUT_CLASS}
              value={(triggerConfig as MarketingCustomTriggerConfig).label ?? ''}
              onChange={(event) =>
                onUpdateTrigger({
                  ...(triggerConfig as MarketingCustomTriggerConfig),
                  label: event.target.value,
                })
              }
            />
          </FormField>
          <FormField label={__uiText("คำอธิบาย (ไม่บังคับ)")}>
            <input
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
          </FormField>
          <FormField
            label={__uiText("แสดงหลังลูกค้าอยู่บนเว็บครบ (นาที)")}
            hint={__uiText("0 = แสดงทันทีที่เข้าเว็บ เช่น 1 = อยู่บนเว็บครบ 1 นาทีแล้วจึงแสดง (นับจากการเข้าครั้งแรกในรอบ 6 ชั่วโมง)")}
          >
            <input
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
          </FormField>
          <CustomSourceFields
            config={triggerConfig as MarketingCustomTriggerConfig}
            onUpdateTrigger={onUpdateTrigger}
          />
          <p className={HINT_CLASS}>
            {__uiText("วิธีใช้: กดเปิดใช้งานเมื่อเงื่อนไขเริ่ม (เช่น ฝนเริ่มตก) ทุกคนที่เข้าเว็บช่วงนั้นจะได้รับ (วันละไม่เกิน 1 ครั้งต่อเครื่อง) แล้วกดหยุดชั่วคราวเมื่อจบช่วง หรือให้ระบบเช็คจากลิงก์ข้อมูลด้านบน ตั้งช่วงเวลาทำงานเพื่อจำกัดวันและเวลาได้ และบันทึกไว้ใช้ซ้ำได้")}</p>
        </div>
      )}
      </div>

      {showScheduleStrip && (
        <div className="space-y-2 border-t border-secondary-container pt-3">
          <div className={STEP_HEADING_CLASS}>
            {__uiText("3 · ช่วงเวลาทำงาน")}</div>
          <div className="flex flex-wrap gap-1.5">
            {scheduleStripChips(schedule ?? null).map((chip) => (
              <Chip key={chip}>{chip}</Chip>
            ))}
          </div>
          {onOpenScheduleEditor && (
            <Button size="sm" icon="schedule" onClick={onOpenScheduleEditor}>
              {__uiText("แก้ไขช่วงเวลา")}</Button>
          )}
        </div>
      )}
    </div>
  );
}

// ui-notice-migration: UI notices and field errors; editable content and payload fields remain data
