/** Jagota / Thai systems may send Buddhist Era years (e.g. 2568 = 2025 CE). */
export const THAI_BUDDHIST_ERA_YEAR_THRESHOLD = 2500;
export const THAI_BUDDHIST_ERA_OFFSET = 543;

export function isActiveDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  at: Date,
): boolean {
  const day = at.toISOString().slice(0, 10);
  const startDay = start ? new Date(start).toISOString().slice(0, 10) : null;
  const endDay = end ? new Date(end).toISOString().slice(0, 10) : null;
  if (startDay && day < startDay) return false;
  if (endDay && day > endDay) return false;
  return true;
}

export function toGregorianYear(year: number): number {
  if (year >= THAI_BUDDHIST_ERA_YEAR_THRESHOLD) {
    return year - THAI_BUDDHIST_ERA_OFFSET;
  }
  return year;
}

export function normalizeDateOnlyIso(
  value: string | null | undefined,
): string | null {
  if (!value) return null;

  const trimmed = String(value).trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return trimmed.slice(0, 10) || null;
  }

  const year = toGregorianYear(Number(match[1]));
  return `${String(year).padStart(4, '0')}-${match[2]}-${match[3]}`;
}

export function normalizeWorkingDate(value: string | null | undefined): string {
  if (!value) return '';

  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 8) {
    return String(value).trim();
  }

  const year = toGregorianYear(Number(digits.slice(0, 4)));
  return `${String(year).padStart(4, '0')}${digits.slice(4)}`;
}

export function workingDateToGregorianIso(workingDate: string): string {
  const normalized = normalizeWorkingDate(workingDate);
  if (normalized.length !== 8) {
    return normalizeDateOnlyIso(workingDate) ?? workingDate;
  }

  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

export function parseGregorianDateOnly(
  value: string | Date | null | undefined,
): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = normalizeDateOnlyIso(value.toISOString().slice(0, 10));
    return iso ? new Date(`${iso}T00:00:00.000Z`) : null;
  }

  const iso = normalizeDateOnlyIso(String(value));
  if (!iso) return null;

  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatGregorianDateOnly(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return normalizeDateOnlyIso(value.toISOString().slice(0, 10));
  }

  return normalizeDateOnlyIso(String(value));
}
