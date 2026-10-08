import { uiText as __uiText, useUiLocale as __useUiLocale } from '@cp/ui';
// ui-static-options-migration: display metadata; identifiers remain unchanged
import { uiText } from '@cp/ui';
import { apiClient } from './api-client';
import type { MarketingCreativeChannels } from './marketing-creative.schema';

/** Mirrors `apps/backend/src/app/marketing-workflow/marketing-step.types.ts`. */
export type MarketingNotifyChannel = 'push' | 'email' | 'in_app';

export type MarketingAction =
  | { kind: 'grant_coupon'; couponId: string }
  | {
      kind: 'notify';
      channels: MarketingNotifyChannel[];
      templateKey: string;
      data?: Record<string, unknown>;
    }
  | {
      kind: 'show_offer';
      /** josh backend marketing-step.types — missing from josh shared-api; the side panel sets it. */
      popupDefinitionId?: string;
      /** Required unless `displayOnly`. */
      couponId?: string;
      title?: string;
      body?: string;
      /** Popup banner image (absolute URL) — overrides the coupon's image. */
      imageUrl?: string;
      /** Primary button label; default "ไปใช้ที่ตะกร้า". */
      ctaText?: string;
      /** Primary button destination; default "/cart/placement". */
      ctaUrl?: string;
      /** Hide the code block + copy button in the shop popup (fixed layout only). */
      hideCode?: boolean;
      /** `custom_*` key ของ template ประเภท popup — ใช้ layout ลากวางแทนหน้าตามาตรฐาน */
      popupTemplateKey?: string;
      /** Ad/creative only — no coupon grant; session close via maxPerSession. */
      displayOnly?: boolean;
      /** Max opens per browser session when displayOnly (default 1). */
      maxPerSession?: number;
    };

export type MarketingStep =
  | {
      id: string;
      type: 'audience';
      segmentIds?: string[];
      excludeSegmentIds?: string[];
      /** Optional explicit next; omitted means next array sibling. */
      nextId?: string | null;
    }
  /** `hours` + optional `minutes`; total must be ≥ 1 minute on activate. */
  | { id: string; type: 'wait'; hours: number; minutes?: number; nextId?: string | null }
  /** `nextId` is optional for backward compat — omitted means "next array sibling". */
  | { id: string; type: 'gate'; kind: 'cart_still_open'; nextId?: string | null }
  | { id: string; type: 'action'; action: MarketingAction; nextId?: string | null }
  | {
      id: string;
      type: 'condition';
      expression: string;
      /** Next step id when the expression evaluates true; `null` = end this branch. */
      yesNextId: string | null;
      /** Next step id when the expression evaluates false; `null` = end this branch. */
      noNextId: string | null;
    };

/** Mirrors `MARKETING_EXPRESSION_FIELD_TYPES` in `marketing-expression.parser.ts`. */
export type MarketingExpressionFieldType = 'boolean' | 'number' | 'segment';

export type MarketingExpressionField =
  | 'cart.still_open'
  | 'cart.item_count'
  | 'cart.total'
  | 'still_no_order'
  | 'segment.in'
  | 'user.order_count'
  | 'time.in_schedule'
  | 'time.hour'
  | 'time.dow'
  | 'page.views';

export type MarketingExpressionOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';

export const MARKETING_EXPRESSION_FIELD_TYPES: Record<
  MarketingExpressionField,
  MarketingExpressionFieldType
> = {
  'cart.still_open': 'boolean',
  'cart.item_count': 'number',
  'cart.total': 'number',
  still_no_order: 'boolean',
  'segment.in': 'segment',
  'user.order_count': 'number',
  'time.in_schedule': 'boolean',
  'time.hour': 'number',
  'time.dow': 'number',
  'page.views': 'number',
};

/** Thai labels for the admin select-based condition builder. */
export const MARKETING_EXPRESSION_FIELD_OPTIONS: Array<{
  value: MarketingExpressionField;
  label: string;
}> = [
  { value: 'cart.still_open', get label(){return uiText("ตะกร้ายังมีของอยู่");} },
  { value: 'cart.item_count', get label(){return uiText("จำนวนชิ้นในตะกร้า");} },
  { value: 'cart.total', get label(){return uiText("ยอดรวมตะกร้า");} },
  { value: 'still_no_order', get label(){return uiText("ยังไม่เคยสั่งซื้อ");} },
  { value: 'user.order_count', get label(){return uiText("จำนวนออเดอร์ทั้งหมด");} },
  { value: 'segment.in', get label(){return uiText("อยู่ใน Segment");} },
  { value: 'time.in_schedule', get label(){return uiText("อยู่ในช่วงเวลาที่กำหนด");} },
  { value: 'time.hour', get label(){return uiText("ชั่วโมงปัจจุบัน (0-23)");} },
  { value: 'time.dow', get label(){return uiText("วันในสัปดาห์ (0=อาทิตย์)");} },
  { value: 'page.views', get label(){return uiText("จำนวนการเข้าชมหน้า");} },
];

export const MARKETING_EXPRESSION_OPS_BY_TYPE: Record<
  MarketingExpressionFieldType,
  Array<{ value: MarketingExpressionOperator; label: string }>
