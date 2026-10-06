import { apiClient } from '../api-client/api-client';
import type { FilterGroup } from '../filter-groups/filter-groups.api';
import type { CampaignStatus } from '../campaign/campaign.api';

export type PromotionValue =
  | { type: 'fixed'; amount: number }
  | { type: 'percentage'; percent: number }
  | {
      type: 'tiered';
      tiers: Array<{ min_qty: number; max_qty?: number; promotion_price: number }>;
    }
  | {
      type: 'bogo';
      buy_qty: number;
      get_qty: number;
      get_discount_percent: number;
    };

export type PromotionPredicateCondition = {
  field: 'cart.total' | 'cart.line_item_count' | 'sku' | 'group_id';
  op: '>=' | '<=' | '>' | '<' | '==' | '!=' | 'in';
  value: number | string | string[];
};

export type PromotionPredicateNode =
  | { op: 'and' | 'or'; conditions: PromotionPredicateNode[] }
  | PromotionPredicateCondition;

/** Who a mechanic applies to: everyone (guests included), or only the companies in `audience_company_ids`. */
export type MechanicAudience = 'all' | 'companies';

export type PromotionMechanicQuantityRule = {
  min_qty: number;
  max_qty?: number;
  promotion_price: number;
  unit_label?: string;
  badge_text?: string;
};

/**
 * A mechanic's SKU list is never sent: it comes only from the selected
 * Promotion Product Sets, copied (snapshotted) by the backend at save. One
 * `value` (percentage | tiered | bogo — not `fixed`) applies to every SKU.
 */
export type CreatePromotionMechanicPayload = {
  name: string;
  /** When set, start_date/end_date are forced to the campaign's dates. */
  campaign_id?: string;
  /** Required when there is no campaign_id. */
  start_date?: string;
  end_date?: string;
  value: PromotionValue;
  /** null / blank = no badge. */
  badge_text?: string | null;
  /** English badge (`lang=en`); blank = generated from `value`. */
  badge_text_en?: string | null;
  /** At least one; only active sets can be newly picked. */
  product_set_ids: string[];
  /** Flash-sale unit cap (all SKUs together), integer 1 – 1,000,000. Omit / null = unlimited. */
  max_units?: number | null;
  /** Default `all`. */
  audience?: MechanicAudience;
  /** Required (≥ 1, existing companies) when `audience` is `companies`; ignored for `all`. */
  audience_company_ids?: string[];
  is_active?: boolean;
};

export type UpdatePromotionMechanicPayload = {
  name?: string;
  /** null detaches from its campaign. */
  campaign_id?: string | null;
  /** Ignored while the mechanic is in a campaign. */
  start_date?: string;
  end_date?: string;
  /** Re-materializes every SKU item with the new value. */
  value?: PromotionValue;
  /** null / blank clears the badge (items are re-materialized). */
  badge_text?: string | null;
  badge_text_en?: string | null;
  /** Full replace of the selected sets: new ids are snapshotted, kept ids keep their snapshot, removed ids are dropped. */
  product_set_ids?: string[];
  /** Re-snapshot these sets from their live state ("ใช้รายการล่าสุด"). */
  refresh_product_set_ids?: string[];
  /** Integer 1 – 1,000,000 and not below `sold_units` (server rejects); null clears the cap (unlimited). */
  max_units?: number | null;
  /** Omit = keep. `all` clears the company list. */
  audience?: MechanicAudience;
  /** Full replace of the company list (≥ 1). Alone it edits the current audience. Omit = keep. */
  audience_company_ids?: string[];
  is_active?: boolean;
};

/**
 * ADMIN-ONLY audience (`GET /promotion-mechanics/audiences` / `/:id/audience`, AdminWriteGuard). The public
 * mechanic reads carry neither the audience nor the company list.
 */
export type PromotionMechanicAudienceSummary = {
  id: string;
  audience: MechanicAudience;
  company_count: number;
};

export type PromotionMechanicAudience = PromotionMechanicAudienceSummary & {
  company_ids: string[];
  /** For chips — a company deleted since it was picked is absent (but still in `company_ids`). */
  companies: Array<{ id: string; name: string }>;
};

