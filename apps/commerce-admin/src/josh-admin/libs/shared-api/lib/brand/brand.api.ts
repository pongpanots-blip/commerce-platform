import { apiClient } from '../api-client/api-client';

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
  const response = await apiClient.patch(`/brands/${id}`, data);
  return response;
};
