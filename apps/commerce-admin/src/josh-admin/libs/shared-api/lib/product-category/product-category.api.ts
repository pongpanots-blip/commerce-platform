import { apiClient } from '../api-client/api-client';
import { commerceClient, ownership } from '../api-client/commerce-client';

/**
 * Category writes go to whoever owns the tree (stage 4c): commerce once COMMERCE_OWNS_CATEGORIES=true (same routes and
 * answers as josh), josh before. Reads stay on josh's copy, which commerce keeps current (category.tree.snapshot).
 */
const writeClient = async () => ((await ownership()).categories ? commerceClient : apiClient);

export const getProductCategories = async (
  /** Admin — include categories with no active products. */
  includeEmptyCategories = false,
  /** Optional: 'th' (default) or 'en' for localization */
  lang?: 'th' | 'en',
): Promise<any> => {
  const params = new URLSearchParams();
  if (includeEmptyCategories) params.set('with_active_products_only', 'false');
  if (lang) params.set('lang', lang);
  const response = await apiClient.get(
    `/product-category${params.toString() ? '?' + params.toString() : ''}`,
  );
  return response;
};

export const getHomepageProductCategories = async (
  /** Optional: 'th' (default) or 'en' for localization */
  lang?: 'th' | 'en',
): Promise<any> => {
  const params = new URLSearchParams();
  if (lang) params.set('lang', lang);
  const response = await apiClient.get(
    `/product-category/homepage${params.toString() ? '?' + params.toString() : ''}`,
  );
  return response;
};

export const getProductCategoriesPaginated = async (
  page = 1,
  limit = 10,
  search = '',
  level?: number,
  homepageOnly?: boolean,
  /** Admin — include categories with no active products. */
  includeEmptyCategories = false,
  /** Optional: 'th' (default) or 'en' for localization */
  lang?: 'th' | 'en',
): Promise<any> => {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  if (search) params.set('search', search);
  if (level !== undefined) params.set('level', String(level));
  if (homepageOnly) params.set('homepage_only', 'true');
  if (includeEmptyCategories) params.set('with_active_products_only', 'false');
  if (lang) params.set('lang', lang);
  const response = await apiClient.get(`/product-category?${params.toString()}`);
  return response;
};

export const getProductCategoryById = async (
  id: string,
  /** Optional: 'th' (default) or 'en' for localization */
  lang?: 'th' | 'en',
): Promise<any> => {
  const params = new URLSearchParams();
  if (lang) params.set('lang', lang);
  const response = await apiClient.get(
    `/product-category/${id}${params.toString() ? '?' + params.toString() : ''}`,
  );
  return response;
};

export const createProductCategory = async (data: any): Promise<any> => {
  const response = await (await writeClient()).post('/product-category', data);
  return response;
};

export const updateProductCategory = async (id: string, data: any): Promise<any> => {
  const response = await (await writeClient()).patch(`/product-category/${id}`, data);
  return response;
};

export const deleteProductCategory = async (id: string): Promise<any> => {
  const response = await (await writeClient()).delete(`/product-category/${id}`);
  return response;
};

/**
 * จัดลำดับหมวดย่อยทั้งชุดของหมวดแม่หนึ่งตัว — `orderedIds` ต้องมีครบทุกหมวดย่อยของ
 * `parentId` พอดี ลำดับ (`sort`) มีความหมายเฉพาะในกลุ่มพี่น้องเดียวกัน ดู docs/categories-api.md
 */
export const reorderProductCategoryChildren = async (
  parentId: string,
  orderedIds: string[],
): Promise<any> => {
  const response = await (await writeClient()).put(`/product-category/${parentId}/children-order`, {
    orderedIds,
  });
  return response;
};

/**
 * จัดลำดับหมวด **Level 1 ทั้งชั้น** ใหม่ — `orderedIds` ต้องมีครบทุกหมวด Level 1 พอดี
 * (รวมหมวดที่ไม่ได้ติ๊กแสดงบนหน้าแรก) ชั้นนี้เรียงเป็นลำดับเดียวข้าม Division เพราะหน้าแรก
 * ของ shop แสดงทั้งชั้นต่อกันเป็นแถวเดียว ดู docs/categories-api.md
 */
export const reorderLevel1ProductCategories = async (orderedIds: string[]): Promise<any> => {
  const response = await (await writeClient()).put('/product-category/level1-order', { orderedIds });
  return response;
};

export const getProductCategoryFilters = async (
  currentLevel: string,
  value: string,
  nextLevel: string,
  lang?: 'th' | 'en',
): Promise<any> => {
  const params = new URLSearchParams({
    current_level: currentLevel,
    value,
    next_level: nextLevel,
  });
  if (lang) params.set('lang', lang);
  const response = await apiClient.get(
    `/product-category/filter?${params.toString()}`,
  );
  return response;
};

/** @deprecated Use getProductCategories */
export const getCategories = getProductCategories;

/** @deprecated Use getHomepageProductCategories */
export const getHomepageCategories = getHomepageProductCategories;

/** @deprecated Use getProductCategoriesPaginated */
export const getCategoriesPaginated = getProductCategoriesPaginated;

/** @deprecated Use getProductCategoryById */
export const getCategoryById = getProductCategoryById;

/** @deprecated Use createProductCategory */
export const createCategory = createProductCategory;

/** @deprecated Use updateProductCategory */
export const updateCategory = updateProductCategory;

/** @deprecated Use deleteProductCategory */
export const deleteCategory = deleteProductCategory;

/** @deprecated Use getProductCategoryFilters */
export const getCategoryFilters = getProductCategoryFilters;
