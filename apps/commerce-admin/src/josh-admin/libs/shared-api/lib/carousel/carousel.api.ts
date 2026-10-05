import { apiClient } from '../api-client/api-client';
import type {
  FilterGroup,
  ListingAvailability,
} from '../filter-groups/filter-groups.api';

export type ShopCarouselFilters = {
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

export type ShopCarousel = {
  id: string;
  title: string;
  subtitle?: string;
  /** Listing PLP desktop banner (2.5:1). */
  banner_image_url?: string;
  /** Listing PLP mobile crop. */
  banner_image_url_mobile?: string | null;
  /** Home rail desktop banner (6:1). Falls back to `banner_image_url` on the client. */
  home_banner_image_url?: string | null;
  /** Home rail mobile crop. */
  home_banner_image_url_mobile?: string | null;
  sort_order: number;
  carousel_type?: string;
  products: Array<Record<string, unknown>>;
  /** Present when fetching one rail with `id` — facets from all products before filter */
  filters?: ShopCarouselFilters;
  /** Self-describing filter sections; same counts as `filters` (docs/filter-groups-api.md). */
  filterGroups?: FilterGroup[];
  /** Present when fetching one rail with `id` */
  meta?: { total: number; filteredTotal: number; page: number; limit: number };
};

export type CarouselSkuMappingItem = {
  sku: string;
  sort_order?: number;
};

export type AiMapCarouselSkusPayload = {
  carousel_type: string;
  carousel_id?: string;
  skus: CarouselSkuMappingItem[];
  created_by?: string;
};

export const getCarousel = async (
  page = 1,
  limit = 10,
  search = '',
  carouselType = '',
): Promise<any> => {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    search,
  });
  if (carouselType) {
    params.set('carousel_type', carouselType);
  }

  const response = await apiClient.get<any[]>(`/carousel?${params.toString()}`);
  return response;
};

export const getCarouselsByType = async (carouselType: string): Promise<any> => {
  const response = await apiClient.get<any>(`/carousel/by-type/${carouselType}`);
  return response;
};

export const mapCarouselSkus = async (
  id: string,
  skus: CarouselSkuMappingItem[],
): Promise<any> => {
  const response = await apiClient.put<any>(`/carousel/${id}/sku-mappings`, {
    skus,
  });
  return response;
};

export const aiMapCarouselSkus = async (
  payload: AiMapCarouselSkusPayload,
): Promise<any> => {
  const response = await apiClient.post<any>('/carousel/ai/map-skus', payload);
  return response;
};

export type ShopCarouselQuery = {
  /** Fetch one rail by carousel id (product list for a page). */
  id?: string;
  companyId?: string;
  branchId?: string;
  lang?: string;
  categoryId?: string;
  brandCode?: string;
  countryCode?: string;
  priceRange?: string;
  available?: 'true' | 'false';
  /** `in_stock` | `preorder` — single value; response carries `filterGroups` */
  availability?: ListingAvailability;
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

export const getShopCarousels = async (
  options?: ShopCarouselQuery,
): Promise<ShopCarousel[]> => {
  const params = new URLSearchParams();
  if (options?.id) params.set('id', options.id);
  if (options?.companyId) params.set('companyId', options.companyId);
  if (options?.branchId) params.set('branchId', options.branchId);
  if (options?.lang) params.set('lang', options.lang);
  if (options?.categoryId) params.set('categoryId', options.categoryId);
  if (options?.brandCode) params.set('brandCode', options.brandCode);
  if (options?.countryCode) params.set('countryCode', options.countryCode);
  if (options?.priceRange) params.set('priceRange', options.priceRange);
  if (options?.available) params.set('available', options.available);
  if (options?.availability) params.set('availability', options.availability);
  if (options?.fulfillmentType) {
    params.set('fulfillmentType', options.fulfillmentType);
  }
  if (options?.sortBy) params.set('sortBy', options.sortBy);
  if (options?.page != null) params.set('page', String(options.page));
  if (options?.limit != null) params.set('limit', String(options.limit));

  const response = await apiClient.get<{
    status: boolean;
    data: ShopCarousel[];
  }>(`/carousel/shop?${params.toString()}`);

  return response.data?.data ?? [];
};

/** One carousel + products for a page — same shape as list item from getShopCarousels. */
export const getShopCarouselById = async (
  id: string,
  options?: Omit<ShopCarouselQuery, 'id'>,
): Promise<ShopCarousel | null> => {
  const rows = await getShopCarousels({ id, ...options });
  return rows[0] ?? null;
};

export const getCarouselById = async (id: string): Promise<any> => {
  const response = await apiClient.get<any>(`/carousel/${id}`);
  return response;
};

export const createCarousel = async (data: FormData | Record<string, unknown>): Promise<any> => {
  const response = await apiClient.post<any>(`/carousel`, data, {
    headers:
      data instanceof FormData
        ? { 'Content-Type': 'multipart/form-data' }
        : undefined,
  });
  return response;
};

export const updateCarousel = async (
  id: string,
  data: FormData | Record<string, unknown>,
): Promise<any> => {
  const response = await apiClient.patch<any>(`/carousel/${id}`, data, {
    headers:
      data instanceof FormData
        ? { 'Content-Type': 'multipart/form-data' }
        : undefined,
  });
  return response;
};

export const deleteCarousel = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/carousel/${id}`);
  return response;
};
