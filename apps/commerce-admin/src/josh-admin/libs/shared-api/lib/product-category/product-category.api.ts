import type { AxiosResponse } from 'axios';
import { request } from '../../../../../lib/api';
import { apiClient } from '../api-client/api-client';
import { commerceClient } from '../api-client/commerce-client';
import type { UploadImageResponse } from '../upload/upload.api';
import { CATEGORY_IMAGE_FIELD, CATEGORY_IMAGE_UPLOAD_PATH } from './category-image';

/**
 * Category writes always go to commerce. A failed ownership read used to fall back to josh, which 403s while
 * COMMERCE_OWNS_CATEGORIES is on. Reads stay on josh's copy, which commerce keeps current (category.tree.snapshot).
 */

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

/** Category icon. Always commerce (`POST /product-category/image`, field `file`), then the edit page PATCHes `category_image`. */
export const uploadCategoryImage = async (file: File): Promise<AxiosResponse<UploadImageResponse>> => {
  const form = new FormData();
  form.append(CATEGORY_IMAGE_FIELD, file);
  try {
    const data = await request<UploadImageResponse>(CATEGORY_IMAGE_UPLOAD_PATH, { method: 'POST', body: form });
    return { data, status: 200, statusText: 'OK', headers: {}, config: {} } as AxiosResponse<UploadImageResponse>;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw Object.assign(new Error(message), { isAxiosError: true, response: { data: { message } } });
  }
};

export const createProductCategory = async (data: any): Promise<any> => {
  const response = await commerceClient.post('/product-category', data);
  return response;
};

export const updateProductCategory = async (id: string, data: any): Promise<any> => {
  const response = await commerceClient.patch(`/product-category/${id}`, data);
  return response;
};

export const deleteProductCategory = async (id: string): Promise<any> => {
  const response = await commerceClient.delete(`/product-category/${id}`);
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
  const response = await commerceClient.put(`/product-category/${parentId}/children-order`, {
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
  const response = await commerceClient.put('/product-category/level1-order', { orderedIds });
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
