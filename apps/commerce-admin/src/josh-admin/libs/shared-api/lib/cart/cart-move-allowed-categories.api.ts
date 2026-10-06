import { apiClient } from '../api-client/api-client';

export type CartMoveAllowedCategoryRow = {
  categoryId: string;
  categoryNameEn: string;
  categoryNameTh: string | null;
  categoryPath: string | null;
  categoryLevel: number | null;
};

export type CartMoveAllowedCategoriesResponse = {
  categoryIds: string[];
  categories: CartMoveAllowedCategoryRow[];
};

function unwrap<T>(response: unknown): T {
  const body = (response as { data?: unknown })?.data ?? response;
  const payload = (body as { data?: unknown })?.data ?? body;
  return payload as T;
}

export async function getCartMoveAllowedCategories(): Promise<CartMoveAllowedCategoriesResponse> {
  const response = await apiClient.get('/admin/cart-move-allowed-categories');
  return unwrap<CartMoveAllowedCategoriesResponse>(response);
}

export async function putCartMoveAllowedCategories(
  categoryIds: string[],
): Promise<CartMoveAllowedCategoriesResponse> {
  const response = await apiClient.put('/admin/cart-move-allowed-categories', {
    categoryIds,
  });
  return unwrap<CartMoveAllowedCategoriesResponse>(response);
}
