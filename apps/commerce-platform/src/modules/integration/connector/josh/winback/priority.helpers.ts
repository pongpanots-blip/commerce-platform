// apps/backend/src/app/winback/priority.helpers.ts
import { WinbackHealth } from './winback.enums';
import { WINBACK_ELIGIBLE_LOOKBACK_DAYS } from './reorder-baseline.helpers';

/**
 * One comparable 0-100 score across signal types, so a "customer about to
 * churn" and a "customer already gone" can sit in the same worklist and be
 * ranked against each other.
 *
 * Deliberately a pure function, not a stored column: with a few thousand
 * accounts this is cheap to compute per request, and nothing has to be kept in
 * sync. Persist it only when the cost shows up in a real measurement.
 */
export const PRIORITY_WEIGHTS = {
  /** How much money is on the table. */
  businessValue: 40,
  /** How overdue they are — why *now*. */
  urgency: 25,
  /** How likely we are to actually get them back. */
  probability: 20,
  /** Whether the rep can do anything today. */
  actionability: 15,
} as const;

/** Above this many cycles overdue, more lateness no longer means more urgent. */
const URGENCY_SATURATION_RATIO = 6;
/** Without a baseline, urgency ramps over a year of silence instead. */
const URGENCY_SATURATION_DAYS = 365;
/** A customer who reordered roughly monthly is treated as a strong habit. */
const HABIT_INTERVAL_DAYS = 30;
/** Assumed recovery probability when order history is too thin to tell. */
const UNKNOWN_HABIT_SCORE = 0.3;

/**
 * How much a dead-looking relationship discounts the odds of winning it back.
 *
 * Nothing is filtered out — a rep sees every customer and decides. This only
 * moves long-gone shops down the ranking so they do not outrank a customer who
 * bought last month purely on past size.
 */
const STALE_RELATIONSHIP_PENALTY = 0.35;

export interface PriorityInput {
  /** Relationship still looks live. Ranks lower when false, never hidden. */
  winnable?: boolean;
  /**
   * Revenue per month while the customer was ordering. NOT lifetime spend —
   * a cumulative all-time total would rank a long-dead 10-year account above a
   * large active one.
   */
  avg_monthly_revenue: number | null;
  median_reorder_interval_days: number | null;
  delay_ratio: number | null;
  inactive_days: number;
  order_count_365d: number;
  phone: string | null;
  assigned_sales_user_id: string | null;
  health: WinbackHealth | null;
}

/**
 * The revenue that counts as a full business-value score, taken from the pool
 * itself (p90) rather than a hardcoded baht figure, so the scale follows the
 * customer base instead of going stale.
 */
export function revenueReference(monthlyRevenues: (number | null)[]): number {
  const values = monthlyRevenues
    .filter((v): v is number => v != null && v > 0)
    .sort((a, b) => a - b);
  if (!values.length) return 0;
  const idx = Math.min(values.length - 1, Math.floor(values.length * 0.9));
  return values[idx];
}

export function priorityScore(input: PriorityInput, revenueRef: number): number {
  const score =
    PRIORITY_WEIGHTS.businessValue * businessValue(input, revenueRef) +
    PRIORITY_WEIGHTS.urgency * urgency(input) +
    PRIORITY_WEIGHTS.probability * probability(input) +
    PRIORITY_WEIGHTS.actionability * actionability(input);
  return Math.round(clamp01(score / 100) * 100);
}

function businessValue(input: PriorityInput, revenueRef: number): number {
  if (!revenueRef || input.avg_monthly_revenue == null) return 0;
  return clamp01(input.avg_monthly_revenue / revenueRef);
}

function urgency(input: PriorityInput): number {
  if (input.delay_ratio == null) {
    return clamp01(input.inactive_days / URGENCY_SATURATION_DAYS);
  }
  // Ratio 1.0 is "due now" — urgency starts there, not at zero days.
  return clamp01((input.delay_ratio - 1) / (URGENCY_SATURATION_RATIO - 1));
}

/**
 * A customer who used to order every two weeks is far easier to restart than
 * one who ordered twice ever. Frequency is the habit; recency is urgency, and
 * is already paid for above.
 */
function probability(input: PriorityInput): number {
  const median = input.median_reorder_interval_days;
  const habit =
    median == null || median <= 0
      ? UNKNOWN_HABIT_SCORE
      : clamp01(HABIT_INTERVAL_DAYS / median);
  return isStale(input) ? habit * STALE_RELATIONSHIP_PENALTY : habit;
}

/** `winnable` when the caller computed it, otherwise fall back to the raw days. */
function isStale(input: PriorityInput): boolean {
  if (input.winnable != null) return !input.winnable;
  return input.inactive_days > WINBACK_ELIGIBLE_LOOKBACK_DAYS;
}

function actionability(input: PriorityInput): number {
  return (input.phone ? 0.6 : 0) + (input.assigned_sales_user_id ? 0.4 : 0);
}

/**
 * WHY NOW, in the rep's language, ordered by weight. A bare score of 96 gets
 * ignored; the reasons are what makes it worth acting on.
 */
export function priorityReasons(input: PriorityInput): string[] {
  const reasons: string[] = [];

  if (input.inactive_days > 0) {
    reasons.push(`ไม่ได้สั่ง ${Math.round(input.inactive_days)} วัน`);
  }
  if (input.median_reorder_interval_days != null && input.delay_ratio != null) {
    reasons.push(
      `ปกติสั่งทุก ${Math.round(input.median_reorder_interval_days)} วัน ` +
        `(ช้ากว่าปกติ ${input.delay_ratio.toFixed(1)} เท่า)`,
    );
  }
  if (input.avg_monthly_revenue != null && input.avg_monthly_revenue > 0) {
    reasons.push(`ยอดเดิม ${formatBaht(input.avg_monthly_revenue)}/เดือน`);
  }
  if (isStale(input)) {
    // Said plainly rather than hidden: the rep may know something we do not.
    reasons.push(
      `เงียบมาเกิน ${Math.floor(WINBACK_ELIGIBLE_LOOKBACK_DAYS / 365)} ปี — โอกาสกลับมาต่ำ`,
    );
  }
  if (!input.phone) {
    reasons.push('ไม่มีเบอร์ติดต่อ — ต้องเข้าไปหน้าร้าน');
  }
  return reasons;
}

export type RecommendedAction = 'call' | 'visit';

/**
 * Deterministic on purpose. A rule the rep can predict beats a model they
 * cannot argue with — and there is no outcome data yet to train one on.
 */
export function recommendedAction(input: PriorityInput): RecommendedAction {
  return input.phone ? 'call' : 'visit';
}

/** `WATCH` is at-risk (prevent), `DORMANT` is already gone (reactivate). */
export function signalType(health: WinbackHealth | null): 'prevent' | 'reactivate' | null {
  if (health === WinbackHealth.WATCH) return 'prevent';
  if (health === WinbackHealth.DORMANT) return 'reactivate';
  return null;
}

function formatBaht(value: number): string {
  if (value >= 1_000_000) return `฿${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `฿${Math.round(value / 1_000)}K`;
  return `฿${Math.round(value)}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