/**
 * ADMIN-ONLY flash-sale cap (`GET /promotion-mechanics/caps` / `/:id/cap`, AdminWriteGuard). The public
 * mechanic reads carry none of it. `remaining_units` is computed by the server (`max_units - sold_units`,
 * floored at 0; 0 = sold out) — do not recompute; `null` = no cap.
 */
export type PromotionMechanicCap = {
  id: string;
  max_units: number | null;
  /** Units held by orders (reserved + used). */
  sold_units: number;
  remaining_units: number | null;
};

/** GET /promotion-mechanics/:id/product-sets (admin) — one row per selected set. */
export type PromotionMechanicProductSet = {
  id: string;
  /** Set name when it was snapshotted. */
  name: string;
  /** SKUs in the snapshot (what the mechanic actually prices), not the live set. */
  item_count: number;
  /** The snapshot's SKUs (no live query). Names / sold-out state: resolve with `resolvePromotionSkus`. */
  items: Array<{ sku: string }>;
  snapshotted_at: string;
  set_deleted: boolean;
  set_inactive: boolean;
  /** Present only when the live set differs from the snapshot. */
  latest: { added_skus: string[]; removed_skus: string[] } | null;
};

export type PromotionMechanicFilters = {
  categories: Array<{
    category_id: string;
    category_name: string;
    count: number;
  }>;
  brands: Array<{
    brand_code: string;
    brand_name: string;
    count: number;
  }>;
  countries: Array<{
    country_code: string;
    country_name: string;
    count: number;
  }>;
  priceRanges: Array<{
    key: string;
    label: string;
    count: number;
  }>;
  availability: Array<{
    key: 'true' | 'false';
    label: string;
    count: number;
  }>;
  fulfillmentTypes: Array<{
    key: 'standard' | 'preorder';
    label: string;
    count: number;
  }>;
};

export type PromotionMechanicRecord = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  apply_to: 'sku' | 'group' | 'cart';
  promo_type: string;
  campaign_id: string | null;
  badge_text: string | null;
  /** Raw admin-typed English badge (mechanic level); skuItems[].badge_text is the resolved one on `GET :id`. */
  badge_text_en?: string | null;
  is_active: boolean;
  /** Derived from is_active + the date window (same resolver as campaigns) — not stored. */
  status: CampaignStatus;
  value: PromotionValue | null;
  predicate: PromotionPredicateNode | null;
  skuItems?: Array<{
    id: string;
    sku: string;
    sort_order: number;
    badge_text?: string;
    unit_label?: string;
    quantity_rules: PromotionMechanicQuantityRule[];
    value?: PromotionValue | null;
    /** Flattened GET /product fields — present on getOne only, not list */
    product_name?: string | null;
    resolved_price?: number | null;
    price_source?: string;
    active_promotions?: unknown[];
    [key: string]: unknown;
  }>;
  /** Present on getOne — facets from all skuItems before filter */
  filters?: PromotionMechanicFilters;
  /** Self-describing filter sections; same counts as `filters` (docs/filter-groups-api.md). */
  filterGroups?: FilterGroup[];
  /** Present on getOne */
  meta?: { total: number; filteredTotal: number; page: number; limit: number };
  /** Linked promotion page images — list and getOne; null when no page */
  imageUrlWeb?: string | null;
  imageUrlMobile?: string | null;
};

export type PromotionMechanicListQuery = {
  lang?: string;
  branchId?: string;
  companyId?: string;
};

export type PromotionMechanicGetQuery = PromotionMechanicListQuery & {
  categoryId?: string;
  brandCode?: string;
  countryCode?: string;
  priceRange?: string;
  available?: 'true' | 'false';
  fulfillmentType?: string;
  sortBy?:
    | 'sort_order'
    | 'price_asc'
    | 'price_desc'
    | 'name_asc'
    | 'name_desc'
    | 'sku_asc'
    | 'sku_desc';
  page?: number;
  limit?: number;
};

/**
 * Backend always answers 200; failure is signalled by a non-empty `message`
 * with `data: []`. Throw so existing try/catch call sites keep working.
 * A duplicate-SKU rejection also carries `duplicate_skus` (same campaign) —
 * surfaced on the thrown error so the UI can list the clashing SKUs.
 */
