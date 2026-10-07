/**
 * Compiles a legacy (non-`definition`) `UserSegment` rule into a single
 * parameterized SQL WHERE clause, so `resolveUserIdsForSegment` can run one
 * query against `SEGMENT_BASE_FROM` (aliases `u`, `m`, `t`, `cy` — see
 * `user-segment.service.ts`) instead of loading every user and re-running
 * `matchesRule` per row.
 *
 * Must stay in lockstep with `UserSegmentService.matchesRule` (same
 * semantics for an existing, logged-in user — every row this WHERE runs
 * against already is one). Documented differences:
 * - `within_days` here scans every order in the window, where `matchesRule`'s
 *   `loadOrderStats` only had the latest 200 orders to look at — the SQL
 *   version is strictly more correct.
 * - `days`/`within_days` are clamped to 100 years (`clampDays`) to avoid a
 *   Postgres timestamp-range overflow on an extreme value; the old per-user
 *   JS comparison had no such limit but produced the same practical result.
 *
 * Injection safety: every user-supplied value (from `rule_config`) is pushed
 * onto `params` and referenced only via a `$n` placeholder, never
 * string-concatenated. `ACTIVE_ORDER_STATUSES` is a fixed backend enum list
 * (not request-derived), inlined the same way `loadOrderStats` already
 * inlines it.
 */

// Ported from josh app/user-segment/legacy-rule.compiler.ts (origin/main f730d62d); only change: josh's `orders`
// is commerce's copy `josh_orders` (order.snapshot) — same columns user_id / status / create_date / total_price.
import { UserSegmentRuleType } from './rule-type.enum';
import { JOSH_ACTIVE_ORDER_STATUSES as ACTIVE_ORDER_STATUSES } from '../customers/customer-metrics.service';

export type CompiledLegacyRule = { where: string; params: unknown[] };

const ACTIVE_STATUSES_SQL = ACTIVE_ORDER_STATUSES.map((s) => `'${s}'`).join(
  ', ',
);

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

export function readNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ponytail: a day count in the millions makes `now() - (n * interval '1 day')`
// overflow Postgres's timestamp range ("timestamp out of range"), where the
// old per-user JS comparison just always evaluated true for a cutoff that far
// back. 36500 (100 years) is already far beyond any real order history, so
// clamping here reproduces the same practical result without the overflow.
const MAX_DAYS = 36500;
function clampDays(days: number): number {
  const sign = days < 0 ? -1 : 1;
  return sign * Math.min(Math.abs(days), MAX_DAYS);
}

