import { uiText as __uiText } from '@cp/ui';
// ui-static-options-migration: display metadata; identifiers remain unchanged
import { getUiLocale, uiText } from '@cp/ui';
import type {
  MarketingTriggerConfig,
  MarketingTriggerType,
  MarketingWorkflowSchedule,
} from './shared-api';

/** Resolve hours + minutes → total minutes (same rules as backend `marketing-duration`). */
export function durationToMinutes(
  hours?: number | null,
  minutes?: number | null,
  defaultHours = 0,
): number {
  const h = Number(hours);
  const m = Number(minutes);
  const safeH = Number.isFinite(h) && h > 0 ? h : 0;
  const safeM = Number.isFinite(m) && m > 0 ? m : 0;
  if (safeH === 0 && safeM === 0) {
    return Math.max(0, defaultHours) * 60;
  }
  return safeH * 60 + safeM;
}

export function formatDurationLabel(hours?: number | null, minutes?: number | null): string {
  const total = durationToMinutes(hours, minutes, 0);
  if (total <= 0) return __uiText("0 นาที");
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return __uiText("{0} ชม. {1} นาที",{"0":h,"1":m});
  if (h > 0) return __uiText("{0} ชั่วโมง",{"0":h});
  return __uiText("{0} นาที",{"0":m});
}

/** Mirrors `defaultTriggerConfig` in `apps/backend/src/app/marketing-workflow/marketing-workflow.service.ts`. */
export function defaultTriggerConfigFor(type: MarketingTriggerType): MarketingTriggerConfig {
  if (type === 'page_affinity') {
    return {
      pageType: 'pdp',
      entityId: null,
      path: null,
      minViews: 3,
      windowHours: 24,
      windowMinutes: 0,
    };
  }
  if (type === 'session_in_window') {
    return { lookbackMinutes: 20 };
  }
  if (type === 'first_login' || type === 'first_visit') {
    return {};
  }
  if (type === 'custom') {
    return { label: '' };
  }
  if (type === 'order_milestone') {
    return { metric: 'single_order_total', operator: '>=', value: 5000 };
  }
  if (type === 'scheduled') {
    return { time: '18:00', daysOfWeek: [] };
  }
  return { idleHours: 24, idleMinutes: 0 };
}

export const TRIGGER_TYPE_CARDS: Array<{
  type: MarketingTriggerType;
  title: string;
  description: string;
}> = [
  {
    type: 'cart_idle',
    get title(){return uiText("ตะกร้าค้าง");},
    get description(){return uiText("ลูกค้าใส่ของในตะกร้าแล้วไม่สั่งซื้อตามเวลาที่ตั้ง");},
  },
  {
    type: 'page_affinity',
    get title(){return uiText("ดูหน้าเดิมซ้ำ");},
    get description(){return uiText("ลูกค้าเปิดดูหน้าเดิมหลายครั้งในช่วงเวลาที่ตั้ง");},
  },
  {
    type: 'session_in_window',
    get title(){return uiText("เข้าสู่ระบบในช่วงเวลา");},
    get description(){return uiText("ลูกค้าที่เข้าสู่ระบบในช่วงเวลาทำงานที่ตั้งไว้");},
  },
  {
    type: 'first_login',
    get title(){return uiText("เข้าสู่ระบบครั้งแรก");},
    get description(){return uiText("ลูกค้าเข้าสู่ระบบครั้งแรกบนแอปหรือเว็บ");},
  },
  {
    type: 'first_visit',
    get title(){return uiText("เข้าเว็บครั้งแรก");},
    get description(){return uiText("เปิดเว็บครั้งแรกบนเครื่องนี้ ยังไม่เข้าสู่ระบบก็ได้ เหมาะกับป๊อปอัป");},
  },
  {
    type: 'custom',
    get title(){return uiText("กำหนดเอง");},
    get description(){return uiText("ตั้งชื่อช่วงเอง เช่น ช่วงฝนตก กดเปิดใช้งานเมื่อเริ่มช่วง และกดหยุดชั่วคราวเมื่อจบ");},
  },
  {
    type: 'order_milestone',
    get title(){return uiText("ยอดสั่งซื้อถึงเป้า");},
    get description(){return uiText("เช่น ออเดอร์เดียวเกิน 5,000 บาท หรือยอดสะสมถึง 100,000 บาท ทำงานคนละครั้ง");},
  },
  {
    type: 'scheduled',
    get title(){return uiText("ตามเวลา");},
    get description(){return uiText("ส่งตามเวลาที่ตั้ง เช่น ทุกวัน 18:00 ให้กลุ่มเป้าหมายที่เลือก (ไม่เลือก = ทุกคน)");},
  },
];

/** Display label for a notify channel; the stored value stays the code. */
export function marketingChannelLabel(channel: string): string {
  if (channel === 'push') return uiText('การแจ้งเตือน');
  if (channel === 'email') return uiText('อีเมล');
  if (channel === 'in_app') return uiText('ข้อความในแอป');
  return channel;
}

/** Short chips for the schedule strip (not the full `describeMarketingSchedule` sentence). */
export function scheduleStripChips(schedule: MarketingWorkflowSchedule): string[] {
  if (!schedule) return [uiText('ตลอดเวลา')];
  const chips: string[] = [];
  if (!schedule.daysOfWeek?.length || schedule.daysOfWeek.length === 7) {
    chips.push(uiText('ทุกวัน'));
  } else {
    const labels = getUiLocale() === 'th' ? ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    chips.push([...schedule.daysOfWeek].sort().map((d) => labels[d] ?? String(d)).join(','));
  }
  chips.push(`${schedule.startTime ?? '00:00'}–${schedule.endTime ?? '24:00'}`);
  chips.push(schedule.timezone || 'Asia/Bangkok');
  return chips;
}

// ui-display-helper-migration: display descriptions; record values and enum keys remain data
