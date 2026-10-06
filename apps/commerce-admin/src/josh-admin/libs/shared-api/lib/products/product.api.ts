import { Product } from '@josh/shared-models';
import { apiClient } from '../api-client/api-client';
import type {
  FilterGroup,
  ListingAvailability,
} from '../filter-groups/filter-groups.api';
// Import interface จาก shared-models ที่เราเคยทำไว้

export const getProducts = async (
  page = 1,
  limit = 100,
  filter = '',
  params: {
    categoryId?: string;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
    lang?: 'th' | 'en';
    categorySortKey?: string;
    companyId?: string;
    branchId?: string;
    /**
     * Exact SKU filter, handled by the backend before the `search` branch.
     * Use this instead of passing a SKU as `filter` — a `search` query goes
     * through AI search, pollutes the shopper suggestion list and skips the
     * active-status filter.
     */
    skus?: string[];
    /** Comma-separated brand codes */
    brandCode?: string;
    /** Comma-separated country codes */
    countryCode?: string;
    /** Comma-separated price buckets, e.g. `0-500,500-1000` */
    priceRange?: string;
    /** `true` | `false` — in-stock (active + qty > 0) */
    available?: 'true' | 'false';
    /** `in_stock` | `preorder` — single value; response carries `filterGroups` (docs/filter-groups-api.md) */
    availability?: ListingAvailability;
    /** Comma-separated fulfillment keys: `standard`, `preorder` */
    fulfillmentType?: string;
  } = {},
): Promise<any> => {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(page));
  searchParams.set('limit', String(limit));
  searchParams.set('search', filter);

  for (const sku of params.skus ?? []) {
    if (sku) searchParams.append('skus', sku);
  }

  if (params.categoryId) searchParams.set('categoryId', params.categoryId);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  if (params.lang) searchParams.set('lang', params.lang);
  if (params.categorySortKey) {
    searchParams.set('categorySortKey', params.categorySortKey);
  }
  if (params.companyId) searchParams.set('companyId', params.companyId);
  if (params.branchId) searchParams.set('branchId', params.branchId);
  if (params.brandCode) searchParams.set('brandCode', params.brandCode);
  if (params.countryCode) searchParams.set('countryCode', params.countryCode);
  if (params.priceRange) searchParams.set('priceRange', params.priceRange);
  if (params.available) searchParams.set('available', params.available);
  if (params.availability) searchParams.set('availability', params.availability);
  if (params.fulfillmentType) {
    searchParams.set('fulfillmentType', params.fulfillmentType);
  }

  const response = await apiClient.get<any[]>(
    `/product?${searchParams.toString()}`,
  );
  return response;
};

/** Admin — the promotion mechanic that owns this SKU's price tiers, or null (`GET /product/:id/promotion-lock`). */
export type ProductPromotionLock = {
  mechanic_id: string;
  mechanic_name: string;
} | null;

export const getProductPromotionLock = async (
  id: string,
): Promise<ProductPromotionLock> => {
  const response = await apiClient.get<{
    data?: { promotion_rules_locked_by?: ProductPromotionLock };
  }>(`/product/${id}/promotion-lock`);
  return response.data?.data?.promotion_rules_locked_by ?? null;
};

export const getProductById = async (
  id: string,
  params: { lang?: 'th' | 'en'; companyId?: string; branchId?: string } = {},
): Promise<any> => {
  const searchParams = new URLSearchParams();
  if (params.lang) searchParams.set('lang', params.lang);
  if (params.companyId) searchParams.set('companyId', params.companyId);
  if (params.branchId) searchParams.set('branchId', params.branchId);
  const qs = searchParams.toString();
  const response = await apiClient.get<any>(
    `/product/${id}${qs ? `?${qs}` : ''}`,
  );
  return response;
};

export const getMyProducts = async (
  params: {
    page?: number;
    limit?: number;
    search?: string;
    lang?: 'th' | 'en';
    branchId?: string;
    sortBy?: 'last_ordered_at' | 'product_name';
    sortOrder?: 'ASC' | 'DESC';
  } = {},
): Promise<any> => {
  const searchParams = new URLSearchParams();
  if (params.page != null) searchParams.set('page', String(params.page));
  if (params.limit != null) searchParams.set('limit', String(params.limit));
  if (params.search) searchParams.set('search', params.search);
  if (params.lang) searchParams.set('lang', params.lang);
  if (params.branchId) searchParams.set('branchId', params.branchId);
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const qs = searchParams.toString();
  const response = await apiClient.get(`/product/my${qs ? `?${qs}` : ''}`);
  return response;
};

export const createProduct = async (data: any): Promise<any> => {
  const response = await apiClient.post<any>(`/product`, data);
  return response;
};

export const updateProduct = async (id: string, data: FormData): Promise<any> => {
  const response = await apiClient.patch<any>(`/product/${id}`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response;
};

export const uploadProductVideo = async (data: FormData): Promise<any> => {
  const response = await apiClient.post<any>(`/product/video-upload`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response;
};

/** Admin product list — same response shape as `GET /product`, with a status filter. */
export const getAdminProducts = async (params: {
  page: number;
  limit: number;
  search?: string;
  status?: 'active' | 'inactive' | 'draft' | 'all';
}): Promise<any> => {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page));
  searchParams.set('limit', String(params.limit));
  if (params.search) searchParams.set('search', params.search);
  if (params.status) searchParams.set('status', params.status);

  const response = await apiClient.get<any>(
    `/product/admin/list?${searchParams.toString()}`,
  );
  return response;
};

