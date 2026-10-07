import { UserSegmentRuleType } from './rule-type.enum';

/*
 * The pieces of josh app/user-segment/user-segment.service.ts the compilers need, over commerce's copies
 * (stage 2a). Same aliases as josh's SEGMENT_BASE_FROM — u (the customer), m (metrics), t (tier), cy (cuisine) —
 * so josh's segment-fields.ts and both compilers run unchanged:
 * - u = segment_customers (customer.snapshot copy; PDPA-deleted excluded). Customers only: a segment that can only
 *   match staff (STAFF / ROLE with internal roles) is live and matched in josh, never frozen here.
 * - t / cy come from the snapshot's tier_slug / cuisine_* — josh computes them with its own entry-tier fallback
 *   and first-shop rule (CommerceSnapshotBuilder).
 */
export const SEGMENT_BASE_FROM = `
  FROM segment_customers u
  LEFT JOIN customer_metrics m ON m.user_id = u.id
  LEFT JOIN LATERAL (SELECT u.tier_slug AS slug) t ON true
  LEFT JOIN LATERAL (SELECT u.cuisine_name AS cuisine_name, u.cuisine_parent_id AS parent_id) cy ON true`;

/** Rule types matched live per request in josh (never frozen) — josh's LIVE_RULE_TYPES. */
export const LIVE_RULE_TYPES: string[] = [
  UserSegmentRuleType.GUEST, UserSegmentRuleType.FIRST_VISIT, UserSegmentRuleType.MEMBER, UserSegmentRuleType.STAFF,
  UserSegmentRuleType.ROLE, UserSegmentRuleType.CUSTYPE, UserSegmentRuleType.HAS_COMPANY,
];

export const isLiveSegment = (s: { definition: unknown; rule_type: string }) => !s.definition && LIVE_RULE_TYPES.includes(s.rule_type);
export const isDeviceLevelSegment = (s: { definition: unknown; rule_type: string }) =>
  !s.definition && (s.rule_type === UserSegmentRuleType.GUEST || s.rule_type === UserSegmentRuleType.FIRST_VISIT);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID_RE.test(value);
