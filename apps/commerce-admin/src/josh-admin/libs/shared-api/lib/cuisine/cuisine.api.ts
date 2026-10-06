import { apiClient, viaCommerceAction } from '../api-client/api-client';
import type {
  FilterGroup,
  ListingAvailability,
} from '../filter-groups/filter-groups.api';

export type CuisineHierarchyItem = {
  id: string;
  parent_id: string | null;
  cuisine_name: string;
  level: number;
};

export type ShopCuisine = {
  id?: string;
  slug: string;
  title_en: string;
  title_th: string;
  description_en: string;
  description_th: string;
  emoji: string;
  tone: string;
  link_url: string;
  sort_order: number;
  cuisine_id?: string | null;
  image_url_mobile?: string | null;
  image_url_desktop?: string | null;
  /** Hero / landing large image (falls back to desktop/mobile card image). */
  image_url_large?: string | null;
  /** Hero / landing large image, mobile (falls back to `image_url_large`). */
  image_url_large_mobile?: string | null;
  banner_id?: string | null;
};

export type ProductListFilters = {
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

export type ShopCuisineDetail = ShopCuisine & {
  products: Array<Record<string, unknown>>;
  filters?: ProductListFilters;
  /** Self-describing filter sections; same counts as `filters` (docs/filter-groups-api.md). */
  filterGroups?: FilterGroup[];
  meta?: { total: number; filteredTotal: number };
};

export const getShopCuisines = async (
  langOrOptions?:
    | 'th'
    | 'en'
    | {
        lang?: 'th' | 'en';
        companyId?: string;
        branchId?: string;
      },
): Promise<ShopCuisine[]> => {
  const options =
    typeof langOrOptions === 'string' || langOrOptions == null
      ? { lang: langOrOptions }
      : langOrOptions;

  const params = new URLSearchParams();
  if (options.lang) params.set('lang', options.lang);
  if (options.companyId) params.set('companyId', options.companyId);
  if (options.branchId) params.set('branchId', options.branchId);

  const response = await apiClient.get<{
    statusCode: number;
    data: ShopCuisine[];
  }>(`/cuisine?${params.toString()}`);

  return response.data?.data ?? [];
};

/** One cuisine card + products linked via product_inventory_cuisine. */
export const getShopCuisineById = async (
  id: string,
  options?: {
    lang?: 'th' | 'en';
    companyId?: string;
    branchId?: string;
    search?: string;
    categoryId?: string;
    brandCode?: string;
    countryCode?: string;
    priceRange?: string;
    available?: 'true' | 'false';
    /** `in_stock` | `preorder` — single value; response carries `filterGroups` */
    availability?: ListingAvailability;
    fulfillmentType?: string;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
    page?: number;
    limit?: number;
  },
): Promise<
  | (ShopCuisineDetail & {
      page: number;
      limit: number;
      totalCount: number;
    })
  | null
> => {
  const params = new URLSearchParams({ id });
  if (options?.lang) params.set('lang', options.lang);
  if (options?.companyId) params.set('companyId', options.companyId);
  if (options?.branchId) params.set('branchId', options.branchId);
  if (options?.search) params.set('search', options.search);
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
  if (options?.sortOrder) params.set('sortOrder', options.sortOrder);
  if (options?.page != null) params.set('page', String(options.page));
  if (options?.limit != null) params.set('limit', String(options.limit));

  const response = await apiClient.get<{
    statusCode: number;
    page?: number;
    limit?: number;
    totalCount?: number;
    data: ShopCuisineDetail;
  }>(`/cuisine?${params.toString()}`);

  if (!response.data?.data) return null;

  return {
    ...response.data.data,
    page: response.data.page ?? options?.page ?? 1,
    limit: response.data.limit ?? options?.limit ?? 20,
    totalCount: response.data.totalCount ?? 0,
  };
};

export type CuisineCatalogQuery = {
  /** level 1 = cuisine type, 2 = specialty */
  level?: 1 | 2;
  /** UUID of selected cuisine type → returns its specialties */
  parent_id?: string;
};

export const getCuisineCatalog = async (
  query: CuisineCatalogQuery = {},
): Promise<CuisineHierarchyItem[]> => {
  const params = new URLSearchParams();
  if (query.level != null) params.set('level', String(query.level));
  if (query.parent_id) params.set('parent_id', query.parent_id);

  const qs = params.toString();
  const path = qs ? `/cuisine/catalog?${qs}` : '/cuisine/catalog';

  const response = await apiClient.get<{
    statusCode: number;
    data: CuisineHierarchyItem[];
  }>(path);

  return response.data?.data ?? [];
};

/** Cuisine types (level 1) — Thai, Japanese, Western, … */
export const getCuisineTypes = async (): Promise<CuisineHierarchyItem[]> =>
  getCuisineCatalog({ level: 1 });

/** Specialties (level 2) under a selected cuisine type. */
export const getCuisineSpecialties = async (
  parentId: string,
): Promise<CuisineHierarchyItem[]> =>
  getCuisineCatalog({ parent_id: parentId });

export type CuisineCardProductAdmin = {
  product_inventory_id: string;
  sku: string;
  name: string | null;
  product_image_url: string | null;
  /** false = แท็กไว้ที่ specialty ลูก (level 2) ไม่ใช่ตัวการ์ดเอง */
  is_direct_tag?: boolean;
  /** ชื่อ cuisine ที่ SKU นี้ถูกแท็กไว้จริง */
  tagged_cuisine_name?: string | null;
};

export type CuisineCardProductsPage = {
  rows: CuisineCardProductAdmin[];
  /** จำนวนที่ผูกจริงทั้งหมด — อาจมากกว่า rows.length เพราะ list จำกัดจำนวน */
  total: number;
  limit: number;
};

export type CuisineSkuMutationResult = {
  added: string[];
  skipped: string[];
  invalid: string[];
  removed?: string[];
  /** Taxonomy id used for the write (auto-provisioned when card had none). */
  cuisine_id?: string;
};

export type CuisineCardCategoryAdmin = {
  category_id: string;
  category_name_th: string | null;
  category_name_en: string;
  category_level: number;
  category_path: string | null;
  /** ลำดับแสดงผลใน product_category_cuisine.sort_category_order */
  sort_category_order?: number | null;
};

export type CuisineCategoryOrderItem = {
  category_id: string;
  sort_category_order: number;
};

export type CuisineCategoryMutationResult = {
  added: string[];
  skipped: string[];
  invalid: string[];
  removed?: string[];
  cuisine_id?: string;
};

export const listCuisineCardProductsAdmin = async (
  cardId: string,
  options: { search?: string; limit?: number } = {},
): Promise<CuisineCardProductsPage> => {
  const response = await apiClient.get<{
    statusCode: number;
    data: CuisineCardProductAdmin[];
    meta?: { total: number; returned: number; limit: number };
  }>(`/cuisine/cards/${cardId}/products`, {
    params: {
      ...(options.search?.trim() ? { search: options.search.trim() } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    },
  });
  const rows = response.data?.data ?? [];
  return {
    rows,
    total: response.data?.meta?.total ?? rows.length,
    limit: response.data?.meta?.limit ?? rows.length,
  };
};

export const addCuisineCardProductsAdmin = async (
  cardId: string,
  skus: string[],
): Promise<CuisineSkuMutationResult> => {
  const response = await apiClient.post<{
    statusCode: number;
    data: CuisineSkuMutationResult;
  }>(`/cuisine/cards/${cardId}/products`, { skus });
  return response.data?.data ?? { added: [], skipped: [], invalid: [] };
};

export const removeCuisineCardProductsAdmin = async (
  cardId: string,
  skus: string[],
): Promise<CuisineSkuMutationResult> => {
  const response = await apiClient.delete<{
    statusCode: number;
    data: CuisineSkuMutationResult;
  }>(`/cuisine/cards/${cardId}/products`, { data: { skus } });
  return (
    response.data?.data ?? { added: [], skipped: [], invalid: [], removed: [] }
  );
};

export const downloadCuisineCardProductsTemplate = async (
  cardId: string,
): Promise<Blob> => {
  const response = await apiClient.get(
    `/cuisine/cards/${cardId}/products/template`,
    { responseType: 'blob' },
  );
  return response.data as Blob;
};

export const importCuisineCardProductsAdmin = async (
  cardId: string,
  file: File,
): Promise<CuisineSkuMutationResult> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post<{
    statusCode: number;
    data: CuisineSkuMutationResult;
  }>(`/cuisine/cards/${cardId}/products/import`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data?.data ?? { added: [], skipped: [], invalid: [] };
};

export const listCuisineCardCategoriesAdmin = async (
  cardId: string,
): Promise<CuisineCardCategoryAdmin[]> => {
  const response = await apiClient.get<{
    statusCode: number;
    data: CuisineCardCategoryAdmin[];
  }>(`/cuisine/cards/${cardId}/categories`);
  return response.data?.data ?? [];
};

export const addCuisineCardCategoriesAdmin = async (
  cardId: string,
  categoryIds: string[],
): Promise<CuisineCategoryMutationResult> => {
  const response = await apiClient.post<{
    statusCode: number;
    data: CuisineCategoryMutationResult;
  }>(`/cuisine/cards/${cardId}/categories`, { category_ids: categoryIds });
  return response.data?.data ?? { added: [], skipped: [], invalid: [] };
};

export const removeCuisineCardCategoriesAdmin = async (
  cardId: string,
  categoryIds: string[],
): Promise<CuisineCategoryMutationResult> => {
  const response = await apiClient.delete<{
    statusCode: number;
    data: CuisineCategoryMutationResult;
  }>(`/cuisine/cards/${cardId}/categories`, {
    data: { category_ids: categoryIds },
  });
  return (
    response.data?.data ?? { added: [], skipped: [], invalid: [], removed: [] }
  );
};

export const reorderCuisineCardCategoriesAdmin = async (
  cardId: string,
  items: CuisineCategoryOrderItem[],
): Promise<{ updated: number; skipped: string[] }> => {
  const response = await apiClient.patch<{
    statusCode: number;
    data: { updated: number; skipped: string[] };
  }>(`/cuisine/cards/${cardId}/categories/order`, { items });
  return response.data?.data ?? { updated: 0, skipped: [] };
};

export type ProductCuisineTag = {
  id: string;
  cuisine_name: string;
  level: number;
};

export const getProductCuisines = async (
  productInventoryId: string,
): Promise<ProductCuisineTag[]> => {
  const response = await apiClient.get<{
    statusCode: number;
    data: ProductCuisineTag[];
  }>(`/product/${productInventoryId}/cuisines`);
  return response.data?.data ?? [];
};

export const setProductCuisines = async (
  productInventoryId: string,
  cuisineIds: string[],
): Promise<ProductCuisineTag[]> => {
  // through commerce's product action (CuisineService.setProductCuisines; open under COMMERCE_OWNS_CATALOG)
  const answer = await viaCommerceAction<ProductCuisineTag[] | { data?: ProductCuisineTag[] }>(
    `/josh/products/${productInventoryId}/cuisines`, { cuisineIds },
  );
  return (Array.isArray(answer) ? answer : answer?.data) ?? [];
};

export type CuisineNameAdminRow = {
  id: string;
  parent_id: string | null;
  level: number;
  cuisine_name: string;
  cuisine_name_th: string | null;
  is_active: boolean;
};

export const getCuisineNamesAdmin = async (): Promise<CuisineNameAdminRow[]> => {
  const response = await apiClient.get<{
    statusCode: number;
    data: CuisineNameAdminRow[];
  }>('/cuisine/admin/names');
  return response.data?.data ?? [];
};

export const updateCuisineNameTh = async (
  id: string,
  cuisine_name_th: string | null,
): Promise<{ id: string; cuisine_name_th: string | null }> => {
  const response = await apiClient.patch<{
    statusCode: number;
    data: { id: string; cuisine_name_th: string | null };
  }>(`/cuisine/${id}/name-th`, { cuisine_name_th });
  return response.data?.data ?? { id, cuisine_name_th };
};