/** Unparseable date strings are ignored (old JS `NaN` comparison never excluded anyone). */
function readValidDate(value: unknown): Date | null {
  // Falsy (0, '', false, null, undefined) -> no bound, mirrors matchesRule's
  // own `config.from ? new Date(...) : null` (a falsy `from`/`to` was never
  // parsed at all, not even attempted).
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function compileLegacyRule(
  ruleType: UserSegmentRuleType,
  ruleConfig: Record<string, unknown> | null | undefined,
): CompiledLegacyRule {
  const config = ruleConfig ?? {};
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const withinDaysClause = (withinDays: number | null): string => {
    if (withinDays == null) return '';
    return ` AND o.create_date >= now() - (${bind(clampDays(withinDays))}::float8 * interval '1 day')`;
  };

  switch (ruleType) {
    case UserSegmentRuleType.GUEST:
    case UserSegmentRuleType.FIRST_VISIT:
      // guest: every row here is an existing (logged-in) user, so none match.
      // first_visit: device-level signal, no per-user column to bulk-match on.
      return { where: 'FALSE', params };

    case UserSegmentRuleType.MEMBER:
      return { where: 'TRUE', params };

    case UserSegmentRuleType.STAFF:
      return { where: `u.role = ${bind('staff')}`, params };

    case UserSegmentRuleType.ROLE: {
      const roles = readStringArray(config.roles);
      if (roles.length === 0) return { where: 'FALSE', params };
      // u.role is varchar, so ANY(text[]) needs no cast to avoid a type
      // error the way the uuid columns above did — kept explicit anyway so
      // this doesn't silently rely on Postgres's unknown-param inference.
      return { where: `u.role = ANY(${bind(roles)}::text[])`, params };
    }

    case UserSegmentRuleType.CUSTYPE: {
      const custypes = readStringArray(config.custypes);
      if (custypes.length === 0) return { where: 'FALSE', params };
      return { where: `u.custype = ANY(${bind(custypes)}::text[])`, params };
    }

    case UserSegmentRuleType.HAS_COMPANY:
      return { where: '(u.company_id IS NOT NULL)', params };

    case UserSegmentRuleType.MIN_ORDER_COUNT: {
      const min = readNumber(config.min, 1);
      const withinDays = readOptionalNumber(config.within_days);
      // COUNT(*) is bigint; comparing it to an unqualified param makes
      // Postgres infer the param itself as bigint, so a fractional `min`
      // (e.g. 1.5, reachable from the admin form) fails to bind at all
      // ("invalid input syntax for type bigint"). Cast the bound value to
      // float8 instead — bigint promotes to float8 for the comparison, same
      // as the old JS `orderStats.orderCount >= min` did with any number.
      const where =
        `(SELECT COUNT(*) FROM josh_orders o WHERE o.user_id = u.id ` +
        `AND o.status IN (${ACTIVE_STATUSES_SQL})${withinDaysClause(withinDays)}) >= ${bind(min)}::float8`;
      return { where, params };
    }

    case UserSegmentRuleType.NO_ORDER_DAYS: {
      const days = readNumber(config.days, 30);
      const where =
        `NOT EXISTS (SELECT 1 FROM josh_orders o WHERE o.user_id = u.id ` +
        `AND o.status IN (${ACTIVE_STATUSES_SQL}) ` +
        `AND o.create_date >= now() - (${bind(clampDays(days))}::float8 * interval '1 day'))`;
      return { where, params };
    }

    case UserSegmentRuleType.MIN_ORDER_VALUE: {
      const minValue = readNumber(config.min_value, 0);
      const withinDays = readOptionalNumber(config.within_days);
      const where =
        `(SELECT COALESCE(SUM(o.total_price),0) FROM josh_orders o WHERE o.user_id = u.id ` +
        `AND o.status IN (${ACTIVE_STATUSES_SQL})${withinDaysClause(withinDays)}) >= ${bind(minValue)}::float8`;
      return { where, params };
    }

    case UserSegmentRuleType.MAX_ORDER_VALUE: {
      const maxValue = readNumber(config.max_value, 0);
      const withinDays = readOptionalNumber(config.within_days);
      const where =
        `(SELECT COALESCE(SUM(o.total_price),0) FROM josh_orders o WHERE o.user_id = u.id ` +
        `AND o.status IN (${ACTIVE_STATUSES_SQL})${withinDaysClause(withinDays)}) < ${bind(maxValue)}::float8`;
      return { where, params };
    }

    case UserSegmentRuleType.CUISINE: {
      // Compared as text, not uuid: `matchesRule` does a plain JS string
      // `.includes()` against `context.cuisineId`/`cuisineParentId` — no
      // uuid parsing, no case folding. `cy.id::text = ANY($n::text[])`
      // reproduces that exactly (including "no match" rather than a 500 for
      // a non-uuid-looking element, and case-sensitive matching consistent
      // with matchesRule instead of Postgres's case-insensitive uuid input).
      const cuisineIds = readStringArray(config.cuisine_ids);
      const parentIds = readStringArray(config.parent_ids);
      if (cuisineIds.length === 0 && parentIds.length === 0) {
        return { where: 'FALSE', params };
      }
      const cuisineClause = cuisineIds.length
        ? `cy.id::text = ANY(${bind(cuisineIds)}::text[])`
        : 'FALSE';
      const parentClause = parentIds.length
        ? `cy.parent_id::text = ANY(${bind(parentIds)}::text[])`
        : 'FALSE';
      return { where: `(${cuisineClause} OR ${parentClause})`, params };
    }

    case UserSegmentRuleType.CUISINE_PARENT: {
      const parentIds = readStringArray(config.parent_ids);
      if (parentIds.length === 0) return { where: 'FALSE', params };
      return {
        where: `cy.parent_id::text = ANY(${bind(parentIds)}::text[])`,
        params,
      };
    }

    case UserSegmentRuleType.REGISTERED_BETWEEN: {
      const from = readValidDate(config.from);
      const to = readValidDate(config.to);
      const clauses: string[] = [];
      if (from) clauses.push(`u.created_at >= ${bind(from)}`);
      if (to) clauses.push(`u.created_at <= ${bind(to)}`);
      if (clauses.length === 0) return { where: 'TRUE', params };
      return { where: `(${clauses.join(' AND ')})`, params };
    }

    case UserSegmentRuleType.MANUAL_USER_LIST:
      // Handled separately by `filterExistingUserIds` in
      // `resolveUserIdsForSegment` — never routed through this compiler.
      return { where: 'FALSE', params };

    default:
      return { where: 'FALSE', params };
  }
}
