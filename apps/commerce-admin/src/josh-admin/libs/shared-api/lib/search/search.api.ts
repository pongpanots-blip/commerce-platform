import { apiClient } from '../api-client/api-client';
import type {
  FilterGroup,
  ListingAvailability,
} from '../filter-groups/filter-groups.api';

export type SearchSuggestionItem = {
  type: 'product' | 'keyword';
  id: string;
  title: string;
  sku?: string;
};

export type SearchSuggestionsResponse = {
  query: string;
  suggestions: SearchSuggestionItem[];
};

export const getSearchSuggestions = async (
  term: string,
): Promise<SearchSuggestionsResponse> => {
  const trimmed = term.trim();
  if (!trimmed) {
    return { query: '', suggestions: [] };
  }

  const response = await apiClient.get<{
    statusCode: number;
    data: SearchSuggestionsResponse;
  }>(`/product/suggestions?term=${encodeURIComponent(trimmed)}`);

  return (
    response.data?.data ?? {
      query: trimmed,
      suggestions: [],
    }
  );
};

export const getTrendingSearch = async (limit = 10): Promise<string[]> => {
  const response = await apiClient.get<{
    statusCode: number;
    data: string[];
  }>(`/search/trending?limit=${limit}`);
  return response.data?.data ?? [];
};

export const getTopPickedProducts = async (options?: {
  limit?: number;
  lang?: 'th' | 'en';
  branchId?: string;
}): Promise<Array<Record<string, unknown>>> => {
  const params = new URLSearchParams();
  params.set('limit', String(options?.limit ?? 10));
  if (options?.lang) params.set('lang', options.lang);
  if (options?.branchId) params.set('branchId', options.branchId);

  const response = await apiClient.get<{
    statusCode: number;
    data: Array<Record<string, unknown>>;
  }>(`/search/top-picked?${params.toString()}`);

  return response.data?.data ?? [];
};

export type SearchProductResult = {
  product_inventory_id?: string;
  product_name?: string | null;
  /** null for a special (customer / contract) price — the rate is `resolved_price`. */
  selling_unit_price?: number | null;
  original_price?: number | null;
  unit_price?: number | null;
  unit_price_unit?: string | null;
  product_inventory_quantity?: number;
  category_id?: string | null;
  category_name?: string | null;
  brand_code?: string | null;
  brand_name?: string | null;
  country_code_source?: string | null;
  country_name?: string | null;
  price?: number;
  media?: Array<{ source?: string; media_type?: string; sort_order?: number }>;
  base_selling_price?: number;
  resolved_price?: number;
  price_source?: string;
  has_customer_price?: boolean;
  list_price?: number;
  has_discount?: boolean;
  discount_percent?: number | null;
  promotion_rules?: unknown;
  selling_unit?: string;
  product_unit?: string;
  product_inventory_sku?: string;
  storage_temperature?: string | null;
  storage_instruction?: string | null;
  pack_size?: string | null;
  weight_min?: number | null;
  weight_max?: number | null;
  weight_unit?: string | null;
  packaging_type?: string | null;
  units_per_box?: string | null;
  avg_price_min?: number | null;
  avg_price_max?: number | null;
  avg_price_unit?: string | null;
  /** Box price the customer pays — server-scaled to the resolved unit price. */
  ordering_price?: number | string | null;
  /** Box-level strikethrough, same unit as `ordering_price` — only when `has_discount`. */
  original_ordering_price?: number | string | null;
  order_taking_unit?: string | null;
  sub_packing_unit?: string | null;
  moq?: number | null;
  delivery_dates?: Array<{ day?: string }> | null;
  delivery_date?: string | null;
  /** Live promotion mechanics on this SKU, winner first — `badge_text` is the card pill. */
  active_promotions?: Array<{ badge_text?: string | null }> | null;
};

export type SearchProductsMeta = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type RelatedProductsMeta = {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
};

// Related products for a PDP — same enriched SearchProductResult shape as search,
// ranked by the search service (category proximity + vector similarity). Paginated
// via offset for a "see more" carousel.
export const getRelatedProducts = async (
  productId: string,
  options?: {
    limit?: number;
    offset?: number;
    lang?: 'th' | 'en';
    branchId?: string;
    /** ASC = price low→high, DESC = high→low. Omit for similarity order. */
    sortOrder?: 'ASC' | 'DESC';
  },
): Promise<{ results: SearchProductResult[]; meta: RelatedProductsMeta }> => {
  const trimmed = (productId ?? '').trim();
  const limit = options?.limit ?? 10;
  const offset = Math.max(0, options?.offset ?? 0);
  const emptyMeta: RelatedProductsMeta = {
    total: 0,
    offset,
    limit,
    hasMore: false,
  };
  if (!trimmed) return { results: [], meta: emptyMeta };

  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (options?.lang) params.set('lang', options.lang);
  if (options?.branchId) params.set('branchId', options.branchId);
  if (options?.sortOrder) params.set('sortOrder', options.sortOrder);

  const response = await apiClient.get<{
    statusCode: number;
    data: {
      results: SearchProductResult[];
      meta?: RelatedProductsMeta;
      error?: string;
    };
  }>(
    `/search/products/${encodeURIComponent(trimmed)}/related?${params.toString()}`,
  );

  const body = response.data?.data;
  return {
    results: body?.results ?? [],
    meta: body?.meta ?? emptyMeta,
  };
};

export type UpsellMeta = {
  total: number;
  limit: number;
};