> = {
  boolean: [
    { value: '==', get label(){return uiText("เท่ากับ");} },
    { value: '!=', get label(){return uiText("ไม่เท่ากับ");} },
  ],
  number: [
    { value: '==', get label(){return uiText("=");} },
    { value: '!=', get label(){return uiText("≠");} },
    { value: '>', get label(){return uiText(">");} },
    { value: '>=', get label(){return uiText("≥");} },
    { value: '<', get label(){return uiText("<");} },
    { value: '<=', get label(){return uiText("≤");} },
  ],
  segment: [
    { value: '==', get label(){return uiText("อยู่ใน");} },
    { value: '!=', get label(){return uiText("ไม่อยู่ใน");} },
  ],
};

/** @deprecated Prefer the select-based builder; chips kept for backward compat. */
export const MARKETING_EXPRESSION_CHIPS: Array<{ label: string; snippet: string }> = [
  { get label() { return __uiText("ตะกร้ายังไม่ว่าง"); }, snippet: 'cart.still_open == true' },
  { get label() { return __uiText("ยอดตะกร้า ≥"); }, snippet: 'cart.total >= ' },
  { get label() { return __uiText("ยังไม่เคยสั่งซื้อ"); }, snippet: 'still_no_order == true' },
  { get label() { return __uiText("อยู่ใน segment"); }, snippet: 'segment.in == "' },
];

/** Hard cap locked by the if/else amendment — activation fails above this count. */
export const MAX_MARKETING_CONDITION_STEPS = 5;
/** Hard cap — activation fails above this wait-step count. */
export const MAX_MARKETING_WAIT_STEPS = 3;
/** Hard cap per wait step (30 days), in minutes. */
export const MAX_MARKETING_WAIT_MINUTES = 30 * 24 * 60;
/** Soft warn threshold shown in the canvas (UI-only, not enforced by the backend). */
export const MARKETING_CONDITION_WARN_THRESHOLD = 2;

export type ValidateMarketingExpressionResult = { ok: boolean; error?: string };

export type MarketingWorkflowStatus = 'draft' | 'active' | 'paused';
export type MarketingTriggerType =
  | 'cart_idle'
  | 'page_affinity'
  | 'session_in_window'
  | 'first_login'
  | 'first_visit'
  | 'custom'
  | 'order_milestone'
  | 'scheduled';

export type MarketingCartIdleTriggerConfig = {
  idleHours?: number;
  idleMinutes?: number;
};

export type MarketingPageAffinityPageType = 'pdp' | 'category' | 'cart' | 'path';

export type MarketingPageAffinityTriggerConfig = {
  pageType: MarketingPageAffinityPageType;
  entityId?: string | null;
  path?: string | null;
  minViews: number;
  windowHours?: number;
  windowMinutes?: number;
};

export type MarketingSessionInWindowTriggerConfig = { lookbackMinutes: number };

export type MarketingFirstLoginTriggerConfig = Record<string, never>;

export type MarketingFirstVisitTriggerConfig = Record<string, never>;

export type MarketingCustomSourceOperator =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains';

/**
 * Where a custom trigger's on/off state comes from: `manual` = กด Activate/Pause
 * เอง; `http` = backend ดึง JSON จาก `url` อ่านค่าตาม `valuePath` (dot path เช่น
 * `weather.0.main`) แล้วเทียบ `operator`/`value` ทุก ๆ `intervalMinutes` นาที.
 */
export type MarketingCustomTriggerSource =
  | { kind: 'manual' }
  | {
      kind: 'http';
      url: string;
      valuePath: string;
      operator: MarketingCustomSourceOperator;
      value: string | number | boolean;
      intervalMinutes?: number;
    };

/**
 * Marketer-named condition (เช่น "ช่วงฝนตก"): ระหว่าง workflow Active (และ
 * `source` เข้าเงื่อนไข ถ้าตั้งไว้) ทุก device ที่เข้าเว็บถูก enroll
 * (สูงสุดวันละครั้ง/เครื่อง) เหมาะกับ show_offer popup.
 */
export type MarketingCustomTriggerConfig = {
  label: string;
  description?: string;
  source?: MarketingCustomTriggerSource;
  /** เด้งหลังอยู่บนเว็บครบกี่นาที (นับจาก page view แรกใน 6 ชม.) — 0/ไม่ระบุ = ทันที */
  delayMinutes?: number;
};

export type MarketingCustomSourceCheckResult = {
  matched: boolean;
  actualValue?: string;
  error?: string;
};

/** Uncached one-shot check of an http source ("ทดสอบดึงค่า" in the builder). */
export const checkMarketingCustomSource = async (payload: {
  url: string;
  valuePath: string;
  operator: MarketingCustomSourceOperator;
  value: string | number | boolean;
}): Promise<MarketingCustomSourceCheckResult> => {
  const response = await apiClient.post(
    '/marketing-workflows/check-custom-source',
    payload,
  );
  return response.data.data;
};

export type MarketingCustomSourceProbeField = {
  path: string;
  sampleValue: string;
  valueType: 'string' | 'number' | 'boolean' | 'null';
};

export type MarketingCustomSourceProbeResult = {
  fields?: MarketingCustomSourceProbeField[];
  truncated?: boolean;
  error?: string;
};

/** Uncached fetch for field discovery ("ลอง fetch" in the builder). */
export const probeMarketingCustomSource = async (payload: {
  url: string;
}): Promise<MarketingCustomSourceProbeResult> => {
  const response = await apiClient.post(
    '/marketing-workflows/probe-custom-source',
    payload,
  );
  return response.data.data;
};

