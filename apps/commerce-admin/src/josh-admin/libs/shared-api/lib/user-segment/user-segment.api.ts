import { apiClient } from '../api-client/api-client';

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

export type CreateUserSegmentPayload = {
  slug: string;
  name: string;
  description?: string;
  rule_type: UserSegmentRuleType;
  rule_config?: Record<string, unknown>;
  definition?: SegmentDefinition | null;
  priority?: number;
  is_active?: boolean;
};

export type UpdateUserSegmentPayload = Partial<
  Omit<CreateUserSegmentPayload, 'slug'>
>;

export type ResolvedUserSegment = {
  id: string;
  slug: string;
  name: string;
  rule_type: string;
};

export type ResolvedSegmentBanner = {
  id: string;
  title: string | null;
  image_url_desktop: string;
  image_url_mobile?: string | null;
  link_url?: string | null;
  placement: string;
  segment_slug: string;
};

export type ResolvedSegmentCoupon = {
  id: string;
  coupon_code: string;
  title: string;
  description?: string | null;
  discount_type: string;
  discount_value: number;
  minimum_order_amount: number;
  segment_slug: string;
};

export type UserSegmentResolveResponse = {
  segments: ResolvedUserSegment[];
  promotions: {
    banners: ResolvedSegmentBanner[];
    coupons: ResolvedSegmentCoupon[];
  };
};

export const getUserSegments = async (): Promise<UserSegmentListItem[]> => {
  const response = await apiClient.get<{
    data: UserSegmentListItem[];
  }>('/user-segments');

  return response.data?.data ?? [];
};

export const getUserSegmentById = async (
  id: string,
): Promise<UserSegmentListItem | null> => {
  const response = await apiClient.get<{
    data: UserSegmentListItem;
  }>(`/user-segments/${id}`);

  return response.data?.data ?? null;
};

export const createUserSegment = async (payload: CreateUserSegmentPayload) => {
  const response = await apiClient.post('/user-segments', payload);
  return response;
};

export const updateUserSegment = async (
  id: string,
  payload: UpdateUserSegmentPayload,
) => {
  const response = await apiClient.patch(`/user-segments/${id}`, payload);
  return response;
};

export const deleteUserSegment = async (id: string) => {
  const response = await apiClient.delete(`/user-segments/${id}`);
  return response;
};

export const previewUserSegmentCount = async (
  id: string,
): Promise<number> => {
  const response = await apiClient.get<{
    data: { member_count: number };
  }>(`/user-segments/${id}/preview`);

  return Number(response.data?.data?.member_count ?? 0);
};

/** `GET /user-segments/fields` — field registry + option lists for the visual builder (Task 9). */
export const getSegmentFields = async (): Promise<SegmentFieldsResponse> => {
  const response = await apiClient.get<{ data: SegmentFieldsResponse }>(
    '/user-segments/fields',
  );

  return (
    response.data?.data ?? {
      fields: [],
      options: { tiers: [], cuisine: [], cuisine_group: [] },
    }
  );
};

/** `POST /user-segments/preview` — "how many users match this (unsaved) definition?". */
export const previewSegment = async (
  definition: SegmentDefinition,
): Promise<number> => {
  const response = await apiClient.post<{ data: { count: number } }>(
    '/user-segments/preview',
    { definition },
  );

  return Number(response.data?.data?.count ?? 0);
};

/** `GET /user-segments/:id/members` — paginated matched users for a saved segment. */
export const getSegmentMembers = async (
  id: string,
  page = 1,
  limit = 20,
): Promise<SegmentMembersPage> => {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(page));
  searchParams.set('limit', String(limit));

  const response = await apiClient.get<{ data: SegmentMembersPage }>(
    `/user-segments/${id}/members?${searchParams.toString()}`,
  );

  return response.data?.data ?? { items: [], total: 0 };
};

/** แถว rule ในหน้า Banner Targeting (segment → banner, เรียงตาม sort_order). */
export type BannerTargetingRule = {
  mapping_id: string;
  segment_id: string;
  segment_name: string;
  segment_rule_type: string | null;
  banner_id: string;
  banner_title: string | null;
  banner_image: string | null;
  sort_order: number;
  is_active: boolean;
};

export const getBannerTargetingRules = async (): Promise<BannerTargetingRule[]> => {
  const response = await apiClient.get('/user-segments/banner-targeting');
  return response.data?.data ?? [];
};

export const addSegmentPromotion = async (
  segmentId: string,
  payload: {
    promotion_type: 'banner' | 'coupon';
    promotion_id: string;
    sort_order?: number;
    is_active?: boolean;
  },
): Promise<any> => {
  const response = await apiClient.post(
    `/user-segments/${encodeURIComponent(segmentId)}/promotions`,
    payload,
  );
  return response.data?.data;
};

export const updateSegmentPromotionMapping = async (
  mappingId: string,
  payload: { sort_order?: number; is_active?: boolean },
): Promise<any> => {
  const response = await apiClient.patch(
    `/user-segments/promotions/${encodeURIComponent(mappingId)}`,
    payload,
  );
  return response.data?.data;
};

export const removeSegmentPromotion = async (
  segmentId: string,
  mappingId: string,
): Promise<void> => {
  await apiClient.delete(
    `/user-segments/${encodeURIComponent(segmentId)}/promotions/${encodeURIComponent(mappingId)}`,
  );
};

export const resolveUserSegments = async (
  includePromotions = true,
  /** Device id — enables device-level rules (first_visit) for banner targeting. */
  individualId?: string,
): Promise<UserSegmentResolveResponse> => {
  const searchParams = new URLSearchParams();
  if (!includePromotions) {
    searchParams.set('include_promotions', 'false');
  }
  if (individualId?.trim()) {
    searchParams.set('individual_id', individualId.trim());
  }

  const query = searchParams.toString();
  const path = query
    ? `/user-segments/resolve?${query}`
    : '/user-segments/resolve';

  const response = await apiClient.get<{
    data: UserSegmentResolveResponse;
  }>(path);

  return (
    response.data?.data ?? {
      segments: [],
      promotions: { banners: [], coupons: [] },
    }
  );
};

export type ResolvedSegmentUser = {
  id: string;
  email: string;
  name: string | null;
};

export type ResolveSegmentUsersPayload = {
  emails?: string[];
  user_ids?: string[];
  custcodes?: string[];
};

export type ResolveSegmentUsersResponse = {
  users: ResolvedSegmentUser[];
  not_found: string[];
};

/**
 * `POST /user-segments/resolve-users` — resolve raw identifiers
 * (emails/user_ids/custcodes) to actual users; `not_found` echoes back
 * whichever input tokens matched nobody. Same lookup coupon import uses.
 */
export const resolveSegmentUsers = async (
  payload: ResolveSegmentUsersPayload,
): Promise<ResolveSegmentUsersResponse> => {
  const response = await apiClient.post<{ data: ResolveSegmentUsersResponse }>(
    '/user-segments/resolve-users',
    payload,
  );

  return response.data?.data ?? { users: [], not_found: [] };
};
