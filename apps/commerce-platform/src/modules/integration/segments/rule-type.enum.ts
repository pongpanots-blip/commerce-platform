export enum UserSegmentRuleType {
  GUEST = 'guest',
  MEMBER = 'member',
  STAFF = 'staff',
  ROLE = 'role',
  CUSTYPE = 'custype',
  HAS_COMPANY = 'has_company',
  MIN_ORDER_COUNT = 'min_order_count',
  NO_ORDER_DAYS = 'no_order_days',
  MIN_ORDER_VALUE = 'min_order_value',
  MAX_ORDER_VALUE = 'max_order_value',
  CUISINE = 'cuisine',
  CUISINE_PARENT = 'cuisine_parent',
  REGISTERED_BETWEEN = 'registered_between',
  MANUAL_USER_LIST = 'manual_user_list',
  /**
   * Device-level: the visitor's device saw its first page view within
   * `rule_config.withinHours` (default 24) — matchable only on flows that
   * carry an `individual_id` (e.g. `/user-segments/resolve` for banner
   * targeting); guests can match.
   */
  FIRST_VISIT = 'first_visit',
}

export const USER_SEGMENT_RULE_TYPE_VALUES = Object.values(
  UserSegmentRuleType,
) as UserSegmentRuleType[];
