import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MARKETING_BUILTIN_TEMPLATE_LABELS,
  MARKETING_EXPRESSION_FIELD_OPTIONS,
  MARKETING_EXPRESSION_FIELD_TYPES,
  MARKETING_EXPRESSION_OPS_BY_TYPE,
  MARKETING_NOTIFY_CHANNELS,
  MARKETING_NOTIFY_TEMPLATE_KEYS,
  getMarketingNotifyTemplates,
  listPopupDefinitions,
  validateMarketingExpression,
  type MarketingAction,
  type MarketingNotifyTemplate,
  type MarketingExpressionField,
  type MarketingExpressionOperator,
  type MarketingNotifyChannel,
  type MarketingStep,
  type MarketingTriggerConfig,
  type MarketingTriggerType,
  type MarketingWorkflowSchedule,
  type PopupDefinitionSummary,
  type UserSegmentListItem,
} from './shared-api';
import { Select } from './shared-ui';
import { TRIGGER_NODE_ID } from './MarketingFlowCanvas';
import { ADMIN_ROUTES } from './admin-routes';
import { useBannerLibrary } from './banner-library';
import { TriggerRuleBuilder } from './TriggerRuleBuilder';
import { formatDurationLabel } from './trigger-rule.helpers';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export type MarketingSidePanelSelection =
  | { kind: 'trigger' }
  | { kind: 'step'; step: MarketingStep };

type CouponOption = { id: string; coupon_code: string; title: string };

type Props = {
  selection: MarketingSidePanelSelection | null;
  triggerType: MarketingTriggerType;
  triggerConfig: MarketingTriggerConfig;
  segments: UserSegmentListItem[];
  coupons: CouponOption[];
  steps: MarketingStep[];
  schedule?: MarketingWorkflowSchedule;
  onOpenScheduleEditor?: () => void;
  onUpdateTriggerType: (type: MarketingTriggerType) => void;
  onUpdateTrigger: (config: MarketingTriggerConfig) => void;
  onUpdateStep: (stepId: string, next: MarketingStep) => void;
  onDeleteStep: (stepId: string) => void;
};

const FIELD_LABEL = 'mb-1 block text-xs font-medium text-gray-500';
const INPUT_CLASS =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none';

function SectionTitle({ kind, title }: { kind: string; title: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-wide text-gray-400">{kind}</div>
      <h3 className="mt-0.5 text-sm font-semibold text-gray-800">{title}</h3>
    </div>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  __useUiLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-medium text-red-500 hover:underline"
    >
      {__uiText("ลบขั้นตอนนี้")}</button>
  );
}

