// apps/backend/src/app/winback/worklist.helpers.ts
import { WinbackAccount } from './entities/winback-account.entity';
import { WinbackHealth } from './winback.enums';
import { WINBACK_ELIGIBLE_LOOKBACK_DAYS } from './reorder-baseline.helpers';
import {
  PriorityInput,
  priorityReasons,
  priorityScore,
  recommendedAction,
  revenueReference,
  signalType,
  RecommendedAction,
} from './priority.helpers';

/**
 * A rep can work ~10-15 accounts a day. Showing 200 alerts is the same as
 * showing none: the ranking stops meaning anything and everything gets skipped.
 * The rest stay in the pool, which is browsable on its own screen.
 */
export const WORKLIST_DAILY_CAP = 12;

/** snake_case throughout, matching every other field in this module. */
export interface WorklistItem {
  id: string;
  customer_code: string;
  display_name: string | null;
  signal_type: 'reactivate' | 'prevent';
  priority: number;
  reasons: string[];
  recommended_action: RecommendedAction;
  last_order_at: Date | null;
  inactive_days: number;
  delay_ratio: number | null;
  median_reorder_interval_days: number | null;
  avg_monthly_revenue: number | null;
  /** False = quiet for over two years. A hint for the rep, not a filter. */
  winnable: boolean;
  /** Territory, for planning a day on the road. NULL when the ERP never said. */
  province: string | null;
}

/**
 * Rank at-risk and dormant accounts into one list, highest priority first.
 *
 * The revenue scale is derived from the candidates themselves, so a rep working
 * small shops is not permanently scored against the national top accounts.
 */
export function buildWorklist(
  accounts: WinbackAccount[],
  cap: number = WORKLIST_DAILY_CAP,
): WorklistItem[] {
  const inputs = accounts.map((account) => ({ account, input: toPriorityInput(account) }));
  const ref = revenueReference(inputs.map(({ input }) => input.avg_monthly_revenue));

  return inputs
    .flatMap(({ account, input }) => {
      const type = signalType(input.health);
      if (!type) return [];
      return [
        {
          id: account.id,
          customer_code: account.customer_code,
          display_name: account.display_name,
          signal_type: type,
          priority: priorityScore(input, ref),
          reasons: priorityReasons(input),
          recommended_action: recommendedAction(input),
          last_order_at: account.last_order_at,
          inactive_days: input.inactive_days,
          delay_ratio: input.delay_ratio,
          median_reorder_interval_days: input.median_reorder_interval_days,
          avg_monthly_revenue: input.avg_monthly_revenue,
          winnable: input.winnable ?? true,
          province: account.province,
        },
      ];
    })
    .sort((a, b) => b.priority - a.priority || b.inactive_days - a.inactive_days)
    .slice(0, cap);
}

/**
 * Postgres `numeric` arrives as a string through the driver. Coercing here,
 * once, keeps every consumer from re-discovering that `delay_ratio > 3` is a
 * string comparison.
 */
function toPriorityInput(account: WinbackAccount): PriorityInput {
  return {
    avg_monthly_revenue: toNumber(account.avg_monthly_revenue),
    median_reorder_interval_days: toNumber(account.median_reorder_interval_days),
    delay_ratio: toNumber(account.delay_ratio),
    inactive_days: Number(account.inactive_days) || 0,
    order_count_365d: Number(account.order_count_365d) || 0,
    phone: account.phone,
    assigned_sales_user_id: account.assigned_sales_user_id,
    health: (account.health as WinbackHealth) ?? null,
    winnable: (Number(account.inactive_days) || 0) <= WINBACK_ELIGIBLE_LOOKBACK_DAYS,
  };
}

function toNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
