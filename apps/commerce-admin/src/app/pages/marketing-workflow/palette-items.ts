// ui-copy-migration: only literal UI copy and notification templates
import { uiText } from '@cp/ui';
import type { TriggerType, WorkflowMeta, WorkflowStep } from '@cp/marketing-workflow';
import type { StepKind } from './workflow-graph';

export interface PaletteItem { id: StepKind | TriggerType; readonly label: string; icon: string; trigger?: true }
export interface PaletteCategory { category: 'entry' | 'channel' | 'flow' | 'reward'; readonly title: string; color: string; items: PaletteItem[] }

/** Category colours are theme tokens (design.md), so the icon squares follow the shell's brand and status colours. */
export const PALETTE: PaletteCategory[] = [
  { category: 'entry', get title() { return uiText('จุดเริ่ม'); }, color: 'var(--color-primary)', items: [
    { id: 'scheduled', get label() { return uiText('ตามเวลา'); }, icon: 'schedule', trigger: true },
    { id: 'order_milestone', get label() { return uiText('ยอดสั่งซื้อถึงเป้า'); }, icon: 'shopping_cart_checkout', trigger: true },
    { id: 'first_login', get label() { return uiText('เข้าแอปครั้งแรก'); }, icon: 'person_add', trigger: true },
    { id: 'app_login', get label() { return uiText('กลับมาเข้าแอป'); }, icon: 'autorenew', trigger: true },
    { id: 'event', get label() { return uiText('เมื่อลูกค้าทำสิ่งที่กำหนด'); }, icon: 'bolt', trigger: true },
  ] },
  { category: 'channel', get title() { return uiText('ช่องทางส่ง'); }, color: 'var(--color-info)', items: [
    { id: 'push', get label() { return uiText('การแจ้งเตือน'); }, icon: 'notifications' },
    { id: 'email', get label() { return uiText('อีเมล'); }, icon: 'mail' },
    { id: 'in_app', get label() { return uiText('ข้อความในแอป'); }, icon: 'chat' },
    { id: 'webhook', get label() { return uiText('ส่งข้อมูลไประบบอื่น'); }, icon: 'webhook' },
  ] },
  { category: 'flow', get title() { return uiText('ลำดับขั้นตอน'); }, color: 'var(--color-on-surface-variant)', items: [
    { id: 'wait', get label() { return uiText('รอเวลา'); }, icon: 'hourglass_top' },
    { id: 'wait_event', get label() { return uiText('รอให้ลูกค้าทำสิ่งที่กำหนด'); }, icon: 'pending_actions' },
    { id: 'condition', get label() { return uiText('แยกตามเงื่อนไข'); }, icon: 'polyline' },
    { id: 'event_split', get label() { return uiText('แยกตามสิ่งที่ลูกค้าทำ'); }, icon: 'rule' },
    { id: 'split', get label() { return uiText('แบ่งกลุ่มทดลอง'); }, icon: 'account_tree' },
    { id: 'audience', get label() { return uiText('คัดกลุ่มลูกค้า'); }, icon: 'group' },
  ] },
  { category: 'reward', get title() { return uiText('รางวัล'); }, color: 'var(--color-warn)', items: [
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
  if (item.id === 'audience' && count('audience') >= limits.maxAudienceSteps) return uiText('คัดกลุ่มลูกค้าได้ขั้นตอนเดียว');
  if ((item.id === 'wait' || item.id === 'wait_event') && count('wait', 'wait_event') >= limits.maxWaitSteps) return uiText('ขั้นตอนรอครบ {0} ขั้นแล้ว', { 0: limits.maxWaitSteps });
  if ((item.id === 'condition' || item.id === 'event_split') && count('condition', 'event_split') >= limits.maxConditionSteps) return uiText('ขั้นตอนแยกเส้นทางครบ {0} ขั้นแล้ว', { 0: limits.maxConditionSteps });
  return null;
}