// Cart upsell rail — cart items in, ranked "you may also like" suggestions out.
// Same enriched SearchProductResult shape as related/search (see search-ai-josh's
// docs/upsell_products.md for the ranking contract).
export const getUpsellProducts = async (
  items: Array<{ sku: string; qty: number; price: number }>,
  opts?: {
    /**
     * SKU ที่ห้ามโผล่ในผลลัพธ์ โดยไม่ถูกใช้จัดอันดับ ส่งเมื่อ `items` เป็นแค่ส่วนหนึ่ง
     * ของตะกร้า (rail ต่อ shipment) — ไม่งั้นจะเชียร์ของที่อยู่ใน shipment อื่น
     * SKU ใน `items` ถูกกันให้อยู่แล้ว ไม่ต้องใส่ซ้ำ (ใส่มาก็ไม่ผิด)
     */
    excludeSkus?: string[];
    limit?: number;
    lang?: string;
    branchId?: string;
  },
): Promise<{ results: SearchProductResult[]; meta: UpsellMeta }> => {
  const limit = opts?.limit ?? 20;
  const emptyMeta: UpsellMeta = { total: 0, limit };
  if (!items.length) return { results: [], meta: emptyMeta };

  const response = await apiClient.post<{
    statusCode: number;
    data: {
      results: SearchProductResult[];
      meta?: UpsellMeta;
      error?: string;
    };
  }>('/search/upsell', {
    items,
    excludeSkus: opts?.excludeSkus,
    limit,
    lang: opts?.lang,
    branchId: opts?.branchId,
  });

  const body = response.data?.data;
  return {
    results: body?.results ?? [],
    meta: body?.meta ?? emptyMeta,
  };
};

export type SearchFacets = {
  categories: Array<{
    category_id: string;
    category_name: string;
    count: number;
  }>;
  brands: Array<{ brand_code: string; brand_name: string; count: number }>;
  countries: Array<{
    country_code: string;
    country_name: string;
    count: number;
  }>;
  priceRanges: Array<{ key: string; label: string; count: number }>;
};

const EMPTY_SEARCH_FACETS: SearchFacets = {
  categories: [],
  brands: [],
  countries: [],
  priceRanges: [],
};

export const getSearchProducts = async (
  query: string,
  options?: {
    page?: number;
    limit?: number;
    lang?: 'th' | 'en';
    branchId?: string;
    sortBy?: string;
    categoryIds?: string[];
    brandCodes?: string[];
    countryCodes?: string[];
    priceRanges?: string[];
    /** `in_stock` | `preorder` — single value (docs/filter-groups-api.md) */
    availability?: ListingAvailability;
    /** cuisine (taxonomy, level 2 leaf) — re-ranks results, or (with blank `query`) returns that cuisine's browse list */
    cuisineId?: string;
    fulfillmentType?: Array<'standard' | 'preorder'>;
  },
): Promise<{
  results: SearchProductResult[];
  is_sku_query: boolean;
  query: string;
  error?: string;
  meta: SearchProductsMeta;
  facets: SearchFacets;
  /** Self-describing filter sections (docs/filter-groups-api.md); `[]` when none. */
  filterGroups: FilterGroup[];
}> => {
  const trimmed = query.trim();
  const page = Math.max(1, options?.page ?? 1);
  const limit = options?.limit ?? 20;
  const emptyMeta: SearchProductsMeta = { total: 0, page, limit, totalPages: 0 };
  // Blank query still calls the endpoint when a cuisineId is given — that's the
  // cuisine "browse" list, not an empty search.
  if (!trimmed && !options?.cuisineId) {
    return {
      results: [],
      is_sku_query: false,
      query: '',
      meta: emptyMeta,
      facets: EMPTY_SEARCH_FACETS,
      filterGroups: [],
    };
  }

  const params = new URLSearchParams();
  params.set('q', trimmed);
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (options?.lang) params.set('lang', options.lang);
  if (options?.branchId) params.set('branchId', options.branchId);
  if (options?.sortBy) params.set('sortBy', options.sortBy);
  if (options?.categoryIds?.length)
    params.set('categoryId', options.categoryIds.join(','));
  if (options?.brandCodes?.length)
    params.set('brandCode', options.brandCodes.join(','));
  if (options?.countryCodes?.length)
    params.set('countryCode', options.countryCodes.join(','));
  if (options?.priceRanges?.length)
    params.set('priceRange', options.priceRanges.join(','));
  if (options?.availability) params.set('availability', options.availability);
  if (options?.cuisineId) params.set('cuisineId', options.cuisineId);
  if (options?.fulfillmentType?.length)
    params.set('fulfillmentType', options.fulfillmentType.join(','));

  const response = await apiClient.get<{
    statusCode: number;
    data: {
      results: SearchProductResult[];
      is_sku_query: boolean;
      query: string;
      error?: string;
      meta?: SearchProductsMeta;
      facets?: SearchFacets;
      filterGroups?: FilterGroup[];
    };
  }>(`/search/products?${params.toString()}`);

  const body = response.data?.data;
  return {
    results: body?.results ?? [],
    is_sku_query: body?.is_sku_query ?? false,
    query: body?.query ?? trimmed,
    error: body?.error,
    meta: body?.meta ?? emptyMeta,
    facets: body?.facets ?? EMPTY_SEARCH_FACETS,
    filterGroups: body?.filterGroups ?? [],
  };
};
