// Copied from josh origin/main 00030d02b apps/backend/src/app/marketing-workflow/marketing-schedule.ts — keep in sync by hand (phase 3 retires josh's copy).
import type { WorkflowSchedule as MarketingWorkflowSchedule } from './workflow.types';

export const DEFAULT_MARKETING_TIMEZONE = 'Asia/Bangkok';
const DEFAULT_TIMEZONE = DEFAULT_MARKETING_TIMEZONE;

/** `Intl` weekday keys ordered to match JS `Date#getDay()` (0 = Sunday). */
const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Resolves `now`'s local date/time parts in `timezone` without pulling in a
 * date library — `Intl.DateTimeFormat` already ships with Node and handles
 * IANA zone offsets (including DST) correctly, unlike a hardcoded +07:00.
 */
function localParts(now: Date, timezone: string): { dow: number; minutesOfDay: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');

  return {
    dow: WEEKDAY_TO_INDEX[weekday] ?? 0,
    minutesOfDay: hour * 60 + minute,
  };
}

function parseTimeToMinutes(value: string | undefined, fallbackMinutes: number): number {
  if (!value) return fallbackMinutes;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return fallbackMinutes;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
}

/** Local calendar date (YYYY-MM-DD) of `now` in `timezone` — occurrence bucket for scheduled triggers. */
export function localDateKey(now: Date, timezone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * True while a `scheduled` trigger's occurrence is due: today is in
 * `daysOfWeek` (empty = every day) and local time is within
 * [`time`, `time` + `graceMinutes`). The grace window lets cron ticks that
 * run after the exact minute still fire; the per-day enrollment key keeps
 * repeat ticks inside the window idempotent.
 */
export function isScheduledFireDue(
  config: { time?: string; daysOfWeek?: number[]; timezone?: string },
  now: Date,
  graceMinutes = 30,
): boolean {
  const timezone = config.timezone || DEFAULT_TIMEZONE;
  const target = parseTimeToMinutes(config.time, -1);
  if (target < 0) return false;

  const { dow, minutesOfDay } = localParts(now, timezone);
  if (config.daysOfWeek && config.daysOfWeek.length > 0 && !config.daysOfWeek.includes(dow)) {
    return false;
  }
  return minutesOfDay >= target && minutesOfDay < target + graceMinutes;
}

/**
 * Gates marketing workflow enrollment on an optional schedule window.
 * `null`/`undefined` always passes (Phase 1 behavior — schedule is opt-in).
 * `activeFrom`/`activeTo` are absolute instants compared directly against
 * `now`; `daysOfWeek`/`startTime`/`endTime` are evaluated against `now`
 * converted into the schedule's local `timezone` (default `Asia/Bangkok`).
 */
export function isWithinMarketingSchedule(
  schedule: MarketingWorkflowSchedule,
  now: Date,
): boolean {
  if (!schedule) return true;

  if (schedule.activeFrom && now < new Date(schedule.activeFrom)) {
    return false;
  }
  if (schedule.activeTo && now >= new Date(schedule.activeTo)) {
    return false;
  }

  const timezone = schedule.timezone || DEFAULT_TIMEZONE;
  const { dow, minutesOfDay } = localParts(now, timezone);

  if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0 && !schedule.daysOfWeek.includes(dow)) {
    return false;
  }

  if (schedule.startTime || schedule.endTime) {
    const startMinutes = parseTimeToMinutes(schedule.startTime, 0);
    const endMinutes = parseTimeToMinutes(schedule.endTime, 24 * 60);
    if (minutesOfDay < startMinutes || minutesOfDay >= endMinutes) {
      return false;
    }
  }

  return true;
}

/** Local hour-of-day (0-23) for `time.hour`, in `timezone` (default Asia/Bangkok when unset). */
export function localHour(timezone: string | null | undefined, now: Date = new Date()): number {
  const { minutesOfDay } = localParts(now, timezone || DEFAULT_TIMEZONE);
  return Math.floor(minutesOfDay / 60);
}

/** Local day-of-week (0 = Sunday .. 6 = Saturday) for `time.dow`, in `timezone`. */
export function localDow(timezone: string | null | undefined, now: Date = new Date()): number {
  return localParts(now, timezone || DEFAULT_TIMEZONE).dow;
}