export type MarketingOrderMilestoneMetric =
  | 'single_order_total'
  | 'lifetime_spend'
  | 'lifetime_order_count';

export type MarketingOrderMilestoneOperator = '>=' | '>';

/**
 * Milestone จากยอดสั่งซื้อ (สร้างจาก visual builder) เช่น "order เดียวเกิน 5,000
 * ครั้งแรก" หรือ "ยอดสะสมถึง 100,000 ครั้งแรก" — ทำงานครั้งเดียวต่อ user
 * (ครั้งแรกที่เข้าเงื่อนไขหลัง Activate) เช็คจากออเดอร์ที่ชำระแล้วทุก ~15 นาที.
 */
export type MarketingOrderMilestoneTriggerConfig = {
  metric: MarketingOrderMilestoneMetric;
  operator: MarketingOrderMilestoneOperator;
  value: number;
};

/**
 * ยิงตามเวลา (recurring blast) เช่น "ทุกวัน 18:00" หรือ "ทุกวันจันทร์ 19:00" —
 * `daysOfWeek` ว่าง = ทุกวัน (0=อา…6=ส); enroll ทุกคนใน Audience (ไม่มี Audience = ทุกคน)
 * ครั้งเดียวต่อคนต่อรอบ
 */
export type MarketingScheduledTriggerConfig = {
  time: string;
  daysOfWeek?: number[];
  timezone?: string;
};

/** Mirrors `MarketingTriggerConfig` in `apps/backend/src/app/marketing-workflow/marketing-step.types.ts`. */
export type MarketingTriggerConfig =
  | MarketingCartIdleTriggerConfig
  | MarketingPageAffinityTriggerConfig
  | MarketingSessionInWindowTriggerConfig
  | MarketingFirstLoginTriggerConfig
  | MarketingFirstVisitTriggerConfig
  | MarketingCustomTriggerConfig
  | MarketingOrderMilestoneTriggerConfig
  | MarketingScheduledTriggerConfig;

export type MarketingResolvedProductSku = {
  productId: string;
  sku: string;
  name: string | null;
};

/** SKU → product id for the page_affinity builder (exact, case-insensitive). */
export const resolveMarketingProductSku = async (
  sku: string,
): Promise<MarketingResolvedProductSku | null> => {
  const response = await apiClient.get(
    `/marketing-workflows/resolve-product-sku?sku=${encodeURIComponent(sku)}`,
  );
  return response.data.data ?? null;
};

/** Mirrors `MarketingWorkflowSchedule` in the same backend file. `null` = always eligible. */
export type MarketingWorkflowSchedule = {
  timezone: string;
  /** 0=Sun … 6=Sat; omit/empty = every day. */
  daysOfWeek?: number[];
  /** Local time HH:mm inclusive start; omit = 00:00. */
  startTime?: string;
  /** Local time HH:mm exclusive end; omit = 24:00. */
  endTime?: string;
  activeFrom?: string | null;
  activeTo?: string | null;
} | null;

/** Mirrors `NOTIFY_CHANNELS` in `marketing-workflow.validator.ts`. */
export const MARKETING_NOTIFY_CHANNELS: MarketingNotifyChannel[] = [
  'push',
  'email',
  'in_app',
];

/** Mirrors `MARKETING_TEMPLATE_KEYS` in `marketing-templates.ts` — code-defined v1 registry. */
export const MARKETING_NOTIFY_TEMPLATE_KEYS = ['cart_idle_reminder'] as const;
export type MarketingNotifyTemplateKey =
  (typeof MARKETING_NOTIFY_TEMPLATE_KEYS)[number];

/** Thai labels for built-in (code-defined) notify templates in the picker. */
export const MARKETING_BUILTIN_TEMPLATE_LABELS: Record<string, string> = {
  cart_idle_reminder: 'เตือนตะกร้าค้าง (มาตรฐาน)',
};

/**
 * Admin-authored notify template — editable ชื่อ/หัวข้อ/ข้อความ + banner
 * (`image_url`, ใช้เป็น big picture บน push และเก็บใน data ของ in-app).
 * `template_key` = `custom_...` generated ฝั่ง server.
 */
/** สิ่งที่ปุ่มใน popup ทำเมื่อถูกกด (block type `button`). */
export type MarketingTemplateButtonAction = 'go_url' | 'copy_code' | 'close';

/** Building blocks of the drag-and-drop template page (editor state). */
export type MarketingTemplateBlock =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; url: string }
  | { id: string; type: 'coupon'; code: string }
  | {
      id: string;
      type: 'button';
      label: string;
      action: MarketingTemplateButtonAction;
      /** Destination when `action === 'go_url'` (shop path or absolute URL). */
      url?: string;
    };

export type MarketingTemplateType = 'notify' | 'popup';

/**
 * Braze-style segment variant ของ popup template — user ที่อยู่ใน `segmentId`
 * เห็นเนื้อหาชุดนี้แทนค่าเริ่มต้น (เรียงตามลำดับ ตัวแรกที่ match ชนะ).
 */
export type MarketingTemplateVariant = {
  id: string;
  segmentId: string;
  /** Cached for display — the segment may be renamed later. */
  segmentName?: string;
  title: string;
  blocks: MarketingTemplateBlock[];
  /** P1: optional partial channels; migrate from blocks when absent */
  channels?: Partial<MarketingCreativeChannels> | null;
};

