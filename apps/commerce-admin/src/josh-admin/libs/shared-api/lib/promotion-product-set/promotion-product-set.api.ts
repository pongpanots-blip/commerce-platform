import { apiClient } from '../api-client/api-client';

/**
 * One SKU in a Promotion Product Set. `source` = how it got in: picked/CSV (manual),
 * via a selected category, or via a selected brand. A SKU covered by several sources is
 * listed once, priority manual > category > brand.
 */
export type PromotionProductItem = {
  productInventoryId: string;
  sku: string;
  name: string;
  imageUrl: string | null;
  price: number | null;
  isActive: boolean;
  source: 'manual' | 'category' | 'brand';
  /** Badge text: category_name_en of the selected category, or brand_name_en of the selected brand; null for manual. */
  sourceLabel: string | null;
};

export type PromotionProductSetSummary = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  categoryIds: string[];
  brandIds: string[];
  itemCount: number;
  updatedAt: string;
};

export type PromotionProductSetDetail = PromotionProductSetSummary & {
  items: PromotionProductItem[];
};

export type PromotionProductSetListResponse = {
  data: PromotionProductSetSummary[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

/** Write payload: `skus` = manual SKUs only; category/brand SKUs are expanded server-side from `categoryIds` / `brandIds`. */
export type PromotionProductSetInput = {
  name: string;
  description?: string | null;
  isActive?: boolean;
  skus: string[];
  categoryIds: string[];
  brandIds: string[];
};

function unwrap<T>(response: unknown): T {
  const body = (response as { data?: unknown })?.data ?? response;
  const payload = (body as { data?: unknown })?.data ?? body;
  return payload as T;
}

const BASE = '/admin/promotion-product-sets';

export async function getPromotionProductSets(
  page = 1,
  limit = 20,
  search = '',
): Promise<PromotionProductSetListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search.trim()) params.set('search', search.trim());
  const response = await apiClient.get(`${BASE}?${params.toString()}`);
  return unwrap<PromotionProductSetListResponse>(response);
}

export async function getPromotionProductSet(id: string): Promise<PromotionProductSetDetail> {
  return unwrap<PromotionProductSetDetail>(await apiClient.get(`${BASE}/${id}`));
}

export async function createPromotionProductSet(
  input: PromotionProductSetInput,
): Promise<PromotionProductSetDetail> {
  return unwrap<PromotionProductSetDetail>(await apiClient.post(BASE, input));
}

export async function updatePromotionProductSet(
  id: string,
  input: PromotionProductSetInput,
): Promise<PromotionProductSetDetail> {
  return unwrap<PromotionProductSetDetail>(await apiClient.patch(`${BASE}/${id}`, input));
}

export async function deletePromotionProductSet(id: string): Promise<void> {
  await apiClient.delete(`${BASE}/${id}`);
}

/** Every product under the given categories (any level, descendants included). Used to preview category picks. */
export async function getPromotionCategoryProducts(
  categoryIds: string[],
): Promise<PromotionProductItem[]> {
  if (categoryIds.length === 0) return [];
  const params = new URLSearchParams({ category_ids: categoryIds.join(',') });
  return unwrap<PromotionProductItem[]>(
    await apiClient.get(`${BASE}/category-products?${params.toString()}`),
  );
}

/** Every product of the given brands (product_inventory.brand_id). Used to preview brand picks. */
export async function getPromotionBrandProducts(
  brandIds: string[],
): Promise<PromotionProductItem[]> {
  if (brandIds.length === 0) return [];
  const params = new URLSearchParams({ brand_ids: brandIds.join(',') });
  return unwrap<PromotionProductItem[]>(
    await apiClient.get(`${BASE}/brand-products?${params.toString()}`),
  );
}

/**
 * Resolve SKUs (CSV import / paste) to product rows. Sets hold active SKUs only:
 * unknown SKUs come back in `notFound`, inactive ones in `inactive` (neither is in `items`).
 */
export async function resolvePromotionSkus(
  skus: string[],
): Promise<{ items: PromotionProductItem[]; notFound: string[]; inactive: string[] }> {
  return unwrap<{ items: PromotionProductItem[]; notFound: string[]; inactive: string[] }>(
    await apiClient.post(`${BASE}/resolve-skus`, { skus }),
  );
}