type MechanicEnvelope<T> = {
  status: number;
  data: T;
  message: string;
  duplicate_skus?: string[];
};

export type MechanicError = Error & { duplicate_skus?: string[] };

const unwrap = <T>(envelope: MechanicEnvelope<T>): T => {
  if (envelope.message) {
    throw Object.assign(new Error(envelope.message), {
      duplicate_skus: envelope.duplicate_skus,
    }) as MechanicError;
  }
  return envelope.data;
};

/** List payload has skuItems without product fields. Use getPromotionMechanic for resolved_price / product_name. */
export const listPromotionMechanics = async (
  query?: PromotionMechanicListQuery,
): Promise<PromotionMechanicRecord[]> => {
  const response = await apiClient.get<
    MechanicEnvelope<PromotionMechanicRecord[]>
  >('/promotion-mechanics', { params: query });
  return unwrap(response.data) ?? [];
};

export const getPromotionMechanic = async (
  id: string,
  query?: PromotionMechanicGetQuery,
): Promise<PromotionMechanicRecord> => {
  const response = await apiClient.get<
    MechanicEnvelope<PromotionMechanicRecord>
  >(`/promotion-mechanics/${id}`, { params: query });
  return unwrap(response.data);
};

export const createPromotionMechanic = async (
  payload: CreatePromotionMechanicPayload,
): Promise<PromotionMechanicRecord> => {
  const response = await apiClient.post<
    MechanicEnvelope<PromotionMechanicRecord>
  >('/promotion-mechanics', payload);
  return unwrap(response.data);
};

export const updatePromotionMechanic = async (
  id: string,
  payload: UpdatePromotionMechanicPayload,
): Promise<PromotionMechanicRecord> => {
  const response = await apiClient.patch<
    MechanicEnvelope<PromotionMechanicRecord>
  >(`/promotion-mechanics/${id}`, payload);
  return unwrap(response.data);
};

/** Admin: the cap of every CAPPED mechanic (a mechanic with no row has no cap). */
export const listPromotionMechanicCaps = async (): Promise<PromotionMechanicCap[]> => {
  const response = await apiClient.get<MechanicEnvelope<PromotionMechanicCap[]>>(
    '/promotion-mechanics/caps',
  );
  return unwrap(response.data) ?? [];
};

/** Admin: every TARGETED mechanic (a mechanic with no row is for everyone). */
export const listPromotionMechanicAudiences = async (): Promise<PromotionMechanicAudienceSummary[]> => {
  const response = await apiClient.get<MechanicEnvelope<PromotionMechanicAudienceSummary[]>>(
    '/promotion-mechanics/audiences',
  );
  return unwrap(response.data) ?? [];
};

/** Admin: one mechanic's audience with company names (`audience: 'all'` and empty lists when untargeted). */
export const getPromotionMechanicAudience = async (id: string): Promise<PromotionMechanicAudience> => {
  const response = await apiClient.get<MechanicEnvelope<PromotionMechanicAudience>>(
    `/promotion-mechanics/${id}/audience`,
  );
  return unwrap(response.data);
};

/** Admin: one mechanic's cap (`max_units: null` when uncapped). */
export const getPromotionMechanicCap = async (id: string): Promise<PromotionMechanicCap> => {
  const response = await apiClient.get<MechanicEnvelope<PromotionMechanicCap>>(
    `/promotion-mechanics/${id}/cap`,
  );
  return unwrap(response.data);
};

export const getPromotionMechanicProductSets = async (
  id: string,
): Promise<PromotionMechanicProductSet[]> => {
  const response = await apiClient.get<
    MechanicEnvelope<PromotionMechanicProductSet[]>
  >(`/promotion-mechanics/${id}/product-sets`);
  return unwrap(response.data);
};

export const deletePromotionMechanic = async (id: string): Promise<void> => {
  const response = await apiClient.delete<MechanicEnvelope<unknown[]>>(
    `/promotion-mechanics/${id}`,
  );
  unwrap(response.data);
};
