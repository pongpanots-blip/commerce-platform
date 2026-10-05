/**
 * Coupon dates: DB stores UTC (timestamptz); every human-facing surface
 * (web-admin forms, shop wallet, admin lists) shows Asia/Bangkok.
 * Bangkok has no DST, so the offset is a fixed +07:00 (ponytail: no tz lib).
 */
export const BANGKOK_TZ = 'Asia/Bangkok';
const BANGKOK_OFFSET = '+07:00';

function bangkokParts(value: string | Date): Record<string, string> | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const p of parts) out[p.type] = p.value;
  return out;
}

/** ISO/Date → `YYYY-MM-DDTHH:mm` in Bangkok time, for `<input type="datetime-local">`. */
export function toBangkokInputValue(value: string | Date | null | undefined): string {
  if (!value) return '';
  const p = bangkokParts(value);
  if (!p) return '';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** `YYYY-MM-DDTHH:mm` (or `YYYY-MM-DD` = 00:00) typed as Bangkok time → UTC ISO string. */
export function fromBangkokInputValue(local: string): string {
  const trimmed = local?.trim() ?? '';
  if (!trimmed) return '';
  const withTime = trimmed.length === 10 ? `${trimmed}T00:00` : trimmed;
  const date = new Date(`${withTime}:00${BANGKOK_OFFSET}`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/** `8 Sep 2026, 14:30` (en) / `8 ก.ย. 2026, 14:30` (th) in Bangkok time. */
export function formatBangkokDateTime(
  value: string | Date | null | undefined,
  locale: 'th' | 'en' = 'en',
): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(locale === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB', {
    timeZone: BANGKOK_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatBangkokRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  locale: 'th' | 'en' = 'en',
): string {
  return `${formatBangkokDateTime(start, locale)} - ${formatBangkokDateTime(end, locale)}`;
}
