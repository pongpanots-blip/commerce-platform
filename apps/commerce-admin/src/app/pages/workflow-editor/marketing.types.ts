/** Marketing workflow types — ported from @josh/shared-api */

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
      couponId?: string;
      title?: string;
      body?: string;
      imageUrl?: string;
      ctaText?: string;
      ctaUrl?: string;
      hideCode?: boolean;
      popupTemplateKey?: string;
      displayOnly?: boolean;
      maxPerSession?: number;
    };

export type MarketingStep =
  | {
      id: string;
      type: 'audience';
      segmentIds?: string[];
      excludeSegmentIds?: string[];
      nextId?: string | null;
    }
  | { id: string; type: 'wait'; hours: number; minutes?: number; nextId?: string | null }
  | { id: string; type: 'gate'; kind: 'cart_still_open'; nextId?: string | null }
  | { id: string; type: 'action'; action: MarketingAction; nextId?: string | null }
  | {
      id: string;
      type: 'condition';
      expression: string;
      yesNextId: string | null;
      noNextId: string | null;
    };

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

export const MARKETING_EXPRESSION_FIELD_OPTIONS: Array<{
  value: MarketingExpressionField;
  label: string;
}> = [
  { value: 'cart.still_open', label: 'ตะกร้ายังมีของอยู่' },
  { value: 'cart.item_count', label: 'จำนวนชิ้นในตะกร้า' },
  { value: 'cart.total', label: 'ยอดรวมตะกร้า' },
  { value: 'still_no_order', label: 'ยังไม่เคยสั่งซื้อ' },
  { value: 'user.order_count', label: 'จำนวนออเดอร์ทั้งหมด' },
  { value: 'segment.in', label: 'อยู่ใน Segment' },
  { value: 'time.in_schedule', label: 'อยู่ในช่วงเวลาที่กำหนด' },
  { value: 'time.hour', label: 'ชั่วโมงปัจจุบัน (0-23)' },
  { value: 'time.dow', label: 'วันในสัปดาห์ (0=อาทิตย์)' },
  { value: 'page.views', label: 'จำนวนการเข้าชมหน้า' },
];

export const MARKETING_EXPRESSION_OPS_BY_TYPE: Record<
  MarketingExpressionFieldType,
  Array<{ value: MarketingExpressionOperator; label: string }>
> = {
  boolean: [
    { value: '==', label: 'เท่ากับ' },
    { value: '!=', label: 'ไม่เท่ากับ' },
  ],
  number: [
    { value: '==', label: '=' },
    { value: '!=', label: '≠' },
    { value: '>', label: '>' },
    { value: '>=', label: '≥' },
    { value: '<', label: '<' },
    { value: '<=', label: '≤' },
  ],
  segment: [
    { value: '==', label: 'อยู่ใน' },
    { value: '!=', label: 'ไม่อยู่ใน' },
  ],
};

export const MAX_MARKETING_CONDITION_STEPS = 5;
export const MAX_MARKETING_WAIT_STEPS = 3;
export const MAX_MARKETING_WAIT_MINUTES = 30 * 24 * 60;
export const MARKETING_CONDITION_WARN_THRESHOLD = 2;

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

export type MarketingCustomTriggerConfig = {
  label: string;
  description?: string;
  source?: MarketingCustomTriggerSource;
  delayMinutes?: number;
};

export type MarketingOrderMilestoneMetric =
  | 'single_order_total'
  | 'lifetime_spend'
  | 'lifetime_order_count';

export type MarketingOrderMilestoneOperator = '>=' | '>';

export type MarketingOrderMilestoneTriggerConfig = {
  metric: MarketingOrderMilestoneMetric;
  operator: MarketingOrderMilestoneOperator;
  value: number;
};

export type MarketingScheduledTriggerConfig = {
  time: string;
  daysOfWeek?: number[];
  timezone?: string;
};

export type MarketingTriggerConfig =
  | MarketingCartIdleTriggerConfig
  | MarketingPageAffinityTriggerConfig
  | MarketingSessionInWindowTriggerConfig
  | MarketingFirstLoginTriggerConfig
  | MarketingFirstVisitTriggerConfig
  | MarketingCustomTriggerConfig
  | MarketingOrderMilestoneTriggerConfig
  | MarketingScheduledTriggerConfig;

export type MarketingWorkflowSchedule = {
  timezone: string;
  daysOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  activeFrom?: string | null;
  activeTo?: string | null;
} | null;

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
  holdout_percent: number;
  conversion_window_days: number;
  exit_on_goal: MarketingGoalConfig;
  schedule: MarketingWorkflowSchedule;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
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
  exit_on_goal?: MarketingGoalConfig;
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
  exit_on_goal?: MarketingGoalConfig;
  schedule?: MarketingWorkflowSchedule;
};

export type MarketingConversionStats = {
  workflowId: string;
  holdoutPercent: number;
  totalEnrolled: number;
  totalConverted: number;
  conversionRate: number;
  lift: number | null;
};

export type MarketingWorkflowAnalytics = {
  workflowId: string;
  totalEnrolled: number;
  activeEnrollments: number;
  completedEnrollments: number;
  failedEnrollments: number;
  skippedEnrollments: number;
  byCoupon?: Array<{
    couponId: string;
    couponCode: string;
    count: number;
  }>;
  byHour?: Array<{
    hour: number;
    count: number;
  }>;
};

export type MarketingWorkflowRevision = {
  id: string;
  workflow_id: string;
  snapshot: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
};

export type MarketingWorkflowPreviewResult = {
  enrolled: boolean;
  steps: Array<{ stepId: string; skipped?: boolean; branch?: 'yes' | 'no' }>;
};

export type MarketingWorkflowTestDryRunResult = {
  type: 'dry_run';
  enrolled: boolean;
  steps: Array<{ stepId: string; skipped?: boolean; branch?: 'yes' | 'no' }>;
};

export type MarketingWorkflowTestRunResult = {
  type: 'run';
  userId?: string;
  individualId?: string;
  couponsGranted: string[];
  notificationsSent: Array<{
    channel: MarketingNotifyChannel;
    status: 'sent' | 'failed';
  }>;
};

export type MarketingWorkflowTestResult = MarketingWorkflowTestDryRunResult | MarketingWorkflowTestRunResult;

export type UserSegmentListItem = {
  id: string;
  name: string;
  description?: string;
};

export type ValidateMarketingExpressionResult = { ok: boolean; error?: string };
