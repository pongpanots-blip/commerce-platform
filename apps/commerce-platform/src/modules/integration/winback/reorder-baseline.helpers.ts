// apps/backend/src/app/winback/reorder-baseline.helpers.ts
import { WinbackHealth } from './winback.enums';
import { computeInactiveDays, normalizeCustomerCode } from './winback.helpers';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DAYS_PER_MONTH = 30;

/**
 * Dormancy used to be one fixed threshold for everybody (180 days). It is now
 * relative to how often each customer actually orders: a shop that reorders
 * every 14 days and has been silent for 60 is in trouble long before day 180,
 * while a shop that orders quarterly is not.
 *
 * Thresholds are ratios of the customer's own median reorder interval.
 *
 * ponytail: 1.5 / 3.0 are the spec's numbers, NOT numbers derived from Josh's
 * own data. Measure the delay_ratio distribution on a real snapshot before
 * these go anywhere near prod, and move them into config once measured.
 */
export const WINBACK_AT_RISK_DELAY_RATIO = 1.5;
export const WINBACK_DORMANT_DELAY_RATIO = 3;

/**
 * Fallback for accounts with no usable baseline (fewer than two orders even in
 * the extended window). Without a baseline there is nothing to be relative to,
 * so the old fixed threshold is the only thing left.
 */
export const WINBACK_INACTIVE_THRESHOLD_DAYS = 180;

/**
 * Baseline lookback is adaptive: use the primary window, and only widen to the
 * extended one for customers too infrequent to produce two orders in it. A shop
 * ordering every 60 days yields ~6 intervals in a year — thin but usable; one
 * ordering quarterly yields 4 and needs the wider window.
 */
export const WINBACK_BASELINE_PRIMARY_DAYS = 365;
export const WINBACK_BASELINE_EXTENDED_DAYS = 730;

/**
 * How recently a customer must have bought for the relationship to count as
 * still alive.
 *
 * This is **advice, not a filter**. Everyone is scored and everyone is shown;
 * the rep decides. A customer who last bought three years ago is a long shot,
 * and the worklist says so in words — but a rep who knows that shop personally
 * is better placed to judge that than a threshold is.
 *
 * Same number as the extended baseline window today, but a different question
 * ("is this still a live relationship" vs "how far back do we read to find a
 * cycle"), so they are separate constants on purpose.
 */
export const WINBACK_ELIGIBLE_LOOKBACK_DAYS = 730;

/** Whether the relationship still looks live. Informational — nothing is excluded. */
export function isWinnable(
  lastOrderAt: Date | null,
  now: Date,
  lookbackDays: number = WINBACK_ELIGIBLE_LOOKBACK_DAYS,
): boolean {
  if (!lastOrderAt) return false;
  return computeInactiveDays(lastOrderAt, now) <= lookbackDays;
}

/**
 * Median gap, in days, between consecutive orders.
 *
 * Returns NULL — never 0 — when fewer than two orders exist: "we cannot tell"
 * and "orders constantly" must stay distinguishable, because every consumer
 * treats them differently.
 */
export function medianReorderIntervalDays(orderDates: Date[]): number | null {
  const times = orderDates
    .map((d) => d.getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length < 2) return null;

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push((times[i] - times[i - 1]) / MS_PER_DAY);
  }
  gaps.sort((a, b) => a - b);

  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
}

/**
 * How overdue this customer is, as a multiple of their own normal cycle.
 * 1.0 = due now, 2.5 = two and a half cycles late.
 *
 * NULL when there is no baseline to compare against, or when the baseline is 0
 * (several orders on the same day — a real pattern for daily-delivery accounts,
 * and not something to divide by).
 */
export function delayRatio(
  lastOrderAt: Date | null,
  median: number | null,
  now: Date,
): number | null {
  if (!lastOrderAt || median == null || median <= 0) return null;
  return computeInactiveDays(lastOrderAt, now) / median;
}

/**
 * System-derived revenue state, or NULL when the orders say the customer is
 * simply healthy.
 *
 * NULL rather than an "active" value on purpose: `ACTIVE_AGAIN` means "was
 * dormant, we won them back" — a recorded outcome, not a health reading. If
 * this function returned it, every nightly sync would silently re-stamp
 * reactivation wins onto customers that never left. The caller keeps whatever
 * health the account already has when this returns NULL.
 *
 * `WATCH` is the at-risk band — the enum value already existed and was unused,
 * so no existing consumer of `health` changes meaning.
 */
export function customerState(
  ratio: number | null,
  inactiveDays: number,
  fallbackDormantDays: number = WINBACK_INACTIVE_THRESHOLD_DAYS,
): WinbackHealth.WATCH | WinbackHealth.DORMANT | null {
  if (ratio == null) {
    return inactiveDays >= fallbackDormantDays ? WinbackHealth.DORMANT : null;
  }
  if (ratio >= WINBACK_DORMANT_DELAY_RATIO) return WinbackHealth.DORMANT;
  if (ratio >= WINBACK_AT_RISK_DELAY_RATIO) return WinbackHealth.WATCH;
  return null;
}

export interface OrderRow {
  customer_code: string;
  create_date: Date | string;
  total_price?: number | string | null;
}

/** Latest order per customer, read across ALL history — not the baseline window. */
export interface LastOrderRow {
  customer_code: string;
  last_order_at: Date | string;
  lifetime_spend: number | string | null;
  /** Delivery province on the most recent invoice. */
  province?: string | null;
}

