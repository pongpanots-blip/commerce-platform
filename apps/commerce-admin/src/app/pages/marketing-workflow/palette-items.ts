// ui-copy-migration: only literal UI copy and notification templates
import { uiText } from '@cp/ui';
import type { TriggerType, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import type { StepKind } from './workflow-graph';

export interface PaletteItem { id: StepKind | TriggerType; readonly label: string; icon: string; trigger?: true }
export interface PaletteCategory { category: 'entry' | 'channel' | 'flow' | 'reward'; readonly title: string; color: string; items: PaletteItem[] }

/** Category colours from the reference journey builder (entry green, channels purple, flow blue, integrations orange). */
export const PALETTE: PaletteCategory[] = [
  { category: 'entry', get title() { return uiText('ENTRY'); }, color: '#5b9a2f', items: [
    { id: 'scheduled', get label() { return uiText('ตามเวลา (Scheduled)'); }, icon: 'schedule', trigger: true },
    { id: 'order_milestone', get label() { return uiText('ยอดสั่งซื้อถึงเป้า'); }, icon: 'shopping_cart_checkout', trigger: true },
    { id: 'first_login', get label() { return uiText('เข้าแอปครั้งแรก'); }, icon: 'person_add', trigger: true },
    { id: 'app_login', get label() { return uiText('กลับมาเข้าแอป'); }, icon: 'autorenew', trigger: true },
    { id: 'event', get label() { return uiText('เมื่อเกิด event'); }, icon: 'bolt', trigger: true },
  ] },
  { category: 'channel', get title() { return uiText('CHANNELS'); }, color: '#a157d8', items: [
    { id: 'push', get label() { return uiText('Push'); }, icon: 'notifications' },
    { id: 'email', get label() { return uiText('Email'); }, icon: 'mail' },
    { id: 'in_app', get label() { return uiText('In-App'); }, icon: 'chat' },
    { id: 'webhook', get label() { return uiText('Webhook'); }, icon: 'webhook' },
  ] },
  { category: 'flow', get title() { return uiText('FLOW'); }, color: '#3d8fe8', items: [
    { id: 'wait', get label() { return uiText('Time Delay'); }, icon: 'hourglass_top' },
    { id: 'wait_event', get label() { return uiText('Wait for event'); }, icon: 'pending_actions' },
    { id: 'condition', get label() { return uiText('Condition Split'); }, icon: 'polyline' },
    { id: 'event_split', get label() { return uiText('Event condition'); }, icon: 'rule' },
    { id: 'split', get label() { return uiText('A/B Split'); }, icon: 'account_tree' },
    { id: 'audience', get label() { return uiText('Audience filter'); }, icon: 'group' },
  ] },
  { category: 'reward', get title() { return uiText('REWARDS'); }, color: '#e5853a', items: [
    { id: 'grant_coupon', get label() { return uiText('แจกคูปอง'); }, icon: 'sell' },
  ] },
];

export const categoryOf = (id: string): PaletteCategory => PALETTE.find((c) => c.items.some((i) => i.id === id)) ?? PALETTE[2];
export const itemOf = (id: string): PaletteItem | undefined => PALETTE.flatMap((c) => c.items).find((i) => i.id === id);

/** Kind of a saved step, for colours / icons on the canvas. */
export function kindOf(step: WorkflowStep): StepKind {
  if (step.type === 'action') return step.action.kind === 'grant_coupon' ? 'grant_coupon' : step.action.channels[0] ?? 'push';
  return step.type as StepKind;
}

export function disabledReason(item: PaletteItem, steps: WorkflowStep[], triggerType: TriggerType, limits: WorkflowMeta['limits']): string | null {
  if (item.trigger) return item.id === triggerType ? uiText('ใช้อยู่แล้ว') : null;
  const count = (...t: WorkflowStep['type'][]) => steps.filter((s) => t.includes(s.type)).length;
  if (item.id === 'audience' && count('audience') >= limits.maxAudienceSteps) return uiText('มี Audience filter ได้ 1 อัน');
  if ((item.id === 'wait' || item.id === 'wait_event') && count('wait', 'wait_event') >= limits.maxWaitSteps) return uiText('Time Delay ครบ {0} อันแล้ว', { 0: limits.maxWaitSteps });
  if ((item.id === 'condition' || item.id === 'event_split') && count('condition', 'event_split') >= limits.maxConditionSteps) return uiText('Condition ครบ {0} อันแล้ว', { 0: limits.maxConditionSteps });
  return null;
}
