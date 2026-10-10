import { Product } from '@josh/shared-models';
import { apiClient, viaCommerceAction } from '../api-client/api-client';
import { ownership } from '../api-client/commerce-client';
import { productImagesApi, productPricesApi, request, session } from '../../../../../lib/api';
import { legacyProductFields, productContentAuthority } from './product-content-edit-policy';
import { galleryWithout, graphicImageCalls, skuImageName } from './graphic-image-save';
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
  if ((await ownership()).promotions) {
    const product = await getProductById(id, { lang: 'th' });
    return product.data?.promotion_rules_locked_by ?? null;
  }
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
  if ((await ownership()).promotions) {
    const product = response.data;
    if (product?.product_inventory_sku) {
      const local = await request<{ promotion_rules: unknown[]; promotion_rules_locked_by: ProductPromotionLock }>(`/product-promotion-rules/${encodeURIComponent(product.product_inventory_sku)}`);
      product.promotion_rules_locked_by = local.promotion_rules_locked_by;
      if (!local.promotion_rules_locked_by) Object.assign(product, { promotion_rules: local.promotion_rules, tier_prices: local.promotion_rules });
    }
  }
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

/**
 * commerce-admin: josh's product form is split in two. Field values go through commerce's product
 * actions (ProductService.create / update in josh, open once COMMERCE_OWNS_CATALOG locks josh admin);
 * images and removed_media_ids stay an image-only edit on josh's own route, which that lock keeps open.
 */
function splitProductForm(data: FormData) {
  const fields: Record<string, string> = {};
  const images: File[] = [];
  let removed = '[]';
  for (const [key, value] of (data as unknown as { entries(): Iterable<[string, FormDataEntryValue]> }).entries()) {
    if (key === 'images' && typeof value !== 'string') images.push(value);
    else if (key === 'removed_media_ids') removed = String(value);
    else if (typeof value === 'string') fields[key] = value;
  }
  return { fields, images, removed };
}

const imageEdit = (id: string, images: File[], removed: string) => {
  const form = new FormData();
  form.append('removed_media_ids', removed);
  images.forEach((file) => form.append('images', file));
  return apiClient.patch<any>(`/product/${id}`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
};

const axiosError = (e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  return Object.assign(new Error(message), { isAxiosError: true, response: { status: (e as { status?: number }).status ?? 400, data: { message } } });
};

/** Graphic cannot PATCH /product/:id. Adds use the image routes; a delete needs commerce's gallery. */
async function saveGraphicImages(id: string, sku: string, images: File[], removed: string) {
  const removing = removed !== '[]';
  const owned = !!(await ownership()).productImages;
  const calls = graphicImageCalls(owned, sku, images.length, removing);
  if (removing && !calls.some((call) => call.op === 'set')) throw axiosError(new Error('ลบรูปได้เมื่อ commerce ดูแลแกลเลอรี'));
  try {
    for (const call of calls) {
      if (call.op === 'upload') await productImagesApi.upload(sku, images);
      else if (call.op === 'set') {
        const gallery = await productImagesApi.get(sku);
        const product = await apiClient.get<any>(`/product/${id}`);
        const ids = new Set<string>(JSON.parse(removed));
        const sources = ((product.data?.media ?? []) as { product_media_id?: string; source?: string }[])
          .filter((item) => item.product_media_id && ids.has(item.product_media_id))
          .map((item) => item.source ?? '');
        const next = galleryWithout(gallery.images, sources);
        if (sources.length && next.length === gallery.images.length) throw new Error('ลบรูปไม่สำเร็จ');
        await productImagesApi.set(sku, next);
      } else {
        const form = new FormData();
        form.append('mode', 'append');
        images.forEach((file, index) => form.append('images', new File([file], skuImageName(sku, index, file.name), { type: file.type })));
        await apiClient.post('/product/images/bulk-upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
    }
  } catch (e) {
    if ((e as { isAxiosError?: boolean }).isAxiosError) throw e;
    throw axiosError(e);
  }
}

export const createProduct = async (data: FormData): Promise<any> => {
  const { fields, images } = splitProductForm(data);
  const created = await viaCommerceAction<{ product_inventory_id?: string }>('/josh/products', { product: fields });
  if (images.length && created?.product_inventory_id) await imageEdit(created.product_inventory_id, images, '[]');
  return { data: created, status: 200 };
};

const GRAPHIC_DROP = ['buying_price', 'low_stock_threshold', 'reorder_quantity', 'selling_unit_price', 'product_status', 'original_price', 'ordering_price', 'product_inventory_quantity', 'promotion_rules'];

export const updateProduct = async (id: string, data: FormData): Promise<any> => {
  const split = splitProductForm(data);
  // Read the current authority at dispatch. A failed read must not assume Josh ownership.
  const fields = legacyProductFields(split.fields, productContentAuthority(await productPricesApi.ownership()));
  const { images, removed } = split;
  const sku = fields.product_inventory_sku;
  delete fields.product_inventory_sku; // identity from the ERP — read-only in commerce's form
  const graphic = session.claims()?.role === 'graphic';
  if (graphic) for (const key of GRAPHIC_DROP) delete fields[key];
  if (graphic && (images.length || removed !== '[]')) {
    if (!sku) throw axiosError(new Error('graphic image save needs a SKU'));
    // Refuse before the content write, so a blocked image delete does not leave a half-saved product.
    if (removed !== '[]' && !(await ownership()).productImages) throw axiosError(new Error('ลบรูปได้เมื่อ commerce ดูแลแกลเลอรี'));
  }
  if (Object.keys(fields).length) await viaCommerceAction(`/josh/products/${id}/update`, { fields });
  if (images.length || removed !== '[]') {
    if (graphic) await saveGraphicImages(id, sku ?? '', images, removed);
    else await imageEdit(id, images, removed);
  }
  return { data: { statusCode: 200 }, status: 200 };
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
  // Stage 4e: commerce owns galleries (COMMERCE_OWNS_PRODUCT_IMAGES) — same files / mode / answer, no undo log there.
  if ((await ownership()).productImages) {
    return { data: await request<any>('/product-images/bulk-upload', { method: 'POST', body: data }), status: 200 };
  }
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