function AudienceFields({
  step,
  segments,
  onUpdateStep,
  onDeleteStep,
}: {
  step: Extract<MarketingStep, { type: 'audience' }>;
  segments: UserSegmentListItem[];
  onUpdateStep: (next: MarketingStep) => void;
  onDeleteStep: () => void;
}) {
  __useUiLocale();
  const include = step.segmentIds ?? [];
  const exclude = step.excludeSegmentIds ?? [];
  const mode: 'everyone' | 'segments' = include.length > 0 ? 'segments' : 'everyone';

  const toggle = (key: 'segmentIds' | 'excludeSegmentIds', id: string) => {
    const current = step[key] ?? [];
    const next = current.includes(id)
      ? current.filter((s) => s !== id)
      : [...current, id];
    onUpdateStep({ ...step, [key]: next });
  };

  const setMode = (nextMode: 'everyone' | 'segments') => {
    if (nextMode === 'everyone') {
      onUpdateStep({ ...step, segmentIds: [] });
      return;
    }
    onUpdateStep({ ...step, segmentIds: step.segmentIds ?? [] });
  };

  const activeSegments = segments.filter((s) => s.is_active);

  return (
    <div className="space-y-4">
      <SectionTitle kind="AUDIENCE" title={__uiText("กลุ่มเป้าหมาย")} />

      <div className="grid grid-cols-1 gap-2">
        <label
          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            mode === 'everyone'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-gray-200 bg-white'
          }`}
        >
          <input
            type="radio"
            name={`audience-mode-${step.id}`}
            checked={mode === 'everyone'}
            onChange={() => setMode('everyone')}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-gray-800">{__uiText("ทุกคนที่เข้าเงื่อนไข trigger")}</span>
            <span className="mt-0.5 block text-xs text-gray-500">
              {__uiText("ไม่กรอง include segment (ยัง exclude ได้ด้านล่าง) — หรือลบขั้นตอน Audience ทั้งก้อนได้")}</span>
          </span>
        </label>
        <label
          className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            mode === 'segments'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-gray-200 bg-white'
          }`}
        >
          <input
            type="radio"
            name={`audience-mode-${step.id}`}
            checked={mode === 'segments'}
            onChange={() => setMode('segments')}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-gray-800">{__uiText("เลือก segment")}</span>
            <span className="mt-0.5 block text-xs text-gray-500">
              {__uiText("รวมเฉพาะคนที่อยู่ใน segment ที่เลือก")}</span>
          </span>
        </label>
      </div>

      {mode === 'segments' && (
        <div>
          <span className={FIELD_LABEL}>{__uiText("รวมเฉพาะ segment (เลือกได้หลายรายการ)")}</span>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
            {activeSegments.length === 0 && (
              <p className="px-1 py-1 text-xs text-gray-400">{__uiText("ยังไม่มี segment")}</p>
            )}
            {activeSegments.map((segment) => (
              <label
                key={segment.id}
                className="flex items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={include.includes(segment.id)}
                  onChange={() => toggle('segmentIds', segment.id)}
                />
                {segment.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <span className={FIELD_LABEL}>{__uiText("ไม่รวม segment (exclude)")}</span>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
          {activeSegments.length === 0 && (
            <p className="px-1 py-1 text-xs text-gray-400">{__uiText("ยังไม่มี segment")}</p>
          )}
          {activeSegments.map((segment) => (
            <label
              key={segment.id}
              className="flex items-center gap-2 rounded px-1 py-1 text-sm text-gray-700 hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={exclude.includes(segment.id)}
                onChange={() => toggle('excludeSegmentIds', segment.id)}
              />
              {segment.name}
            </label>
          ))}
        </div>
      </div>
      <DeleteButton onClick={onDeleteStep} />
    </div>
  );
}

function WaitFields({
  step,
  onUpdateStep,
  onDeleteStep,
}: {
  step: Extract<MarketingStep, { type: 'wait' }>;
  onUpdateStep: (next: MarketingStep) => void;
  onDeleteStep: () => void;
}) {
  __useUiLocale();
  const hoursInputId = useId();
  const minutesInputId = useId();

  return (
    <div className="space-y-4">
      <SectionTitle kind="WAIT" title={__uiText("หน่วงเวลา")} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={hoursInputId} className={FIELD_LABEL}>{__uiText("ชั่วโมง")}</label>
          <input
            id={hoursInputId}
            type="number"
            min={0}
            className={INPUT_CLASS}
            value={step.hours ?? 0}
            onChange={(event) =>
              onUpdateStep({
                ...step,
                hours: Math.max(0, Number(event.target.value) || 0),
                minutes: step.minutes ?? 0,
              })
            }
          />
        </div>
        <div>
          <label htmlFor={minutesInputId} className={FIELD_LABEL}>{__uiText("นาที")}</label>
          <input
            id={minutesInputId}
            type="number"
            min={0}
            max={59}
            className={INPUT_CLASS}
            value={step.minutes ?? 0}
            onChange={(event) =>
              onUpdateStep({
                ...step,
                hours: step.hours ?? 0,
                minutes: Math.min(59, Math.max(0, Number(event.target.value) || 0)),
              })
            }
          />
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        {__uiText("รวม ")}{formatDurationLabel(step.hours, step.minutes)} {__uiText(" ก่อนขั้นตอนถัดไป")}</p>
      <DeleteButton onClick={onDeleteStep} />
    </div>
  );
}

function GateFields({ onDeleteStep }: { onDeleteStep: () => void }) {
  __useUiLocale();
  return (
    <div className="space-y-4">
      <SectionTitle kind="GATE" title={__uiText("ตรวจเงื่อนไขซ้ำ")} />
      <p className="text-xs text-gray-500">
        {__uiText("v1 รองรับเงื่อนไขเดียว: ")}<code>{__uiText("cart_still_open")}</code> {__uiText(" — ตะกร้ายังไม่ว่าง/ยังไม่ชำระเงิน ก่อนดำเนินขั้นตอนถัดไป ถ้าไม่ผ่านจะข้าม (skip) enrollment นี้ทันที")}</p>
      <DeleteButton onClick={onDeleteStep} />
    </div>
  );
}

/**
 * Single coupon picker used by both `grant_coupon` and `show_offer`.
 *
 * Admins pick from the coupon list rather than pasting a raw UUID. A value
 * that isn't in the list (coupon deleted, or set before this control existed)
 * still gets its own option so it stays visible and selected instead of
 * silently reading as "nothing chosen".
 */
export function CouponPicker({
  coupons,
  value,
  onChange,
}: {
  coupons: CouponOption[];
  value: string | undefined;
  onChange: (couponId: string) => void;
}) {
  __useUiLocale();
  const known = coupons.some((c) => c.id === value);
  const hasOrphanValue = Boolean(value) && !known;
  const couponSelectId = useId();

  return (
    <div>
      <label htmlFor={couponSelectId} className={FIELD_LABEL}>{__uiText("คูปอง")}</label>
      <Select
        id={couponSelectId}
        className="w-full"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{__uiText("— เลือกคูปอง —")}</option>
        {coupons.map((coupon) => (
          <option key={coupon.id} value={coupon.id}>
            {coupon.coupon_code} — {coupon.title}
          </option>
        ))}
        {hasOrphanValue && (
          <option value={value}>{__uiText("คูปองที่ถูกลบ/ไม่พบในรายการ (")}{value})</option>
        )}
      </Select>
      {hasOrphanValue && (
        <p className="mt-1 text-[11px] text-amber-600">
          {__uiText("คูปองนี้ไม่อยู่ในรายการแล้ว — เลือกคูปองใหม่ก่อน Activate")}</p>
      )}
      {coupons.length === 0 && !hasOrphanValue && (
        <p className="mt-1 text-[11px] text-gray-500">
          {__uiText("ยังไม่มีคูปองในระบบ —")}{' '}
          <Link
            to={ADMIN_ROUTES.couponCreate}
            target="_blank"
            className="font-medium text-primary hover:underline"
          >
            {__uiText("สร้างคูปองก่อน →")}</Link>
        </p>
      )}
    </div>
  );
}

function GrantCouponFields({
  step,
  coupons,
  onUpdateStep,
  onDeleteStep,
}: {
  step: Extract<MarketingStep, { type: 'action' }>;
  coupons: CouponOption[];
  onUpdateStep: (next: MarketingStep) => void;
  onDeleteStep: () => void;
}) {
  __useUiLocale();
  const action = step.action as Extract<MarketingAction, { kind: 'grant_coupon' }>;

  const setCouponId = (couponId: string) =>
    onUpdateStep({ ...step, action: { kind: 'grant_coupon', couponId } });

  return (
    <div className="space-y-4">
      <SectionTitle kind="ACTION" title={__uiText("แจกคูปอง (Grant Coupon)")} />
      <CouponPicker
        coupons={coupons}
        value={action.couponId}
        onChange={setCouponId}
      />
      <DeleteButton onClick={onDeleteStep} />
    </div>
  );
}

function NotifyFields({
  step,
  onUpdateStep,
  onDeleteStep,
}: {
  step: Extract<MarketingStep, { type: 'action' }>;
  onUpdateStep: (next: MarketingStep) => void;
  onDeleteStep: () => void;
}) {
  __useUiLocale();
  const action = step.action as Extract<MarketingAction, { kind: 'notify' }>;
  const channels = action.channels ?? [];

  const toggleChannel = (channel: MarketingNotifyChannel) => {
    const next = channels.includes(channel)
      ? channels.filter((c) => c !== channel)
      : [...channels, channel];
    onUpdateStep({ ...step, action: { ...action, channels: next } });
  };

  return (
    <div className="space-y-4">
      <SectionTitle kind="ACTION" title={__uiText("แจ้งเตือน (Notify)")} />
      <div>
        <span className={FIELD_LABEL}>{__uiText("ช่องทาง")}</span>
        <div className="flex flex-wrap gap-3">
          {MARKETING_NOTIFY_CHANNELS.map((channel) => (
            <label key={channel} className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={channels.includes(channel)}
                onChange={() => toggleChannel(channel)}
              />
              {channel}
            </label>
          ))}
        </div>
      </div>
      <NotifyTemplatePicker
        templateKey={action.templateKey ?? ''}
        onSelect={(key) =>
          onUpdateStep({ ...step, action: { ...action, templateKey: key } })
        }
      />
      <DeleteButton onClick={onDeleteStep} />
    </div>
  );
}

/**
 * Template picker for notify steps — templates are authored on the dedicated
 * drag-and-drop builder page (`/marketing/notify-templates`); this picker only
 * selects and previews. Refreshes the list on window focus so a template
 * created in another tab appears without reloading the editor.
 */
export function NotifyTemplatePicker({
  templateKey,
  onSelect,
}: {
  templateKey: string;
  onSelect: (key: string) => void;
}) {
  __useUiLocale();
  const [templates, setTemplates] = useState<MarketingNotifyTemplate[]>([]);

  useEffect(() => {
    const load = () => {
      getMarketingNotifyTemplates()
        .then(setTemplates)
        .catch(() => setTemplates([]));
    };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  const selected = templates.find((t) => t.template_key === templateKey) ?? null;
  const templateSelectId = useId();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={templateSelectId} className={FIELD_LABEL.replace('mb-1 ', '')}>{__uiText("เทมเพลตข้อความ (Template)")}</label>
        <Link
          to={ADMIN_ROUTES.marketingNotifyTemplates}
          target="_blank"
          className="text-[11px] font-medium text-primary hover:underline"
        >
          {__uiText("สร้าง/แก้ไข template (drag &amp; drop) →")}</Link>
      </div>
      <Select
        id={templateSelectId}
        className="w-full"
        value={templateKey}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">{__uiText("— เลือก template —")}</option>
        {MARKETING_NOTIFY_TEMPLATE_KEYS.map((key) => (
          <option key={key} value={key}>
            {MARKETING_BUILTIN_TEMPLATE_LABELS[key] ?? key}
          </option>
        ))}
        {templates.map((template) => (
          <option key={template.template_key} value={template.template_key}>
            {template.name} {__uiText(" (custom)")}</option>
        ))}
      </Select>

      {selected && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 space-y-1.5">
          <p className="text-xs font-semibold text-gray-700">{selected.title}</p>
          <p className="whitespace-pre-line text-[11px] text-gray-500">{selected.body}</p>
          {selected.image_url && (
            <img
              src={selected.image_url}
              alt={__uiText("banner")}
              className="max-h-24 w-full rounded-md object-cover"
            />
          )}
        </div>
      )}
    </div>
  );
}

function ShowOfferFields({
  step,
  coupons,
  onUpdateStep,
  onDeleteStep,
}: {
  step: Extract<MarketingStep, { type: 'action' }>;
  coupons: CouponOption[];
  onUpdateStep: (next: MarketingStep) => void;
  onDeleteStep: () => void;
}) {
  __useUiLocale();
  const action = step.action as Extract<MarketingAction, { kind: 'show_offer' }>;
  const banners = useBannerLibrary();
  const [popupTemplates, setPopupTemplates] = useState<MarketingNotifyTemplate[]>([]);
  const [popupDefinitions, setPopupDefinitions] = useState<PopupDefinitionSummary[]>([]);
  const maxPerSessionInputId = useId();
  const titleInputId = useId();
  const bodyInputId = useId();
  const popupTemplateSelectId = useId();
  const popupDefinitionSelectId = useId();
  const bannerSelectId = useId();
  const imageUrlInputId = useId();
  const ctaTextInputId = useId();
  const ctaUrlInputId = useId();

  useEffect(() => {
    const load = () => {
      getMarketingNotifyTemplates()
        .then((all) => setPopupTemplates(all.filter((t) => t.template_type === 'popup')))
        .catch(() => setPopupTemplates([]));
    };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  useEffect(() => {
    const load = () => {
      listPopupDefinitions()
        .then(setPopupDefinitions)
        .catch(() => setPopupDefinitions([]));
    };
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  const patch = (partial: Partial<Extract<MarketingAction, { kind: 'show_offer' }>>) =>
    onUpdateStep({ ...step, action: { ...action, ...partial } });

  const selectedPopupTemplate =
    popupTemplates.find((t) => t.template_key === action.popupTemplateKey) ?? null;

  return (
    <div className="space-y-4">
      <SectionTitle
        kind="ACTION"
        title={action.displayOnly ? __uiText("แสดง Popup (โฆษณา)") : __uiText("แสดง Offer บน Shop")}
      />
      <p className="text-xs text-gray-500">
        {action.displayOnly
          ? __uiText("เด้ง popup โฆษณาบน shop — ไม่ผูกคูปอง กดปิดแล้วจบใน session (ตั้งจำนวนครั้งได้)")
          : __uiText("ขึ้น popup บน shop หลัง enroll — แนะนำให้วางหลัง Grant Coupon ใน flow เดียวกัน")}
      </p>
      <label className="flex items-start gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={action.displayOnly === true}
          onChange={(event) =>
            patch({
              displayOnly: event.target.checked,
              ...(event.target.checked
                ? { couponId: undefined, hideCode: true }
                : { maxPerSession: undefined }),
            })
          }
        />
        <span>
          {__uiText("โฆษณาอย่างเดียว (ไม่ผูกคูปอง)")}<span className="mt-0.5 block text-[11px] text-gray-400">
            {__uiText("ไม่ grant entitlement — ปิดแล้วซ่อนแค่ session นี้ ตามจำนวนครั้งด้านล่าง")}</span>
        </span>
      </label>
      {action.displayOnly ? (
        <div>
          <label htmlFor={maxPerSessionInputId} className={FIELD_LABEL}>{__uiText("แสดงสูงสุดต่อการเข้าเว็บ (session)")}</label>
          <input
            id={maxPerSessionInputId}
            type="number"
            min={1}
            className={`${INPUT_CLASS} w-24`}
            value={action.maxPerSession ?? 1}
            onChange={(event) =>
              patch({
                maxPerSession: Math.max(1, Number(event.target.value) || 1),
              })
            }
          />
          <p className="mt-1 text-[11px] text-gray-400">
            {__uiText("จำนวนครั้งที่เด้งได้ในแท็บนี้ก่อนหยุด (default 1)")}</p>
        </div>
      ) : (
        <CouponPicker
          coupons={coupons}
          value={action.couponId ?? ''}
          onChange={(couponId) => patch({ couponId })}
        />
      )}
      <div>
        <label htmlFor={titleInputId} className={FIELD_LABEL}>{__uiText("หัวข้อ (ไม่บังคับ)")}</label>
        <input
          id={titleInputId}
          type="text"
          className={INPUT_CLASS}
          value={action.title ?? ''}
          onChange={(event) => patch({ title: event.target.value })}
        />
      </div>
      <div>
        <label htmlFor={bodyInputId} className={FIELD_LABEL}>{__uiText("ข้อความ (ไม่บังคับ)")}</label>
        <textarea
          id={bodyInputId}
          className={INPUT_CLASS}
          rows={3}
          value={action.body ?? ''}
          onChange={(event) => patch({ body: event.target.value })}
        />
      </div>
      {!action.displayOnly ? (
      <label className="flex items-start gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={action.hideCode ?? false}
          onChange={(event) => patch({ hideCode: event.target.checked })}
        />
        <span>
          {__uiText("ไม่ต้องโชว์โค้ดใน popup")}<span className="mt-0.5 block text-[11px] text-gray-400">
            {__uiText("ซ่อนกล่อง &ldquo;โค้ดที่ใช้ได้&rdquo; และปุ่มคัดลอก — เหมาะกับคูปองที่แจกเข้าบัญชีอยู่แล้ว ลูกค้าไม่ต้องกรอกโค้ดเอง")}</span>
        </span>
      </label>
      ) : null}

      <div className="space-y-2 rounded-lg border border-dashed border-gray-200 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold tracking-wide text-gray-400">
            {__uiText("หน้าตา POPUP (แก้เองได้)")}</p>
          <Link
            to={ADMIN_ROUTES.marketingNotifyTemplates}
            target="_blank"
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {__uiText("สร้าง popup แบบลากวาง →")}</Link>
        </div>
        <div>
          <label htmlFor={popupTemplateSelectId} className={FIELD_LABEL}>{__uiText("Popup Template (สร้างจากหน้าลากวาง)")}</label>
          <Select
            id={popupTemplateSelectId}
            className="w-full"
            value={action.popupTemplateKey ?? ''}
            onChange={(event) =>
              patch({ popupTemplateKey: event.target.value || undefined })
            }
          >
            <option value="">{__uiText("— ใช้หน้าตามาตรฐาน (ตั้งค่าด้านล่าง) —")}</option>
            {popupTemplates.map((template) => (
              <option key={template.template_key} value={template.template_key}>
                {template.name}
              </option>
            ))}
          </Select>
          {selectedPopupTemplate && (
            <p className="mt-1 rounded-md bg-violet-50 px-2 py-1 text-[11px] text-violet-700">
              {__uiText("ใช้ layout จาก \"")}{selectedPopupTemplate.name}{__uiText("\" — popup จะเรนเดอร์ตามบล็อกที่ลากวางไว้ (การตั้งค่ารูป/ปุ่มด้านล่างจะไม่ถูกใช้)")}</p>
          )}
        </div>
        <div>
          <label htmlFor={popupDefinitionSelectId} className={FIELD_LABEL}>
            {__uiText("คลัง Popup")}{' '}
            <a href="/admin/popups/create" target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {__uiText("สร้าง popup ใหม่ →")}</a>
          </label>
          <Select
            id={popupDefinitionSelectId}
            className="w-full"
            value={action.popupDefinitionId ?? ''}
            onChange={(e) =>
              patch({ popupDefinitionId: e.target.value || undefined, popupTemplateKey: undefined })
            }
          >
            <option value="">{__uiText("— ใช้ layout inline (popupTemplateKey) —")}</option>
            {popupDefinitions.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
        {!selectedPopupTemplate && (
        <>
        <div>
          {banners.length > 0 && (
            <>
            <label htmlFor={bannerSelectId} className={FIELD_LABEL}>{__uiText("รูป Banner ของ popup")}</label>
            <Select
              id={bannerSelectId}
              className="w-full"
              value={
                banners.some((b) => b.url === (action.imageUrl ?? '').trim())
                  ? (action.imageUrl ?? '').trim()
                  : ''
              }
              onChange={(event) => {
                if (event.target.value) patch({ imageUrl: event.target.value });
              }}
            >
              <option value="">{__uiText("— เลือกจากคลัง Banner (/admin/banner) —")}</option>
              {banners.map((banner) => (
                <option key={banner.url} value={banner.url}>
                  {banner.title}
                </option>
              ))}
            </Select>
            </>
          )}
          <label htmlFor={imageUrlInputId} className="mb-1 mt-1.5 block text-xs font-medium text-gray-500">
            {__uiText("หรือวาง URL รูปเอง")}</label>
          <input
            id={imageUrlInputId}
            type="text"
            className={`${INPUT_CLASS} font-mono text-xs`}
            placeholder={__uiText("ว่าง = ใช้รูปของคูปอง")}
            value={action.imageUrl ?? ''}
            onChange={(event) => patch({ imageUrl: event.target.value || undefined })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={ctaTextInputId} className={FIELD_LABEL}>{__uiText("ข้อความปุ่มหลัก")}</label>
            <input
              id={ctaTextInputId}
              type="text"
              className={INPUT_CLASS}
              placeholder={__uiText("ไปใช้ที่ตะกร้า")}
              value={action.ctaText ?? ''}
              onChange={(event) => patch({ ctaText: event.target.value || undefined })}
            />
          </div>
          <div>
            <label htmlFor={ctaUrlInputId} className={FIELD_LABEL}>{__uiText("ลิงก์ปุ่มหลัก")}</label>
            <input
              id={ctaUrlInputId}
              type="text"
              className={`${INPUT_CLASS} font-mono text-xs`}
              placeholder="/cart/placement"
              value={action.ctaUrl ?? ''}
              onChange={(event) => patch({ ctaUrl: event.target.value || undefined })}
            />
          </div>
        </div>

        {/* Live preview เลียนแบบ MarketingOfferModal ฝั่ง shop */}
        <div className="rounded-xl bg-black/50 p-3">
          <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
            {(action.imageUrl ?? '').trim() && (
              <img
                src={(action.imageUrl ?? '').trim()}
                alt={__uiText("popup banner")}
                className="h-24 w-full object-cover"
              />
            )}
            <div className="space-y-2 px-3 py-3">
              <p className="text-sm font-semibold text-neutral-900">
                {action.title?.trim() || __uiText("คุณได้รับคูปอง")}
              </p>
              {action.body?.trim() && (
                <p className="text-xs text-neutral-600">{action.body}</p>
              )}
              <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-2 py-2">
                <p className="text-[9px] font-medium uppercase tracking-wide text-neutral-500">
                  {__uiText("โค้ดที่ใช้ได้")}</p>
                <p className="font-mono text-sm font-semibold text-neutral-900">
                  {coupons.find((c) => c.id === action.couponId)?.coupon_code || __uiText("COUPON")}
                </p>
              </div>
              <div className="flex gap-1.5">
                <span className="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs font-medium text-neutral-800">
                  {__uiText("คัดลอกโค้ด")}</span>
                <span className="rounded-lg bg-neutral-900 px-2 py-1.5 text-xs font-medium text-white">
                  {action.ctaText?.trim() || __uiText("ไปใช้ที่ตะกร้า")}
                </span>
              </div>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-400">
          {__uiText("พรีวิว popup ที่ลูกค้าเห็นบน shop — ปุ่มหลักลิงก์ไป")}{' '}
          <span className="font-mono">{action.ctaUrl?.trim() || '/cart/placement'}</span>
        </p>
        </>
        )}
      </div>

      <DeleteButton onClick={onDeleteStep} />
    </div>
  );
}

function stepLabel(step: MarketingStep): string {
  switch (step.type) {
    case 'audience':
      return __uiText("Audience");
    case 'wait':
      return __uiText("Wait ({0})",{"0":formatDurationLabel(step.hours, step.minutes)});
    case 'gate':
      return __uiText("Gate (cart_still_open)");
    case 'condition':
      return __uiText("If/Else: {0}",{"0":step.expression.trim() || __uiText("(ยังไม่ตั้งเงื่อนไข)")});
    case 'action':
      if (step.action.kind === 'grant_coupon') return __uiText("Action: แจกคูปอง");
      if (step.action.kind === 'show_offer') {
        return step.action.displayOnly ? __uiText("Action: แสดง Popup") : __uiText("Action: แสดง Offer");
      }
      return __uiText("Action: แจ้งเตือน");
  }
}

type ConditionClause = {
  field: MarketingExpressionField;
  op: MarketingExpressionOperator;
  /** UI raw value (no quotes); boolean as 'true'|'false', number as digits, segment as uuid. */
  value: string;
};

type ConditionJoin = 'AND' | 'OR';

function defaultValueForField(field: MarketingExpressionField): string {
  const kind = MARKETING_EXPRESSION_FIELD_TYPES[field];
  if (kind === 'boolean') return 'true';
  if (kind === 'number') return '0';
  return '';
}

function defaultOpForField(field: MarketingExpressionField): MarketingExpressionOperator {
  return MARKETING_EXPRESSION_OPS_BY_TYPE[MARKETING_EXPRESSION_FIELD_TYPES[field]][0].value;
}

function formatClauseValue(field: MarketingExpressionField, value: string): string {
  const kind = MARKETING_EXPRESSION_FIELD_TYPES[field];
  if (kind === 'boolean') return value === 'true' ? 'true' : 'false';
  if (kind === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : '0';
  }
  return `"${value.replace(/"/g, '')}"`;
}

function serializeConditionExpression(
  clauses: ConditionClause[],
  joins: ConditionJoin[],
): string {
  if (clauses.length === 0) return '';
  return clauses
    .map((clause, index) => {
      const part = `${clause.field} ${clause.op} ${formatClauseValue(clause.field, clause.value)}`;
      if (index === 0) return part;
      return `${joins[index - 1] ?? 'AND'} ${part}`;
    })
    .join(' ');
}

/** Parse flat `A AND B OR C` expressions into select rows. Nested parens → null. */
function parseConditionExpression(
  expression: string,
): { clauses: ConditionClause[]; joins: ConditionJoin[] } | null {
  const trimmed = expression.trim();
  if (!trimmed) {
    return {
      clauses: [{ field: 'cart.still_open', op: '==', value: 'true' }],
      joins: [],
    };
  }
  if (trimmed.includes('(') || trimmed.includes(')')) return null;

  const comparisonRe =
    /^\s*(cart\.still_open|cart\.item_count|cart\.total|still_no_order|segment\.in|user\.order_count|time\.in_schedule|time\.hour|time\.dow|page\.views)\s*(==|!=|>=|<=|>|<)\s*(true|false|-?\d+(?:\.\d+)?|"[^"]*")/;
  const joinRe = /^\s*(AND|OR)\s+/i;

  let remaining = trimmed;
  const clauses: ConditionClause[] = [];
  const joins: ConditionJoin[] = [];

  while (remaining.trim()) {
    const match = remaining.match(comparisonRe);
    if (!match) return null;
    const field = match[1] as MarketingExpressionField;
    const op = match[2] as MarketingExpressionOperator;
    let value = match[3];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    clauses.push({ field, op, value });
    remaining = remaining.slice(match[0].length);
    if (!remaining.trim()) break;
    const joinMatch = remaining.match(joinRe);
    if (!joinMatch) return null;
    joins.push(joinMatch[1].toUpperCase() as ConditionJoin);
    remaining = remaining.slice(joinMatch[0].length);
  }

  return { clauses, joins };
}

function ConditionFields({
  step,
  steps,
  segments,
  onUpdateStep,
  onDeleteStep,
}: {
  step: Extract<MarketingStep, { type: 'condition' }>;
  steps: MarketingStep[];
  segments: UserSegmentListItem[];
  onUpdateStep: (next: MarketingStep) => void;
  onDeleteStep: () => void;
}) {
  __useUiLocale();
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ ok: boolean; error?: string } | null>(null);
  const [clauses, setClauses] = useState<ConditionClause[]>(() => {
    const parsed = parseConditionExpression(step.expression);
    return parsed?.clauses ?? [{ field: 'cart.still_open', op: '==', value: 'true' }];
  });
  const [joins, setJoins] = useState<ConditionJoin[]>(() => {
    const parsed = parseConditionExpression(step.expression);
    return parsed?.joins ?? [];
  });
  const [advancedMode, setAdvancedMode] = useState(
    () => parseConditionExpression(step.expression) === null && step.expression.trim().length > 0,
  );

  const otherSteps = steps.filter((s) => s.id !== step.id);
  const expressionTextareaId = useId();
  const yesNextSelectId = useId();
  const noNextSelectId = useId();
  const clauseIdPrefix = useId();

  useEffect(() => {
    const parsed = parseConditionExpression(step.expression);
    if (parsed) {
      setClauses(parsed.clauses);
      setJoins(parsed.joins);
      setAdvancedMode(false);
    } else if (step.expression.trim()) {
      setAdvancedMode(true);
    }
  }, [step.id]);

  const commitBuilder = (nextClauses: ConditionClause[], nextJoins: ConditionJoin[]) => {
    setClauses(nextClauses);
    setJoins(nextJoins);
    setValidation(null);
    onUpdateStep({
      ...step,
      expression: serializeConditionExpression(nextClauses, nextJoins),
    });
  };

  const updateClause = (index: number, patch: Partial<ConditionClause>) => {
    const next = clauses.map((clause, i) => {
      if (i !== index) return clause;
      const merged = { ...clause, ...patch };
      if (patch.field && patch.field !== clause.field) {
        merged.op = defaultOpForField(patch.field);
        merged.value = defaultValueForField(patch.field);
      }
      const allowed = MARKETING_EXPRESSION_OPS_BY_TYPE[
        MARKETING_EXPRESSION_FIELD_TYPES[merged.field]
      ].map((o) => o.value);
      if (!allowed.includes(merged.op)) {
        merged.op = allowed[0];
      }
      return merged;
    });
    commitBuilder(next, joins);
  };

  const addClause = () => {
    commitBuilder(
      [...clauses, { field: 'cart.total', op: '>=', value: '1000' }],
      [...joins, 'AND'],
    );
  };

  const removeClause = (index: number) => {
    if (clauses.length <= 1) {
      commitBuilder([{ field: 'cart.still_open', op: '==', value: 'true' }], []);
      return;
    }
    const nextClauses = clauses.filter((_, i) => i !== index);
    const nextJoins =
      index === 0
        ? joins.slice(1)
        : [...joins.slice(0, index - 1), ...joins.slice(index)];
    commitBuilder(nextClauses, nextJoins);
  };

  const setJoinAt = (index: number, join: ConditionJoin) => {
    const next = joins.map((j, i) => (i === index ? join : j));
    commitBuilder(clauses, next);
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      const result = await validateMarketingExpression(step.expression);
      setValidation(result);
    } catch {
      setValidation({ ok: false, error: 'ตรวจสอบไม่สำเร็จ ลองใหม่อีกครั้ง' });
    } finally {
      setValidating(false);
    }
  };

  const resetToBuilder = () => {
    commitBuilder([{ field: 'cart.still_open', op: '==', value: 'true' }], []);
    setAdvancedMode(false);
  };

  return (
    <div className="space-y-4">
      <SectionTitle kind="IF / ELSE" title={__uiText("เงื่อนไขแยกเส้นทาง (Condition)")} />
      <p className="text-xs text-gray-500">
        {__uiText("เลือกฟิลด์ / ตัวเปรียบเทียบ / ค่า — ระบบสร้าง expression ให้เอง (whitelist เท่านั้น)")}</p>

      {advancedMode ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <label htmlFor={expressionTextareaId} className="block text-xs text-amber-800">
            {__uiText("เงื่อนไขนี้มีวงเล็บหรือรูปแบบที่ตัวเลือกยังไม่รองรับ — แก้ไขด้วยข้อความหรือสร้างใหม่ด้วย select")}</label>
          <textarea
            id={expressionTextareaId}
            rows={3}
            className={`${INPUT_CLASS} font-mono text-xs`}
            value={step.expression}
            onChange={(event) => {
              setValidation(null);
              onUpdateStep({ ...step, expression: event.target.value });
            }}
          />
          <button
            type="button"
            onClick={resetToBuilder}
            className="text-xs font-medium text-primary hover:underline"
          >
            {__uiText("สร้างใหม่ด้วยตัวเลือก")}</button>
        </div>
      ) : (
        <div className="space-y-2">
          <span className={FIELD_LABEL}>{__uiText("เงื่อนไข")}</span>
          {clauses.map((clause, index) => {
            const fieldType = MARKETING_EXPRESSION_FIELD_TYPES[clause.field];
            const ops = MARKETING_EXPRESSION_OPS_BY_TYPE[fieldType];
            return (
              <div key={index} className="space-y-1.5">
                {index > 0 && (
                  <div>
                    <label htmlFor={`${clauseIdPrefix}-${index}-join`} className={FIELD_LABEL}>{__uiText("ตัวเชื่อม")}</label>
                    <Select
                      id={`${clauseIdPrefix}-${index}-join`}
                      className="w-24"
                      value={joins[index - 1] ?? 'AND'}
                      onChange={(event) =>
                        setJoinAt(index - 1, event.target.value as ConditionJoin)
                      }
                    >
                      <option value="AND">{__uiText("และ (AND)")}</option>
                      <option value="OR">{__uiText("หรือ (OR)")}</option>
                    </Select>
                  </div>
                )}
                <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-2.5 space-y-2">
                  <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_auto]">
                    <div>
                      <label htmlFor={`${clauseIdPrefix}-${index}-field`} className={FIELD_LABEL}>{__uiText("ฟิลด์")}</label>
                      <Select
                        id={`${clauseIdPrefix}-${index}-field`}
                        className="w-full"
                        value={clause.field}
                        onChange={(event) =>
                          updateClause(index, {
                            field: event.target.value as MarketingExpressionField,
                          })
                        }
                      >
                        {MARKETING_EXPRESSION_FIELD_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeClause(index)}
                      className="text-xs text-red-500 hover:underline sm:justify-self-end"
                    >
                      {__uiText("ลบ")}</button>
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-2">
                    <div>
                      <label htmlFor={`${clauseIdPrefix}-${index}-operator`} className={FIELD_LABEL}>{__uiText("ตัวเปรียบเทียบ")}</label>
                      <Select
                        id={`${clauseIdPrefix}-${index}-operator`}
                        className="w-full"
                        value={clause.op}
                        onChange={(event) =>
                          updateClause(index, {
                            op: event.target.value as MarketingExpressionOperator,
                          })
                        }
                      >
                        {ops.map((op) => (
                          <option key={op.value} value={op.value}>
                            {op.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {fieldType === 'boolean' && (
                      <div>
                        <label htmlFor={`${clauseIdPrefix}-${index}-value`} className={FIELD_LABEL}>{__uiText("ค่า")}</label>
                        <Select
                          id={`${clauseIdPrefix}-${index}-value`}
                          className="w-full"
                          value={clause.value === 'true' ? 'true' : 'false'}
                          onChange={(event) => updateClause(index, { value: event.target.value })}
                        >
                          <option value="true">{__uiText("จริง (true)")}</option>
                          <option value="false">{__uiText("เท็จ (false)")}</option>
                        </Select>
                      </div>
                    )}
                    {fieldType === 'number' && (
                      <div>
                        <label htmlFor={`${clauseIdPrefix}-${index}-value`} className={FIELD_LABEL}>{__uiText("ค่า")}</label>
                        <input
                          id={`${clauseIdPrefix}-${index}-value`}
                          type="number"
                          className={INPUT_CLASS}
                          value={clause.value}
                          onChange={(event) => updateClause(index, { value: event.target.value })}
                        />
                      </div>
                    )}
                    {fieldType === 'segment' && (
                      <div>
                        <label htmlFor={`${clauseIdPrefix}-${index}-value`} className={FIELD_LABEL}>{__uiText("ค่า")}</label>
                        <Select
                          id={`${clauseIdPrefix}-${index}-value`}
                          className="w-full"
                          value={clause.value}
                          onChange={(event) => updateClause(index, { value: event.target.value })}
                        >
                          <option value="">{__uiText("— เลือก Segment —")}</option>
                          {segments.map((seg) => (
                            <option key={seg.id} value={seg.id}>
                              {seg.name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addClause}
            className="text-xs font-medium text-primary hover:underline"
          >
            {__uiText("+ เพิ่มเงื่อนไข")}</button>
          {step.expression.trim() && (
            <p className="rounded-md bg-gray-50 px-2 py-1.5 font-mono text-[10px] text-gray-500 break-all">
              {step.expression}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleValidate}
          disabled={validating || !step.expression.trim()}
          className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {validating ? __uiText("กำลังตรวจสอบ...") : __uiText("Validate")}
        </button>
        {validation && (
          <span className={`text-xs ${validation.ok ? 'text-emerald-600' : 'text-red-500'}`}>
            {validation.ok ? __uiText("✓ เงื่อนไขถูกต้อง") : validation.error}
          </span>
        )}
      </div>

      <div>
        <label htmlFor={yesNextSelectId} className={FIELD_LABEL}>{__uiText("ถ้าเป็นจริง (Yes) → ไปที่")}</label>
        <Select
          id={yesNextSelectId}
          className="w-full"
          value={step.yesNextId ?? ''}
          onChange={(event) =>
            onUpdateStep({ ...step, yesNextId: event.target.value || null })
          }
        >
          <option value="">{__uiText("— จบ (End) —")}</option>
          {otherSteps.map((s) => (
            <option key={s.id} value={s.id}>
              {stepLabel(s)}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <label htmlFor={noNextSelectId} className={FIELD_LABEL}>{__uiText("ถ้าเป็นเท็จ (No) → ไปที่")}</label>
        <Select
          id={noNextSelectId}
          className="w-full"
          value={step.noNextId ?? ''}
          onChange={(event) =>
            onUpdateStep({ ...step, noNextId: event.target.value || null })
          }
        >
          <option value="">{__uiText("— จบ (End) —")}</option>
          {otherSteps.map((s) => (
            <option key={s.id} value={s.id}>
              {stepLabel(s)}
            </option>
          ))}
        </Select>
      </div>

      <DeleteButton onClick={onDeleteStep} />
    </div>
  );
}

export function MarketingStepSidePanel({
  selection,
  triggerType,
  triggerConfig,
  segments,
  coupons,
  steps,
  schedule,
  onOpenScheduleEditor,
  onUpdateTriggerType,
  onUpdateTrigger,
  onUpdateStep,
  onDeleteStep,
}: Props) {
  __useUiLocale();
  if (!selection) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 p-6 text-center">
        <p className="text-xs text-gray-400">{__uiText("คลิกที่การ์ดในแผนภาพเพื่อแก้ไขรายละเอียด")}</p>
      </div>
    );
  }

  if (selection.kind === 'trigger') {
    return (
      <div className="rounded-xl border border-amber-200/80 bg-amber-50/30 p-4">
        <TriggerRuleBuilder
          variant="panel"
          triggerType={triggerType}
          triggerConfig={triggerConfig}
          onUpdateTriggerType={onUpdateTriggerType}
          onUpdateTrigger={onUpdateTrigger}
          schedule={schedule}
          showScheduleStrip
          onOpenScheduleEditor={onOpenScheduleEditor}
        />
      </div>
    );
  }

  const { step } = selection;
  const deleteThis = () => onDeleteStep(step.id);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      {step.type === 'audience' && (
        <AudienceFields
          step={step}
          segments={segments}
          onUpdateStep={(next) => onUpdateStep(step.id, next)}
          onDeleteStep={deleteThis}
        />
      )}
      {step.type === 'wait' && (
        <WaitFields
          step={step}
          onUpdateStep={(next) => onUpdateStep(step.id, next)}
          onDeleteStep={deleteThis}
        />
      )}
      {step.type === 'gate' && <GateFields onDeleteStep={deleteThis} />}
      {step.type === 'condition' && (
        <ConditionFields
          step={step}
          steps={steps}
          segments={segments}
          onUpdateStep={(next) => onUpdateStep(step.id, next)}
          onDeleteStep={deleteThis}
        />
      )}
      {step.type === 'action' && step.action.kind === 'grant_coupon' && (
        <GrantCouponFields
          step={step}
          coupons={coupons}
          onUpdateStep={(next) => onUpdateStep(step.id, next)}
          onDeleteStep={deleteThis}
        />
      )}
      {step.type === 'action' && step.action.kind === 'notify' && (
        <NotifyFields
          step={step}
          onUpdateStep={(next) => onUpdateStep(step.id, next)}
          onDeleteStep={deleteThis}
        />
      )}
      {step.type === 'action' && step.action.kind === 'show_offer' && (
        <ShowOfferFields
          step={step}
          coupons={coupons}
          onUpdateStep={(next) => onUpdateStep(step.id, next)}
          onDeleteStep={deleteThis}
        />
      )}
    </div>
  );
}

// Re-exported so callers can build a selection without importing the canvas file.
export { TRIGGER_NODE_ID };

export default MarketingStepSidePanel;

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
