/** Paid / fulfilled order statuses counted toward GMV. */
export const DASHBOARD_ORDER_STATUSES = [
  'paid',
  'preparing',
  'shipped',
  'delivered',
] as const;

export type CustomerSegment = 'repeat' | 'new' | 'reengage' | 'inactive';

export const REPEAT_STAGES = new Set([
  'ordering_again',
  'reactivated',
  'won',
  'signed',
]);

/** Start of calendar month in local/UTC date math (ISO date boundary). */
export function monthStartUtc(ref: Date = new Date()): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function roundBaht(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pctShare(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Mutually exclusive customer buckets for the sales KPI whiteboard.
 * Priority: new (created this month) → repeat → inactive (60+) → re-engage (30–59 / residual).
 */
export function classifyCustomerSegment(input: {
  inactiveDays: number;
  createDate: Date | string;
  orderCount: number;
  stage?: string | null;
  health?: string | null;
  monthStart: Date;
}): CustomerSegment {
  const created = new Date(input.createDate);
  if (!Number.isNaN(created.getTime()) && created >= input.monthStart) {
    return 'new';
  }
  if (
    input.orderCount >= 2 ||
    input.health === 'active_again' ||
    REPEAT_STAGES.has(input.stage ?? '')
  ) {
    return 'repeat';
  }
  if (input.inactiveDays >= 60) return 'inactive';
  return 'reengage';
}

export function defaultDashboardRange(ref: Date = new Date()): { from: string; to: string } {
  const start = monthStartUtc(ref);
  return { from: start.toISOString(), to: ref.toISOString() };
}
