import { apiClient } from '../api-client/api-client';
import { commerceClient, ownership } from '../api-client/commerce-client';

export const getBrands = async (missingName = false): Promise<any> => {
  const response = await apiClient.get(
    `/brands${missingName ? '?missingName=true' : ''}`,
  );
  return response;
};

export const updateBrand = async (
  id: string,
  data: { brand_name_th?: string; brand_name_en?: string },
): Promise<any> => {
  // Stage 4c: brand names are commerce's once it owns categories (COMMERCE_OWNS_CATEGORIES).
  const response = await ((await ownership()).categories ? commerceClient : apiClient).patch(`/brands/${id}`, data);
  return response;
};
