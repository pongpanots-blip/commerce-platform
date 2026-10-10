import type { WorkflowStep } from '@cp/marketing-workflow';
export type {
  CanvasPosition, ExitGoal, NotifyChannel, OrderMilestoneTriggerConfig, ScheduledTriggerConfig, SplitBranch, TriggerConfig,
  TriggerType, WebhookHeader, WebhookMethod, Workflow, WorkflowAction, WorkflowInput, WorkflowIssue, WorkflowSchedule,
  WorkflowStatus, WorkflowStep, WorkflowStepType, WorkflowListItem, WorkflowMeta, WorkflowRevision, WorkflowAnalytics,
  EnrollmentRow, ActionLogRow, WebhookSecretItem, WebhookTestResult, SegmentOption,
  EventFilter, EventRule, EventTriggerConfig, TriggerEvent, WaitingFor,
} from '@cp/marketing-workflow';

/** Same numbers as josh's editor / validator (MAX_MARKETING_WAIT_STEPS = 3, MAX_MARKETING_CONDITION_STEPS = 5). */
export const LIMITS = {
  maxWaitSteps: 3, maxConditionSteps: 5, maxAudienceSteps: 1, maxWaitMinutes: 30 * 24 * 60,
  maxHeaders: 20, maxBodyBytes: 16 * 1024, maxUrlLength: 1024, minSplitBranches: 2, maxSplitBranches: 4,
} as const;
export const TRIGGER_TYPES = ['scheduled', 'order_milestone', 'first_login', 'app_login', 'event'] as const;
export const NOTIFY_CHANNELS = ['push', 'email', 'in_app'] as const;
export const WEBHOOK_METHODS = ['POST', 'PUT', 'PATCH', 'GET'] as const;
/** Push to a guest device: at most this many per device per rolling 24 h, all workflows (spec §10). */
export const GUEST_PUSH_DAILY_CAP = 1;

/** Every outgoing pointer of a step, in port order (condition / event_split: yes, no · split: branch order · wait_event: matched, timeout). */
export function nextIdsOf(step: WorkflowStep): (string | null)[] {
  if (step.type === 'condition' || step.type === 'event_split') return [step.yesNextId, step.noNextId];
  if (step.type === 'split') return step.branches.map((b) => b.nextId);
  if (step.type === 'wait_event') return [step.matchedNextId, step.timeoutNextId];
  return [step.nextId];
}