/**
 * Dynamic placeholders replaced per-recipient at send time — mirrors
 * `MARKETING_TEMPLATE_VARIABLES` in
 * `apps/backend/src/app/marketing-workflow/marketing-template-vars.ts`.
 * `user_*` comes from `users`, `company_*` from the recipient's B2B account
 * (`company`), `cuisine_name` from their shop's cuisine.
 */
export const MARKETING_TEMPLATE_VARIABLES: Array<{ key: string; label: string }> = [
  { key: 'user_name', get label() { return __uiText("ชื่อลูกค้า"); } },
  { key: 'user_first_name', get label() { return __uiText("ชื่อจริงลูกค้า"); } },
  { key: 'user_last_name', get label() { return __uiText("นามสกุลลูกค้า"); } },
  { key: 'user_email', get label() { return __uiText("อีเมลลูกค้า"); } },
  { key: 'user_phone', get label() { return __uiText("เบอร์โทรลูกค้า"); } },
  { key: 'user_custype', get label() { return __uiText("ประเภทลูกค้า (custype)"); } },
  { key: 'company_name', get label() { return __uiText("ชื่อบริษัท/ร้าน"); } },
  { key: 'company_phone', get label() { return __uiText("เบอร์โทรบริษัท"); } },
  { key: 'company_credit_limit', get label() { return __uiText("วงเงินเครดิตบริษัท"); } },
  { key: 'cuisine_name', get label() { return __uiText("ประเภทร้าน (Cuisine)"); } },
  { key: 'today', get label() { return __uiText("วันที่วันนี้"); } },
];

