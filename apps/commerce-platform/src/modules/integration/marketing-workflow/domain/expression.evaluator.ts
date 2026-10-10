// Copied from josh origin/main 00030d02b apps/backend/src/app/marketing-workflow/marketing-expression.evaluator.ts — keep in sync by hand (phase 3 retires josh's copy).
import { ExpressionNode, MarketingExpressionField } from './expression.parser';

/**
 * Fully-resolved values for every whitelisted field, plus an async segment
 * membership lookup. Built by `MarketingConditionContextService` from
 * live data (cart snapshot, orders, customer metrics, segments) — this
 * module only ever consumes already-resolved values, it never touches the
 * database itself.
 */
export interface MarketingExpressionContext {
  cartStillOpen: boolean;
  cartItemCount: number;
  cartTotal: number;
  stillNoOrder: boolean;
  userOrderCount: number;
  /** Whether `now` falls inside the workflow's `schedule` (always `true` when unset). */
  timeInSchedule: boolean;
  /** Local hour-of-day (0-23) in the workflow schedule's timezone (default Asia/Bangkok). */
  timeHour: number;
  /** Local day-of-week (0 = Sunday .. 6 = Saturday) in the workflow schedule's timezone. */
  timeDow: number;
  /** Matching page views within the `page_affinity` trigger's window; `0` for other trigger types. */
  pageViews: number;
  /** `segment.in == "<uuid>"` resolves to whether the user is a member of that segment. */
  segmentMatches: (segmentId: string) => Promise<boolean>;
}

function resolveField(
  field: Exclude<MarketingExpressionField, 'segment.in'>,
  context: MarketingExpressionContext,
): boolean | number {
  switch (field) {
    case 'cart.still_open':
      return context.cartStillOpen;
    case 'cart.item_count':
      return context.cartItemCount;
    case 'cart.total':
      return context.cartTotal;
    case 'still_no_order':
      return context.stillNoOrder;
    case 'user.order_count':
      return context.userOrderCount;
    case 'time.in_schedule':
      return context.timeInSchedule;
    case 'time.hour':
      return context.timeHour;
    case 'time.dow':
      return context.timeDow;
    case 'page.views':
      return context.pageViews;
  }
}

function compare(
  actual: boolean | number,
  op: '==' | '!=' | '>' | '>=' | '<' | '<=',
  expected: boolean | number,
): boolean {
  switch (op) {
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>':
      return (actual as number) > (expected as number);
    case '>=':
      return (actual as number) >= (expected as number);
    case '<':
      return (actual as number) < (expected as number);
    case '<=':
      return (actual as number) <= (expected as number);
  }
}

/**
 * Evaluates a parsed expression AST against a fully-resolved context.
 * Pure interpreter over the whitelist AST — no `eval` / dynamic code
 * execution, no property access beyond the fields already resolved onto
 * `context`.
 */
export async function evaluateMarketingExpression(
  node: ExpressionNode,
  context: MarketingExpressionContext,
): Promise<boolean> {
  switch (node.type) {
    case 'and': {
      const left = await evaluateMarketingExpression(node.left, context);
      if (!left) return false;
      return evaluateMarketingExpression(node.right, context);
    }
    case 'or': {
      const left = await evaluateMarketingExpression(node.left, context);
      if (left) return true;
      return evaluateMarketingExpression(node.right, context);
    }
    case 'comparison': {
      if (node.field === 'segment.in') {
        const matched = await context.segmentMatches(node.value.value as string);
        return node.op === '==' ? matched : !matched;
      }
      const actual = resolveField(node.field, context);
      return compare(actual, node.op, node.value.value as boolean | number);
    }
  }
}
