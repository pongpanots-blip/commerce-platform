/** Commerce marketing workflow (spec 2026-10-10) — shared by commerce-platform and commerce-admin. Types only. */
export type NotifyChannel = 'push' | 'email' | 'in_app';
export type WebhookMethod = 'POST' | 'PUT' | 'PATCH' | 'GET';
export type WorkflowAction =
  | { kind: 'notify'; channels: NotifyChannel[]; templateKey: string; data?: Record<string, unknown> }
  | { kind: 'grant_coupon'; couponId: string };
export interface SplitBranch { id: string; label: string; percent: number; nextId: string | null }
export interface WebhookHeader { key: string; value: string }
export type WorkflowStep =
  | { id: string; type: 'audience'; segmentIds?: string[]; excludeSegmentIds?: string[]; nextId: string | null }
  | { id: string; type: 'wait'; hours: number; minutes?: number; nextId: string | null }
  | { id: string; type: 'condition'; expression: string; yesNextId: string | null; noNextId: string | null }
  | { id: string; type: 'split'; branches: SplitBranch[] }
  | { id: string; type: 'action'; action: WorkflowAction; nextId: string | null }
  | { id: string; type: 'webhook'; method: WebhookMethod; url: string; headers: WebhookHeader[]; body?: string; nextId: string | null };
export type WorkflowStepType = WorkflowStep['type'];
export type TriggerType = 'scheduled' | 'order_milestone' | 'first_login' | 'app_login';
export interface ScheduledTriggerConfig { time: string; daysOfWeek?: number[]; timezone?: string }
export interface OrderMilestoneTriggerConfig { metric: 'single_order_total' | 'lifetime_spend' | 'lifetime_order_count'; operator: '>=' | '>'; value: number }
export type TriggerConfig = ScheduledTriggerConfig | OrderMilestoneTriggerConfig | Record<string, never>;
export type WorkflowSchedule = {
  timezone: string; daysOfWeek?: number[]; startTime?: string; endTime?: string; activeFrom?: string | null; activeTo?: string | null;
} | null;
export type ExitGoal = { kind: 'order_placed' } | null;
export type WorkflowStatus = 'draft' | 'active' | 'paused';
export interface CanvasPosition { x: number; y: number }
export interface WorkflowInput {
  name: string; triggerType: TriggerType; triggerConfig: TriggerConfig; entryStepId: string | null; steps: WorkflowStep[];
  graphUi: Record<string, CanvasPosition> | null; cooldownDays: number; holdoutPercent: number; conversionWindowDays: number;
  exitOnGoal: ExitGoal; schedule: WorkflowSchedule;
}
export interface WorkflowIssue { stepId: string | null; code: string; message: string }
export interface Workflow extends WorkflowInput {
  id: string; status: WorkflowStatus; activatedAt: string | null; createdBy: string | null; updatedBy: string | null;
  createdAt: string; updatedAt: string; issues: WorkflowIssue[];
}
export interface WorkflowListItem { id: string; name: string; status: WorkflowStatus; triggerType: TriggerType; updatedAt: string; enrolled30d: number; converted30d: number }
export interface WorkflowMeta {
  limits: { maxWaitSteps: number; maxConditionSteps: number; maxAudienceSteps: number; maxWaitMinutes: number; maxHeaders: number; maxBodyBytes: number; minSplitBranches: number; maxSplitBranches: number };
  expressionFields: { field: string; type: 'boolean' | 'number' | 'segment'; label: string }[];
  templateVars: { key: string; label: string }[];
}
export interface SegmentOption { id: string; name: string; memberCount: number | null }
export interface WorkflowRevision { id: string; createdBy: string | null; createdAt: string; snapshot: WorkflowInput }
export interface WorkflowAnalytics {
  counts: { enrolled: number; running: number; completed: number; skipped: number; failed: number; converted: number; holdout: number };
  actions: { kind: string; status: string; count: number }[];
  splits: { stepId: string; branches: { branchId: string; label: string; entered: number; converted: number }[] }[];
  holdout: { enrolled: number; converted: number }; treated: { enrolled: number; converted: number };
}
export interface EnrollmentRow {
  id: string; userId: string; status: string; occurrenceKey: string; currentStepId: string | null; resumeAt: string | null;
  isHoldout: boolean; isTest: boolean; startedAt: string; completedAt: string | null; endReason: string | null; convertedAt: string | null;
}
export interface ActionLogRow { id: string; stepId: string; kind: string; status: string; meta: Record<string, unknown>; createdAt: string }
export interface WebhookSecretItem { id: string; name: string; createdAt: string; updatedAt: string }
export interface WebhookTestResult { status: number | null; body: string; error?: string }
