export const PIPELINE_CONVERSION_STAGES: string[] = [
  'prospect',
  'contacted',
  'appointment',
  'negotiate',
  'signed',
];

function roundRate(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function activityTime(a: { activity_at: Date | string }): number {
  return new Date(a.activity_at).getTime();
}

function compareActivities<T extends { id: string; activity_at: Date | string }>(
  a: T,
  b: T,
): number {
  const ta = activityTime(a);
  const tb = activityTime(b);
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

/** 1-based index in a pre-sorted ascending id list, or 0 if missing. */
export function activitySequenceIndex(sortedAscIds: string[], activityId: string): number {
  const idx = sortedAscIds.indexOf(activityId);
  return idx === -1 ? 0 : idx + 1;
}

/** Global per-account visit/activity sequence N (1-based), ordered by time then id. */
export function assignAccountSequences(
  acts: { id: string; account_id: string; activity_at: Date | string }[],
): Map<string, number> {
  const sorted = [...acts].sort(compareActivities);
  const counters = new Map<string, number>();
  const result = new Map<string, number>();

  for (const act of sorted) {
    const n = (counters.get(act.account_id) ?? 0) + 1;
    counters.set(act.account_id, n);
    result.set(act.id, n);
  }

  return result;
}

/** Per-rep-per-day sequence k (1-based), ordered by time then id. */
export function assignDailySequences(
  acts: { id: string; sales_user_id: string; activity_at: Date | string }[],
  dayKey: (d: Date) => string,
): Map<string, number> {
  const sorted = [...acts].sort(compareActivities);
  const counters = new Map<string, number>();
  const result = new Map<string, number>();

  for (const act of sorted) {
    const key = `${act.sales_user_id}:${dayKey(new Date(act.activity_at))}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    result.set(act.id, n);
  }

  return result;
}

export function stageConversion(
  funnelCounts: Record<string, number>,
  orderedStages: string[],
): { from: string; to: string; fromCount: number; toCount: number; rate: number }[] {
  const rows: {
    from: string;
    to: string;
    fromCount: number;
    toCount: number;
    rate: number;
  }[] = [];

  for (let i = 0; i < orderedStages.length - 1; i++) {
    const from = orderedStages[i];
    const to = orderedStages[i + 1];
    const fromCount = funnelCounts[from] ?? 0;
    const toCount = funnelCounts[to] ?? 0;
    rows.push({
      from,
      to,
      fromCount,
      toCount,
      rate: roundRate(toCount, fromCount),
    });
  }

  return rows;
}

export function countByKey(rows: { key: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.key == null) continue;
    counts[row.key] = (counts[row.key] ?? 0) + 1;
  }
  return counts;
}

export function avgVisitMinutes(
  rows: { checkin_at: Date | string | null; checkout_at: Date | string | null }[],
): { avg: number | null; sample: number } {
  const MINUTE = 1000 * 60;
  const gaps: number[] = [];

  for (const row of rows) {
    if (!row.checkin_at || !row.checkout_at) continue;
    const start = new Date(row.checkin_at).getTime();
    const end = new Date(row.checkout_at).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    gaps.push((end - start) / MINUTE);
  }

  if (gaps.length === 0) return { avg: null, sample: 0 };
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return { avg: Math.round(avg * 10) / 10, sample: gaps.length };
}

export function gpsVisitRate(
  rows: { lat: number | null; lng: number | null }[],
): { withGps: number; total: number; rate: number } {
  const total = rows.length;
  const withGps = rows.filter((r) => r.lat != null && r.lng != null).length;
  return { withGps, total, rate: roundRate(withGps, total) };
}

function startOfIsoWeek(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfIsoWeek(d: Date): Date {
  const start = startOfIsoWeek(d);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  // ISO week-year is the calendar year of the week's Thursday.
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const isoYear = date.getUTCFullYear();
  // ISO week 1 is the week containing January 4.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  week1Monday.setUTCHours(0, 0, 0, 0);
  const monday = startOfIsoWeek(d);
  const weekNum =
    Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

/** Split [from, to] into ISO week buckets with start/end clamped to the range. */
export function weekBuckets(
  from: Date,
  to: Date,
): { key: string; start: Date; end: Date }[] {
  if (to < from) return [];

  const buckets: { key: string; start: Date; end: Date }[] = [];
  let weekStart = startOfIsoWeek(from);

  while (weekStart <= to) {
    const weekEnd = endOfIsoWeek(weekStart);
    const start = weekStart < from ? new Date(from) : new Date(weekStart);
    const end = weekEnd > to ? new Date(to) : new Date(weekEnd);

    buckets.push({
      key: isoWeekKey(weekStart),
      start,
      end,
    });

    const next = new Date(weekStart);
    next.setUTCDate(next.getUTCDate() + 7);
    weekStart = next;
  }

  return buckets;
}

/**
 * Share of a dormant customer's revenue we can realistically expect back.
 *
 * ponytail: a flat guess, not a model — there is no outcome history to fit one
 * on yet. It is named and exported so the number in the response is traceable
 * to an assumption rather than looking like a measurement. Replace it with a
 * fitted rate once `reactivated_at` has enough history.
 */
export const ASSUMED_RECOVERY_PROBABILITY = 0.55;

export interface RevenueRiskAccount {
  health: string;
  /**
   * Revenue per month while the customer was ordering. NOT lifetime spend:
   * summing all-time totals would report a decade of revenue as monthly and
   * inflate revenue-at-risk by an order of magnitude.
   */
  avg_monthly_revenue: number | string | null;
}

/**
 * Monthly revenue currently exposed, split by how far gone the customer is.
 *
 * `revenue_at_risk` is still winnable by a phone call this week; `recoverable_
 * revenue` is already lost and discounted by the probability of getting it back.
 * They are deliberately not summed — one is a warning, the other is an estimate.
 */
export function revenueRisk(
  accounts: RevenueRiskAccount[],
  recoveryProbability: number = ASSUMED_RECOVERY_PROBABILITY,
): {
  revenue_at_risk: number;
  dormant_monthly_revenue: number;
  recoverable_revenue: number;
  recovery_probability: number;
} {
  let atRisk = 0;
  let dormant = 0;

  for (const account of accounts) {
    const monthly = Number(account.avg_monthly_revenue);
    if (!Number.isFinite(monthly) || monthly <= 0) continue;
    if (account.health === 'watch') atRisk += monthly;
    else if (account.health === 'dormant') dormant += monthly;
  }

  return {
    revenue_at_risk: round2(atRisk),
    dormant_monthly_revenue: round2(dormant),
    recoverable_revenue: round2(dormant * recoveryProbability),
    recovery_probability: recoveryProbability,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
