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
  if (total <= 0) return '0 นาที';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h} ชม. ${m} นาที`;
  if (h > 0) return `${h} ชั่วโมง`;
  return `${m} นาที`;
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
    title: 'ตะกร้าค้าง',
    description: 'เมื่อตะกร้าไม่ถูกแตะเป็นเวลาที่กำหนด',
  },
  {
    type: 'page_affinity',
    title: 'เข้าชมหน้าค้าง',
    description: 'เมื่อลูกค้าดูหน้าเดิมบ่อยพอในช่วงเวลา (ชม./นาที)',
  },
  {
    type: 'session_in_window',
    title: 'ช่วงเวลา + Login',
    description: 'คนที่ล็อกอินในช่วงเวลาที่ตั้งไว้ (และ/หรือใน segment)',
  },
  {
    type: 'first_login',
    title: 'Login ครั้งแรก',
    description: 'เมื่อลูกค้าเข้าสู่ระบบครั้งแรกบนแอป/เว็บ',
  },
  {
    type: 'first_visit',
    title: 'เข้าเว็บครั้งแรก',
    description: 'เมื่อเปิดเว็บครั้งแรกบนอุปกรณ์นี้ (guest ได้) — เหมาะกับ popup',
  },
  {
    type: 'custom',
    title: 'กำหนดเอง (Custom)',
    description:
      'ตั้งชื่อเงื่อนไขเอง เช่น "ช่วงฝนตก" — กด Activate เมื่อเริ่มช่วง ทุกคนที่เข้าเว็บจะได้ popup/action, กด Pause เมื่อจบ',
  },
  {
    type: 'order_milestone',
    title: 'ยอดสั่งซื้อถึงเป้า (Milestone)',
    description:
      'ต่อเงื่อนไขเอง เช่น "order เดียวเกิน 5,000 ครั้งแรก" หรือ "ยอดสะสมถึง 100,000 ครั้งแรก" — ทำงานคนละ 1 ครั้ง',
  },
  {
    type: 'scheduled',
    title: 'ตามเวลา (Scheduled)',
    description:
      'ยิงเองตามเวลา เช่น "ทุกวัน 18:00" หรือ "ทุกวันจันทร์ 19:00" — ส่งให้ Audience ที่เลือก (ไม่เลือก = ทุกคน)',
  },
];

/** Short chips for the schedule strip (not the full `describeMarketingSchedule` sentence). */
export function scheduleStripChips(schedule: MarketingWorkflowSchedule): string[] {
  if (!schedule) return ['ตลอดเวลา'];
  const chips: string[] = [];
  if (!schedule.daysOfWeek?.length || schedule.daysOfWeek.length === 7) {
    chips.push('ทุกวัน');
  } else {
    const labels = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    chips.push([...schedule.daysOfWeek].sort().map((d) => labels[d] ?? String(d)).join(','));
  }
  chips.push(`${schedule.startTime ?? '00:00'}–${schedule.endTime ?? '24:00'}`);
  chips.push(schedule.timezone || 'Asia/Bangkok');
  return chips;
}