export interface CustomerBaseline {
  customer_code: string;
  /** From full order history. A 400-day-silent customer still has one. */
  last_order_at: Date;
  inactive_days: number;
  median_reorder_interval_days: number | null;
  delay_ratio: number | null;
  /** Orders inside the primary window only. 0 is meaningful: gone all year. */
  order_count_365d: number;
  /**
   * Revenue per month **while the customer was ordering** — window revenue over
   * the span it was earned in, not over the calendar window. This is the number
   * that is at risk; lifetime cumulative spend is not, and must never be used
   * for revenue-at-risk (a 10-year customer would show a 10-year total as a
   * monthly figure).
   *
   * NULL when the span is unknown (a single order, or none in the window).
   */
  avg_monthly_revenue: number | null;
  lifetime_spend_hint: number | null;
  /** Territory, from the latest invoice. NULL when the ERP never said. */
  province: string | null;
  /**
   * Whether the relationship still looks live (bought within
   * `WINBACK_ELIGIBLE_LOOKBACK_DAYS`). Shown to the rep, never used to hide a
   * customer from them.
   */
  winnable: boolean;
  /** NULL = orders say healthy; caller must keep the account's current health. */
  health: WinbackHealth.WATCH | WinbackHealth.DORMANT | null;
}

/**
 * Fold order history into one baseline per customer.
 *
 * Pure on purpose: the previous sync ran one `MAX(create_date)` query per
 * account inside a loop, so this replaces N+1 queries with a single scan that
 * can be tested without a database.
 *
 * @param windowRows orders inside the extended window, used for the baseline
 * @param lastOrders latest order per code across ALL history, used for dormancy
 */
export function buildCustomerBaselines(
  windowRows: OrderRow[],
  lastOrders: LastOrderRow[],
  now: Date,
  opts: {
    primaryDays?: number;
    fallbackDormantDays?: number;
    /**
     * Exclude customers quiet for longer than this. Defaults to 0 — **no cut**:
     * everything is scored and shown, and `winnable` carries the judgement so a
     * rep can make their own call. Set a value only for a caller that genuinely
     * needs a narrowed set.
     */
    eligibleLookbackDays?: number;
  } = {},
): Map<string, CustomerBaseline> {
  const primaryDays = opts.primaryDays ?? WINBACK_BASELINE_PRIMARY_DAYS;
  const primaryCutoff = now.getTime() - primaryDays * MS_PER_DAY;
  const eligibleLookback = opts.eligibleLookbackDays ?? 0;

  const byCode = new Map<string, { date: Date; amount: number }[]>();
  for (const row of windowRows) {
    const code = normalizeCustomerCode(row.customer_code);
    if (!code) continue;
    const date = toDate(row.create_date);
    if (!date) continue;
    const bucket = byCode.get(code) ?? [];
    bucket.push({ date, amount: Number(row.total_price ?? 0) || 0 });
    byCode.set(code, bucket);
  }

  const out = new Map<string, CustomerBaseline>();

  // Driven by lastOrders, not by the window: a customer with no order inside
  // the window is exactly the customer winback exists for.
  for (const row of lastOrders) {
    const code = normalizeCustomerCode(row.customer_code);
    if (!code) continue;
    const lastOrderAt = toDate(row.last_order_at);
    if (!lastOrderAt) continue;
    if (eligibleLookback > 0 && !isWinnable(lastOrderAt, now, eligibleLookback)) continue;

    const all = (byCode.get(code) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());
    const primary = all.filter((o) => o.date.getTime() >= primaryCutoff);
    // Adaptive: widen to the extended window only when the primary one is too thin.
    const baseline = primary.length >= 2 ? primary : all;

    const median = medianReorderIntervalDays(baseline.map((o) => o.date));
    const ratio = delayRatio(lastOrderAt, median, now);
    const inactiveDays = computeInactiveDays(lastOrderAt, now);
    const lifetime = row.lifetime_spend == null ? null : Number(row.lifetime_spend) || 0;

    out.set(code, {
      customer_code: code,
      last_order_at: lastOrderAt,
      inactive_days: inactiveDays,
      median_reorder_interval_days: median,
      delay_ratio: ratio,
      order_count_365d: primary.length,
      avg_monthly_revenue: avgMonthlyRevenue(baseline),
      lifetime_spend_hint: lifetime,
      province: row.province?.trim() || null,
      winnable: isWinnable(lastOrderAt, now),
      health: customerState(ratio, inactiveDays, opts.fallbackDormantDays),
    });
  }

  return out;
}

/**
 * Revenue earned per month over the span it was actually earned in. A customer
 * with ฿360K across 6 months of ordering was a ฿60K/month customer, whether or
 * not they have ordered since.
 */
function avgMonthlyRevenue(orders: { date: Date; amount: number }[]): number | null {
  if (orders.length < 2) return null;
  const spanDays =
    (orders[orders.length - 1].date.getTime() - orders[0].date.getTime()) / MS_PER_DAY;
  const months = Math.max(spanDays / DAYS_PER_MONTH, 1);
  const total = orders.reduce((sum, o) => sum + o.amount, 0);
  return total / months;
}

function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Accounts worth pulling into the winback pool: at-risk or dormant. */
export function needsAttention(
  health: WinbackHealth.WATCH | WinbackHealth.DORMANT | null,
): boolean {
  return health != null;
}
