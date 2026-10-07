/**
 * Segment field registry (Task 4 of the SEGMENTS/TIERS plan).
 *
 * Declares the fields that the segment builder UI (admin) and the segment
 * SQL compiler (Task 5) can reference when building a condition tree. Each
 * `FieldDef.sqlExpr` is a raw SQL fragment intended to be spliced into a
 * base query of the shape:
 *
 *   FROM users u
 *   LEFT JOIN customer_metrics m ON m.user_id = u.id
 *   LEFT JOIN membership_tiers t ON t.id = COALESCE(m.tier_id, <entry-tier fallback>)
 *
 * Do not add a new field here without also confirming the compiler (Task 5)
 * supports its `valueType`/`operators` combination, and that any extra join
 * it depends on (see `cuisine` below) is wired into the base query.
 */

export type Operator = '<' | '<=' | '>' | '>=' | '=' | '!=' | 'between' | 'in';

export type FieldDef = {
  key: string;
  label: string;
  valueType: 'number' | 'string' | 'date' | 'enum';
  operators: Operator[];
  sqlExpr: string;
  optionsSource?: string;
};

const NUMERIC_OPERATORS: Operator[] = ['<', '<=', '>', '>=', '=', '!=', 'between'];
const EQUALITY_OPERATORS: Operator[] = ['=', '!=', 'in'];

export const SEGMENT_FIELDS: Record<string, FieldDef> = {
  lifetime_spend: {
    key: 'lifetime_spend',
    label: 'Lifetime spend',
    valueType: 'number',
    operators: NUMERIC_OPERATORS,
    sqlExpr: 'COALESCE(m.lifetime_spend,0)',
  },
  lifetime_order_count: {
    key: 'lifetime_order_count',
    label: 'Lifetime order count',
    valueType: 'number',
    operators: NUMERIC_OPERATORS,
    sqlExpr: 'COALESCE(m.lifetime_order_count,0)',
  },
  avg_order_value: {
    key: 'avg_order_value',
    label: 'Average order value',
    valueType: 'number',
    operators: NUMERIC_OPERATORS,
    sqlExpr: 'COALESCE(m.avg_order_value,0)',
  },
  spend_90d: {
    key: 'spend_90d',
    label: 'Spend (last 90 days)',
    valueType: 'number',
    operators: NUMERIC_OPERATORS,
    sqlExpr: 'COALESCE(m.spend_90d,0)',
  },
  order_count_90d: {
    key: 'order_count_90d',
    label: 'Order count (last 90 days)',
    valueType: 'number',
    operators: NUMERIC_OPERATORS,
    sqlExpr: 'COALESCE(m.order_count_90d,0)',
  },
  last_order_days_ago: {
    key: 'last_order_days_ago',
    label: 'Days since last order',
    valueType: 'number',
    operators: NUMERIC_OPERATORS,
    // A user who has never ordered has m.last_order_at IS NULL; the EXTRACT
    // then evaluates to NULL, and COALESCE maps that to 999999 so "never
    // ordered" sorts/filters as "extremely long ago" rather than being
    // dropped from numeric comparisons.
    sqlExpr: 'COALESCE(EXTRACT(DAY FROM now() - m.last_order_at), 999999)',
  },
  registered_days_ago: {
    key: 'registered_days_ago',
    label: 'Days since registration',
    valueType: 'number',
    operators: NUMERIC_OPERATORS,
    sqlExpr: 'COALESCE(EXTRACT(DAY FROM now() - u.created_at), 999999)',
  },
  tier: {
    key: 'tier',
    label: 'Membership tier',
    valueType: 'enum',
    operators: EQUALITY_OPERATORS,
    sqlExpr: 't.slug',
    optionsSource: 'tiers',
  },
  custype: {
    key: 'custype',
    label: 'Customer type',
    valueType: 'string',
    operators: EQUALITY_OPERATORS,
    sqlExpr: 'u.custype',
  },
  role: {
    key: 'role',
    label: 'Role',
    valueType: 'string',
    operators: EQUALITY_OPERATORS,
    sqlExpr: 'u.role',
  },
  // Modeled as 'enum' rather than a dedicated boolean valueType: the field
  // registry only has four valueTypes (number/string/date/enum), and the
  // compiler/admin builder treat 'enum' as "compare against a fixed set of
  // known values". For `has_company` that fixed set is the two-element
  // {true, false}. Only '=' is exposed since '!=' is redundant with '=' on
  // a two-valued field, and 'in'/'between' don't apply to a boolean.
  has_company: {
    key: 'has_company',
    label: 'Has company',
    valueType: 'enum',
    operators: ['='],
    sqlExpr: '(u.company_id IS NOT NULL)',
  },
  // Wired in Task 6: `UserSegmentService`'s base query now joins the user's
  // (first-created) shop's cuisine via:
  //   LEFT JOIN LATERAL (
  //     SELECT s.cuisine_id FROM shop s WHERE s.company_id = u.company_id
  //     ORDER BY s.created_at ASC LIMIT 1
  //   ) shop_cuisine ON true
  //   LEFT JOIN cuisine cy ON cy.id = shop_cuisine.cuisine_id
  // The `cuisine` table has no `slug` column (columns: id, parent_id,
  // cuisine_name, level, is_active, created_at, updated_at) — `cy.cuisine_name`
  // is the closest identifying/display column, so it's used here instead of
  // the originally-assumed `cy.slug`.
  //
  // Only a shop's `level = 2` (leaf) cuisine is ever assigned, so `cuisine`'s
  // options (`getFields`) are restricted to level-2 names — a level 0/1 name
  // (e.g. "Thai" the root/group) always matches 0 rows against
  // `cy.cuisine_name`, and several names repeat verbatim across levels
  // (audit: "Hotel" at level 0/1/2). Existing saved definitions using
  // `cuisine` with a name keep working unchanged.
  cuisine: {
    key: 'cuisine',
    label: 'Cuisine',
    valueType: 'enum',
    operators: EQUALITY_OPERATORS,
    sqlExpr: 'cy.cuisine_name',
    optionsSource: 'cuisine',
  },
  // Groups leaf cuisines by their level-1 parent (the same "group" the
  // legacy `cuisine_parent` rule_type and `matchesRule`'s CUISINE case match
  // against, via `context.cuisineParentId` = the leaf cuisine's `parent_id`).
  // `cuisine` (above) can't express "any Thai restaurant" — only an exact
  // leaf name — so this field lets the builder pick the group directly.
  // `::text` cast means a malformed value just matches 0 rows instead of
  // throwing (parent_id is a uuid column).
  cuisine_group: {
    key: 'cuisine_group',
    label: 'Cuisine group',
    valueType: 'enum',
    operators: EQUALITY_OPERATORS,
    sqlExpr: 'cy.parent_id::text',
    optionsSource: 'cuisine_group',
  },
  manual_user_ids: {
    key: 'manual_user_ids',
    label: 'Specific users',
    valueType: 'string',
    operators: ['in'],
    sqlExpr: 'u.id',
  },
};

export function getField(key: string): FieldDef {
  // Own-property check (not `SEGMENT_FIELDS[key]` + truthiness): a key like
  // "__proto__"/"constructor"/"toString" would otherwise resolve to an
  // Object.prototype member and be treated as a valid field.
  if (!Object.prototype.hasOwnProperty.call(SEGMENT_FIELDS, key)) {
    throw new Error('Unknown segment field: ' + key);
  }
  return SEGMENT_FIELDS[key];
}