export type MarketingNotifyTemplate = {
  id: string;
  template_key: string;
  /** `notify` = push/in-app/email; `popup` = shop popup layout (มีปุ่ม action ได้). */
  template_type: MarketingTemplateType;
  name: string;
  title: string;
  body: string;
  /**
   * Bilingual dispatch content — `title_en`/`body_en` are optional; when
   * blank the backend falls back to the code-defined registry for `en`
   * recipients (see `NotificationService.renderDispatchTemplate`).
   */
  title_en?: string | null;
  body_en?: string | null;
  image_url: string | null;
  blocks: MarketingTemplateBlock[] | null;
  channels?: MarketingCreativeChannels | null;
  /** popup เท่านั้น: variant ตาม segment (ตัวแรกที่ match ชนะ) */
  variants: MarketingTemplateVariant[] | null;
  created_by: string | null;
  /** true = เทมเพลตระบบ (order_paid, cart_idle_reminder, ...) — แก้ไขได้ แต่ลบไม่ได้ */
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type SaveMarketingNotifyTemplatePayload = {
  name: string;
  template_type?: MarketingTemplateType;
  title: string;
  body: string;
  title_en?: string | null;
  body_en?: string | null;
  image_url?: string | null;
  blocks?: MarketingTemplateBlock[] | null;
  channels?: MarketingCreativeChannels | null;
  variants?: MarketingTemplateVariant[] | null;
};

export const getMarketingNotifyTemplates = async (): Promise<
  MarketingNotifyTemplate[]
> => {
  const response = await apiClient.get('/marketing-notify-templates');
  // Nest body is `{ statusCode, message, data: T[] }`. Defend against a bare
  // array or a missing `data` so the admin list never silently becomes `[]`
  // from a shape mismatch (which previously looked like "no templates").
  const body = response?.data;
  const rows = Array.isArray(body) ? body : body?.data;
  return Array.isArray(rows) ? rows : [];
};

export const createMarketingNotifyTemplate = async (
  payload: SaveMarketingNotifyTemplatePayload,
): Promise<MarketingNotifyTemplate> => {
  const response = await apiClient.post('/marketing-notify-templates', payload);
  return response.data.data;
};

export const updateMarketingNotifyTemplate = async (
  id: string,
  payload: Partial<SaveMarketingNotifyTemplatePayload>,
): Promise<MarketingNotifyTemplate> => {
  const response = await apiClient.patch(
    `/marketing-notify-templates/${encodeURIComponent(id)}`,
    payload,
  );
  return response.data.data;
};

export const deleteMarketingNotifyTemplate = async (id: string): Promise<void> => {
  await apiClient.delete(`/marketing-notify-templates/${encodeURIComponent(id)}`);
};

export type MarketingNotifyTemplateRevision = {
  id: string;
  template_id: string;
  snapshot: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
};

export const getMarketingNotifyTemplateRevisions = async (
  id: string,
): Promise<MarketingNotifyTemplateRevision[]> => {
  const response = await apiClient.get(
    `/marketing-notify-templates/${encodeURIComponent(id)}/revisions`,
  );
  return response.data.data ?? [];
};

export const restoreMarketingNotifyTemplateRevision = async (
  id: string,
  revisionId: string,
): Promise<MarketingNotifyTemplate> => {
  const response = await apiClient.post(
    `/marketing-notify-templates/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
  );
  return response.data.data;
};

export type MarketingWorkflowEnrollmentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed';

export type MarketingWorkflowActionLogStatus = 'sent' | 'skipped' | 'failed';

/**
 * Always-on exit criteria: once reached, the enrollment leaves the whole
 * workflow instead of continuing to its remaining steps.
 */
export type MarketingGoalConfig =
  | { kind: 'order_placed' }
  | { kind: 'cart_converted' }
  | null;

export type MarketingWorkflow = {
  id: string;
  name: string;
  status: MarketingWorkflowStatus;
  trigger_type: MarketingTriggerType;
  trigger_config: MarketingTriggerConfig;
  steps: MarketingStep[];
  graph_ui: Record<string, unknown> | null;
  cooldown_days: number;
  /** % (0-100) of enrollments withheld as a never-messaged control arm. 0 = disabled. */
  holdout_percent: number;
  /** Days after enrollment to look for a matching order when measuring conversion. */
  conversion_window_days: number;
  /** `null` = never exit early. */
  exit_on_goal: MarketingGoalConfig;
  schedule: MarketingWorkflowSchedule;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingWorkflowEnrollment = {
  id: string;
  workflow_id: string;
  user_id: string;
  status: MarketingWorkflowEnrollmentStatus;
  skip_reason: string | null;
  enrollment_key: string;
  context: Record<string, unknown>;
  is_holdout: boolean;
  converted_at: string | null;
  converted_order_id: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type CreateMarketingWorkflowPayload = {
  name: string;
  trigger_type?: MarketingTriggerType;
  trigger_config?: MarketingTriggerConfig;
  steps?: MarketingStep[];
  graph_ui?: Record<string, unknown> | null;
  cooldown_days?: number;
  holdout_percent?: number;
  conversion_window_days?: number;
  /** `null` disables early exit (enrollment always runs to the end). */
  exit_on_goal?: MarketingGoalConfig;
  /** `null` clears the schedule (workflow becomes always-eligible). */
  schedule?: MarketingWorkflowSchedule;
};

export type UpdateMarketingWorkflowPayload = {
  name?: string;
  trigger_type?: MarketingTriggerType;
  trigger_config?: MarketingTriggerConfig;
  steps?: MarketingStep[];
  graph_ui?: Record<string, unknown> | null;
  cooldown_days?: number;
  holdout_percent?: number;
  conversion_window_days?: number;
  /** `null` disables early exit (enrollment always runs to the end). */
  exit_on_goal?: MarketingGoalConfig;
  /** `null` clears the schedule (workflow becomes always-eligible). */
  schedule?: MarketingWorkflowSchedule;
};

export type MarketingConversionStats = {
  workflowId: string;
  holdoutPercent: number;
  conversionWindowDays: number;
  sent: { enrolled: number; converted: number; rate: number };
  holdout: { enrolled: number; converted: number; rate: number };
  lift: number | null;
};

/** Mirrors `MarketingWorkflowAnalyticsDto` in the backend analytics service. */
export type MarketingWorkflowAnalytics = {
  workflowId: string;
  from: string;
  to: string;
  timezone: 'Asia/Bangkok';
  funnel: {
    enrolled: number;
    notifySent: number;
    offerShown: number;
    couponGranted: number;
    couponRedeemed: number;
    orderConverted: number;
    holdoutEnrolled: number;
    holdoutConverted: number;
  };
  rates: {
    enrollToNotify: number | null;
    enrollToOffer: number | null;
    grantToRedeem: number | null;
    enrollToOrder: number | null;
  };
  byHour: {
    granted: number[];
    redeemed: number[];
  };
};

export type MarketingWorkflowRevision = {
  id: string;
  workflow_id: string;
  snapshot: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
};

export type MarketingWorkflowPreviewResult = {
  count: number;
  sampleUserIds: string[];
};

export type MarketingWorkflowTestDryRunResult = {
  dryRun: true;
  plannedActions: Array<{ stepId: string; action: MarketingAction }>;
};

export type MarketingWorkflowTestRunResult = {
  dryRun: false;
  enrollmentId: string;
  enrollmentKey: string;
  triggerType?: string;
  userId?: string | null;
  individualId?: string | null;
  offerIds?: string[];
  howToSeePopup?: string;
  offerHint?: string;
};

export type MarketingWorkflowTestResult =
  | MarketingWorkflowTestDryRunResult
  | MarketingWorkflowTestRunResult;

export const getMarketingWorkflows = async (): Promise<any> => {
  const response = await apiClient.get('/marketing-workflows');
  return response;
};

export const createMarketingWorkflow = async (
  payload: CreateMarketingWorkflowPayload,
): Promise<any> => {
  const response = await apiClient.post('/marketing-workflows', payload);
  return response;
};

export const getMarketingWorkflow = async (id: string): Promise<any> => {
  const response = await apiClient.get(
    `/marketing-workflows/${encodeURIComponent(id)}`,
  );
  return response;
};

export const updateMarketingWorkflow = async (
  id: string,
  payload: UpdateMarketingWorkflowPayload,
): Promise<any> => {
  const response = await apiClient.patch(
    `/marketing-workflows/${encodeURIComponent(id)}`,
    payload,
  );
  return response;
};

export const activateMarketingWorkflow = async (id: string): Promise<any> => {
  const response = await apiClient.post(
    `/marketing-workflows/${encodeURIComponent(id)}/activate`,
  );
  return response;
};

export const pauseMarketingWorkflow = async (id: string): Promise<any> => {
  const response = await apiClient.post(
    `/marketing-workflows/${encodeURIComponent(id)}/pause`,
  );
  return response;
};

export const previewMarketingWorkflow = async (id: string): Promise<any> => {
  const response = await apiClient.post(
    `/marketing-workflows/${encodeURIComponent(id)}/preview`,
  );
  return response;
};

export const testMarketingWorkflow = async (
  id: string,
  payload: { userId?: string; individualId?: string; dryRun?: boolean },
): Promise<any> => {
  const response = await apiClient.post(
    `/marketing-workflows/${encodeURIComponent(id)}/test`,
    payload,
  );
  return response;
};

export const getMarketingWorkflowEnrollments = async (
  id: string,
): Promise<any> => {
  const response = await apiClient.get(
    `/marketing-workflows/${encodeURIComponent(id)}/enrollments`,
  );
  return response;
};

/** Holdout-vs-sent conversion-rate comparison (see docs/marketing-automation-research.md). */
export const getMarketingWorkflowConversionStats = async (
  id: string,
): Promise<MarketingConversionStats> => {
  const response = await apiClient.get(
    `/marketing-workflows/${encodeURIComponent(id)}/conversion-stats`,
  );
  return response.data.data;
};

export const getMarketingWorkflowAnalytics = async (
  id: string,
  params?: { from?: string; to?: string },
): Promise<MarketingWorkflowAnalytics> => {
  const response = await apiClient.get(
    `/marketing-workflows/${encodeURIComponent(id)}/analytics`,
    { params },
  );
  return response.data.data;
};

/** Mirrors `MarketingScheduledRunDto` from the backend scheduled-run service. */
export type MarketingWorkflowScheduledRun = {
  id: string;
  workflowId: string;
  firedAt: string;
  source: 'job_scheduler' | 'cron_sweep';
  status: 'fired' | 'skipped' | 'failed';
  skipReason:
    | 'not_due'
    | 'outside_schedule'
    | 'inactive_or_missing'
    | 'empty_audience'
    | null;
  audienceCount: number;
  enrolledCount: number;
  errorMessage: string | null;
  meta: Record<string, unknown>;
  workflowName?: string | null;
};

export const getMarketingWorkflowScheduledRuns = async (
  id: string,
  params?: { limit?: number },
): Promise<MarketingWorkflowScheduledRun[]> => {
  const response = await apiClient.get(
    `/marketing-workflows/${encodeURIComponent(id)}/scheduled-runs`,
    { params },
  );
  return response.data.data ?? [];
};

/** Cross-workflow BullMQ / scheduled-fire overview for the queue dashboard. */
export type MarketingScheduledRunOverview = {
  from: string;
  to: string;
  timezone: 'Asia/Bangkok';
  bucket: 'hour' | 'day';
  totals: {
    runs: number;
    attempts: number;
    fired: number;
    skipped: number;
    failed: number;
    enrolled: number;
    audience: number;
  };
  byWorkflow: Array<{
    workflowId: string;
    workflowName: string | null;
    runs: number;
    attempts: number;
    fired: number;
    failed: number;
    enrolled: number;
    audience: number;
  }>;
  byBucket: Array<{
    bucket: string;
    runs: number;
    enrolled: number;
    failed: number;
  }>;
  recentRuns: MarketingWorkflowScheduledRun[];
};

export const getMarketingScheduledRunOverview = async (params?: {
  days?: number;
  bucket?: 'hour' | 'day';
}): Promise<MarketingScheduledRunOverview> => {
  const response = await apiClient.get('/marketing-workflows/scheduled-run-overview', {
    params,
  });
  return response.data.data;
};

export const getMarketingWorkflowRevisions = async (
  id: string,
): Promise<MarketingWorkflowRevision[]> => {
  const response = await apiClient.get(
    `/marketing-workflows/${encodeURIComponent(id)}/revisions`,
  );
  return response.data.data ?? [];
};

export const restoreMarketingWorkflowRevision = async (
  id: string,
  revisionId: string,
): Promise<MarketingWorkflow> => {
  const response = await apiClient.post(
    `/marketing-workflows/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
  );
  return response.data.data;
};

/**
 * Reusable trigger saved standalone in the admin ("สร้าง trigger เก็บไว้ก่อน")
 * then applied to workflows. Applying copies type+config onto the workflow —
 * later preset edits do not back-propagate.
 */
export type MarketingTriggerPreset = {
  id: string;
  name: string;
  trigger_type: MarketingTriggerType;
  trigger_config: MarketingTriggerConfig;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SaveMarketingTriggerPresetPayload = {
  name: string;
  trigger_type: MarketingTriggerType;
  trigger_config: MarketingTriggerConfig;
};

export const getMarketingTriggerPresets = async (): Promise<
  MarketingTriggerPreset[]
> => {
  const response = await apiClient.get('/marketing-trigger-presets');
  const body = response?.data;
  const rows = Array.isArray(body) ? body : body?.data;
  return Array.isArray(rows) ? rows : [];
};

export const createMarketingTriggerPreset = async (
  payload: SaveMarketingTriggerPresetPayload,
): Promise<MarketingTriggerPreset> => {
  const response = await apiClient.post('/marketing-trigger-presets', payload);
  return response.data.data;
};

export const updateMarketingTriggerPreset = async (
  id: string,
  payload: Partial<SaveMarketingTriggerPresetPayload>,
): Promise<MarketingTriggerPreset> => {
  const response = await apiClient.patch(
    `/marketing-trigger-presets/${encodeURIComponent(id)}`,
    payload,
  );
  return response.data.data;
};

export const deleteMarketingTriggerPreset = async (id: string): Promise<void> => {
  await apiClient.delete(`/marketing-trigger-presets/${encodeURIComponent(id)}`);
};

export const validateMarketingExpression = async (
  expression: string,
): Promise<ValidateMarketingExpressionResult> => {
  const response = await apiClient.post('/marketing-workflows/validate-expression', {
    expression,
  });
  return response.data.data;
};

/** Max messages (notify + show_offer combined) one user can get per day, across every workflow. */
export type GlobalFrequencyCapSetting = {
  enabled: boolean;
  maxPerUserPerDay: number;
};

export const getGlobalFrequencyCap = async (): Promise<GlobalFrequencyCapSetting> => {
  const response = await apiClient.get('/marketing-settings/global-frequency-cap');
  return response.data.data;
};

export const updateGlobalFrequencyCap = async (
  payload: Partial<GlobalFrequencyCapSetting>,
): Promise<GlobalFrequencyCapSetting> => {
  const response = await apiClient.patch('/marketing-settings/global-frequency-cap', payload);
  return response.data.data;
};

/** Replacement text shown instead of `{{user_name}}` etc. when the real value is missing. */
export type TemplateVarFallbackSetting = Record<string, string>;

export const getTemplateVarFallbacks = async (): Promise<TemplateVarFallbackSetting> => {
  const response = await apiClient.get('/marketing-settings/template-var-fallbacks');
  return response.data.data;
};

export const updateTemplateVarFallbacks = async (
  payload: Partial<TemplateVarFallbackSetting>,
): Promise<TemplateVarFallbackSetting> => {
  const response = await apiClient.patch('/marketing-settings/template-var-fallbacks', payload);
  return response.data.data;
};

/** Per-page SEO metadata for landing-web, editable from the admin. */
export type LandingSeoPageMeta = { title: string; description: string; noindex?: boolean };
export type LandingSeoLocale = {
  home: LandingSeoPageMeta & { keywords: string[]; ogTitle?: string; ogDescription?: string };
  privacy: LandingSeoPageMeta;
  terms: LandingSeoPageMeta;
  /** '' (or omitted) = landing-web falls back to its default `og-default.jpg`. */
  ogImageUrl?: string;
  ogImageAlt?: string;
  /** key = media id (free-form string) -> alt text. */
  mediaAlt?: Record<string, string>;
};

export type LandingSeo = {
  en: LandingSeoLocale;
  th: LandingSeoLocale;
};

export type LandingSeoAdmin = { published: LandingSeo; draft: LandingSeo; dirty: boolean };

/** Draft/publish: this reads both versions plus whether the draft differs from published. */
export const getLandingSeo = async (): Promise<LandingSeoAdmin> => {
  const response = await apiClient.get('/marketing-settings/landing-seo');
  return response.data.data;
};

/** Writes the draft only — published is unaffected until `publishLandingSeo` is called. */
export const updateLandingSeo = async (payload: LandingSeo): Promise<LandingSeo> => {
  const response = await apiClient.patch('/marketing-settings/landing-seo', payload);
  return response.data.data;
};

export const publishLandingSeo = async (): Promise<LandingSeo> => {
  const response = await apiClient.post('/marketing-settings/landing-seo/publish');
  return response.data.data;
};

export const discardLandingSeoDraft = async (): Promise<LandingSeo> => {
  const response = await apiClient.post('/marketing-settings/landing-seo/discard');
  return response.data.data;
};

/** One section of a legal document (privacy/terms) — `\n` in `body` starts a new paragraph. */
export type LegalSection = { title: string; body: string };
export type LegalDocContent = { title: string; sections: LegalSection[] };
export type LegalDoc = { last_updated_at: string; th: LegalDocContent; en: LegalDocContent };
export type LegalDocs = { privacy: LegalDoc; terms: LegalDoc };

export const getLegalDocs = async (): Promise<LegalDocs> => {
  const response = await apiClient.get('/marketing-settings/legal-docs');
  return response.data.data;
};

export const updateLegalDocs = async (payload: LegalDocs): Promise<LegalDocs> => {
  const response = await apiClient.patch('/marketing-settings/legal-docs', payload);
  return response.data.data;
};

/** One saved version of `LegalDocs`, newest first. */
export type LegalDocsHistoryEntry = { saved_at: string; updated_by: string | null; value: LegalDocs };

export const getLegalDocsHistory = async (): Promise<LegalDocsHistoryEntry[]> => {
  const response = await apiClient.get('/marketing-settings/legal-docs/history');
  return response.data.data;
};

export const restoreLegalDocs = async (savedAt: string): Promise<LegalDocs> => {
  const response = await apiClient.post('/marketing-settings/legal-docs/restore', { saved_at: savedAt });
  return response.data.data;
};

/** Auto-translate: max 50 items per call. */
export type TranslateLegalDirection = { from: 'th' | 'en'; to: 'th' | 'en' };

export const translateLegalDocs = async (payload: {
  from: 'th' | 'en';
  to: 'th' | 'en';
  items: string[];
}): Promise<string[]> => {
  const response = await apiClient.post('/marketing-settings/legal-docs/translate', payload);
  return response.data.data.items;
};

/**
 * Welcome-lead email copy strings, per locale. `footerLegal` is rich HTML
 * limited to `br`/`strong`/`b` (sanitized server-side); `body` is full
 * Legal-Docs-editor HTML; everything else (including taglineTop/taglineBottom
 * and headlineTop/headlineBottom) is plain text.
 */
export type WelcomeLeadEmailCopy = {
  subject: string;
  taglineTop: string;
  taglineBottom: string;
  headlineTop: string;
  headlineBottom: string;
  body: string;
  cta: string;
  footerLegal: string;
  terms: string;
  termsUrl: string;
  privacy: string;
  privacyUrl: string;
};

/** Welcome-lead email font sizes (px, 8-64), per locale. */
export type WelcomeLeadEmailStyle = {
  taglineSize: number;
  headlineSize: number;
  bodySize: number;
  ctaSize: number;
  footerSize: number;
};

/** Welcome-lead email hero/logo/CTA — editable in prod without redeploy. */
export type WelcomeLeadEmailAssets = {
  heroUrl?: string | null;
  logoUrl?: string | null;
  enjoshUrl?: string | null;
  ctaUrl?: string | null;
  socialInstagramUrl?: string | null;
  socialTiktokUrl?: string | null;
  socialFacebookUrl?: string | null;
  socialLinkedinUrl?: string | null;
  updatedAt?: string | null;
  resolvedHeroUrl?: string | null;
  resolvedLogoUrl?: string | null;
  resolvedEnjoshUrl?: string | null;
  resolvedCtaUrl?: string | null;
  bgColor?: string | null;
  resolvedBgColor?: string | null;
  bgGradientStop?: number | null;
  resolvedBgGradientStop?: number | null;
  resolvedSocialInstagramUrl?: string | null;
  resolvedSocialTiktokUrl?: string | null;
  resolvedSocialFacebookUrl?: string | null;
  resolvedSocialLinkedinUrl?: string | null;
  /** Already merged (stored override over built-in default) — real text/numbers, not placeholders. */
  copy?: { th: WelcomeLeadEmailCopy; en: WelcomeLeadEmailCopy };
  style?: { th: WelcomeLeadEmailStyle; en: WelcomeLeadEmailStyle };
  defaults?: {
    copy: { th: WelcomeLeadEmailCopy; en: WelcomeLeadEmailCopy };
    style: { th: WelcomeLeadEmailStyle; en: WelcomeLeadEmailStyle };
    socialInstagramUrl: string;
    socialTiktokUrl: string;
    socialFacebookUrl: string;
    socialLinkedinUrl: string;
  };
};

export const getWelcomeLeadEmailAssets = async (): Promise<WelcomeLeadEmailAssets> => {
  const response = await apiClient.get('/marketing-settings/welcome-lead-email');
  return response.data.data;
};

export const updateWelcomeLeadEmailAssets = async (
  payload: Partial<
    Pick<
      WelcomeLeadEmailAssets,
      'ctaUrl' | 'socialInstagramUrl' | 'socialTiktokUrl' | 'socialFacebookUrl' | 'socialLinkedinUrl' | 'copy' | 'style' | 'bgColor' | 'bgGradientStop'
    >
  >,
): Promise<WelcomeLeadEmailAssets> => {
  const response = await apiClient.patch('/marketing-settings/welcome-lead-email', payload);
  return response.data.data;
};

export type WelcomeLeadImageKind = 'hero' | 'logo' | 'enjosh';

export const uploadWelcomeLeadImage = async (
  kind: WelcomeLeadImageKind,
  file: File,
): Promise<WelcomeLeadEmailAssets> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post(
    `/marketing-settings/welcome-lead-email/image/${kind}`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response.data.data;
};

export const resetWelcomeLeadImage = async (
  kind: WelcomeLeadImageKind,
): Promise<WelcomeLeadEmailAssets> => {
  const response = await apiClient.delete(`/marketing-settings/welcome-lead-email/image/${kind}`);
  return response.data.data;
};

/** Auto-translate welcome-lead-email copy fields: max 50 items per call. */
export const translateWelcomeLeadEmail = async (payload: {
  from: 'th' | 'en';
  to: 'th' | 'en';
  items: string[];
}): Promise<string[]> => {
  const response = await apiClient.post('/marketing-settings/welcome-lead-email/translate', payload);
  return response.data.data.items;
};

/** Renders the current (unsaved) draft to preview subject + HTML. */
export const previewWelcomeLeadEmail = async (
  payload: { locale: 'th' | 'en' } & Partial<
    Pick<
      WelcomeLeadEmailAssets,
      'ctaUrl' | 'socialInstagramUrl' | 'socialTiktokUrl' | 'socialFacebookUrl' | 'socialLinkedinUrl' | 'copy' | 'style' | 'bgColor' | 'bgGradientStop'
    >
  >,
): Promise<{ subject: string; html: string }> => {
  const response = await apiClient.post('/marketing-settings/welcome-lead-email/preview', payload);
  return response.data.data;
};

export type {
  MarketingCreativeChannels,
  ChannelDesign,
  CreativeLayoutDesign,
  PopupChrome,
  InAppChrome,
  EmailChrome,
  PushChannelDesign,
  CreativeElement,
  CreativeRow,
  CreativeColumn,
  TextStyle,
  ImageStyle,
  ButtonStyle,
  CouponStyle,
  DividerStyle,
} from './marketing-creative.schema';
export {
  migrateBlocksToChannelDesign,
  projectChannelDesignToBlocks,
  ensureTemplateChannels,
  isCreativeLayoutDesign,
} from './marketing-creative.schema';
