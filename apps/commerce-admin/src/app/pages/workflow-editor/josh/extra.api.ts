/** Copied from josh libs/shared-api (user-segment, coupon, popup-definition, banner) — only what the workflow editor uses. */
import { apiClient } from './api-client';
import type { CreativeLayoutDesign, PopupTriggerConfig } from './marketing-creative.schema';

export const USER_SEGMENT_RULE_TYPES = [
  'guest',
  'member',
  'staff',
  'role',
  'custype',
  'has_company',
  'min_order_count',
  'no_order_days',
  'min_order_value',
  'max_order_value',
  'cuisine',
  'cuisine_parent',
  'registered_between',
  'manual_user_list',
  'first_visit',
] as const;

export type UserSegmentRuleType = (typeof USER_SEGMENT_RULE_TYPES)[number];

/**
 * Condition-tree types (Task 5/9 of the SEGMENTS/TIERS plan) — mirrors
 * `apps/backend/src/app/user-segment/dto/segment-definition.dto.ts` and
 * `segment-fields.ts`. Drives the visual segment builder (Task 9); never
 * shown to the admin user as raw JSON.
 */
export type SegmentOperator =
  | '<'
  | '<='
  | '>'
  | '>='
  | '='
  | '!='
  | 'between'
  | 'in';

export type SegmentLeafValue =
  | string
  | number
  | boolean
  | Array<string | number>;

export type SegmentLeaf = {
  field: string;
  operator: SegmentOperator;
  value: SegmentLeafValue;
};

export type SegmentBranchOp = 'AND' | 'OR';

export type SegmentBranch = {
  op: SegmentBranchOp;
  children: SegmentDefinition[];
};

export type SegmentDefinition = SegmentLeaf | SegmentBranch;

export function isSegmentBranch(
  def: SegmentDefinition,
): def is SegmentBranch {
  return (
    (def as SegmentBranch).op !== undefined &&
    Array.isArray((def as SegmentBranch).children)
  );
}

export function isSegmentLeaf(def: SegmentDefinition): def is SegmentLeaf {
  return !isSegmentBranch(def);
}

export type SegmentFieldValueType = 'number' | 'string' | 'date' | 'enum';

/** `value`/`label` pair for a builder <select> (tiers, cuisine, ...). */
export type SegmentFieldOption = {
  value: string;
  label: string;
};

/** Serialized `FieldDef` from `GET /user-segments/fields` (omits `sqlExpr`). */
export type SegmentFieldSummary = {
  key: string;
  label: string;
  valueType: SegmentFieldValueType;
  operators: SegmentOperator[];
  optionsSource?: string;
};

export type SegmentFieldsResponse = {
  fields: SegmentFieldSummary[];
  options: {
    tiers: SegmentFieldOption[];
    cuisine: SegmentFieldOption[];
    cuisine_group: SegmentFieldOption[];
  };
};

/** One row of `GET /user-segments/:id/members`. */
export type SegmentMemberRow = {
  id: string;
  name: string;
  email: string;
  tier: string | null;
  lifetime_spend: number;
};

export type SegmentMembersPage = {
  items: SegmentMemberRow[];
  total: number;
};


export type UserSegmentListItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rule_type: UserSegmentRuleType;
  rule_config: Record<string, unknown>;
  /** Optional condition-tree (Task 5/9) — present on segments built via the visual builder. */
  definition?: SegmentDefinition | null;
  priority: number;
  is_active: boolean;
  /** Set once, at creation (or lazily on first `/preview` for a legacy segment) — membership
   * is then frozen forever. Always null for a "live" segment (guest/first_visit, no definition),
   * which is still matched live on every read. */
  frozen_at: string | null;
  /** Snapshot size taken at `frozen_at`; null until frozen. Always null for a live segment. */
  member_count: number | null;
  created_at?: string;
  updated_at?: string;
};

export const getUserSegments = async (): Promise<UserSegmentListItem[]> => {
  const response = await apiClient.get<{
    data: UserSegmentListItem[];
  }>('/user-segments');

  return response.data?.data ?? [];
};

export const getCoupons = async (
  page = 1,
  limit = 10,
  search = '',
): Promise<any> => {
  const response = await apiClient.get(
    `/coupon?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
  );
  return response;
};

export const getBanner = async (
  page = 1,
  limit = 10,
  filter = '',
  lang?: 'th' | 'en',
): Promise<any> => {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(page));
  searchParams.set('limit', String(limit));
  searchParams.set('search', filter);
  searchParams.set('placement', 'HERO');
  if (lang) searchParams.set('lang', lang);
  const response = await apiClient.get<any[]>(
    `/banner?${searchParams.toString()}`,
  );
  return response;
};

export type PopupAudienceMode = 'all' | 'guest' | 'member' | 'segment';
export type PopupTriggerType = 'immediate' | 'delay' | 'scroll_depth' | 'exit_intent' | 'page_match' | 'time_on_page';

export type PopupDefinitionActive = {
  id: string;
  name: string;
  layout: CreativeLayoutDesign;
  audience_mode: PopupAudienceMode;
  segment_id: string | null;
  trigger_type: PopupTriggerType;
  trigger_config: PopupTriggerConfig | null;
  frequency_cap_hours: number;
  max_per_session: number;
};

export type PopupDefinitionSummary = PopupDefinitionActive & {
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};


export async function listPopupDefinitions(): Promise<PopupDefinitionSummary[]> {
  const res = await apiClient.get('/popup-definitions');
  return res.data;
}