/** Approves specific draft products (`ids`) or every draft product (`all: true`). */
export const approveProducts = async (body: {
  ids?: string[];
  all?: boolean;
}): Promise<any> => {
  const response = await apiClient.patch<any>('/product/admin/approve', body);
  return response;
};

/** Discards staged ERP product/price patches (`ids` or `all: true`). */
export const rejectErpPending = async (body: {
  ids?: string[];
  all?: boolean;
}): Promise<any> => {
  const response = await apiClient.patch<any>(
    '/product/admin/reject-erp-pending',
    body,
  );
  return response;
};

export type ProductFacets = {
  categories: Array<{ category_id: string; category_name: string; count: number }>;
  /** Send `brand_code` back as `brandCode` — it matches brand_id, NOT brand_name. */
  brands: Array<{ brand_code: string; brand_name: string; count: number }>;
  countries: Array<{ country_code: string; country_name: string; count: number }>;
  priceRanges: Array<{ key: string; label: string; count: number }>;
  availability: Array<{ key: string; label: string; count: number }>;
  fulfillmentTypes: Array<{ key: string; label: string; count: number }>;
  /** Self-describing filter sections beside the legacy facets (docs/filter-groups-api.md). */
  filterGroups?: FilterGroup[];
};

const EMPTY_PRODUCT_FACETS: ProductFacets = {
  categories: [],
  brands: [],
  countries: [],
  priceRanges: [],
  availability: [],
  fulfillmentTypes: [],
};

/**
 * Filter options + counts for the listing sidebar. Counts are drill-down: each facet
 * is counted with every other filter applied but not its own, so ticking one brand
 * leaves its siblings clickable. Pass the current selection to keep counts honest.
 */
export const getProductFacets = async (params: {
  categoryId?: string;
  lang?: 'th' | 'en';
  companyId?: string;
  branchId?: string;
  brandCode?: string;
  countryCode?: string;
  priceRange?: string;
  available?: 'true' | 'false';
  availability?: ListingAvailability;
  fulfillmentType?: string;
} = {}): Promise<ProductFacets> => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, String(value));
  }
  const qs = searchParams.toString();

  try {
    const response = await apiClient.get<{
      data?: ProductFacets;
      filterGroups?: FilterGroup[];
    }>(`/product/facets${qs ? `?${qs}` : ''}`);
    const data = response.data?.data;
    // filterGroups is a sibling of `data` on this endpoint
    return data
      ? { ...data, filterGroups: response.data?.filterGroups ?? [] }
      : EMPTY_PRODUCT_FACETS;
  } catch {
    // a sidebar with no options is recoverable; a listing that fails to render is not
    return EMPTY_PRODUCT_FACETS;
  }
};

/**
 * Sends one client-side batch (~10 files) of SKU-image bulk uploads.
 * Caller is responsible for splitting a large staged list into batches
 * sequentially — see docs/superpowers/plans/2026-08-17-sku-image-dropzone.html.
 */
export const bulkUploadProductImages = async (data: FormData): Promise<any> => {
  const response = await apiClient.post<any>(`/product/images/bulk-upload`, data, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response;
};

/** One row of `getBulkUploadLogs` — `status` is `'ok'` or a BulkUploadFailReason string. */
export type BulkUploadLogItem = {
  logId: string;
  batchId: string;
  mode: 'append' | 'replace' | 'restore';
  filename: string;
  sku: string;
  productInventoryId: string;
  status: string;
  url: string | null;
  replacedUrl: string | null;
  replacedDeletedAt: string | null;
  createdAt: string;
};

/** History of bulk SKU-image uploads, newest first. `replacedOnly` limits to rows with a `replacedUrl`. */
export const getBulkUploadLogs = async (
  params: {
    page?: number;
    limit?: number;
    productInventoryId?: string;
    replacedOnly?: boolean;
  } = {},
): Promise<any> => {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(params.page ?? 1));
  searchParams.set('limit', String(params.limit ?? 20));
  if (params.productInventoryId) searchParams.set('productInventoryId', params.productInventoryId);
  if (params.replacedOnly) searchParams.set('replacedOnly', 'true');

  const response = await apiClient.get<any>(
    `/product/images/bulk-upload/logs?${searchParams.toString()}`,
  );
  return response;
};

/** Deletes a replaced (old) image from S3. 409 if it's still referenced elsewhere. */
export const deleteBulkUploadReplacedImage = async (logId: string): Promise<any> => {
  const response = await apiClient.delete<any>(
    `/product/images/bulk-upload/logs/${logId}/replaced-image`,
  );
  return response;
};

/** One-shot cleanup: hard-deletes every replaced image that can no longer be restored
 *  (its slot moved on, or the live image was removed). `dryRun` only counts them. */
export const pruneSupersededBulkUploadImages = async (dryRun = false): Promise<any> => {
  const response = await apiClient.post<any>(
    `/product/images/bulk-upload/prune-superseded?dryRun=${dryRun}`,
  );
  return response;
};

/** Restores a replaced (old) image back into the product's gallery. 409 if the slot was
 *  replaced again since; 410 if the old object was already hard-deleted from S3. */
export const restoreBulkUploadReplacedImage = async (logId: string): Promise<any> => {
  const response = await apiClient.post<any>(
    `/product/images/bulk-upload/logs/${logId}/restore`,
  );
  return response;
};
