import { apiClient } from '../api-client/api-client';

export const getTrustedBrands = async (
  page = 1,
  limit = 10,
  search = '',
): Promise<any> => {
  const response = await apiClient.get(
    `/trusted-brand?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
  );
  return response;
};

export const getShopTrustedBrands = async (limit = 20): Promise<any[]> => {
  const response = await apiClient.get<{
    statusCode: number;
    data: any[];
  }>(`/trusted-brand/shop?limit=${limit}`);
  return response.data?.data ?? [];
};

export const getTrustedBrandById = async (id: string): Promise<any> => {
  const response = await apiClient.get(`/trusted-brand/${id}`);
  return response;
};

export const createTrustedBrand = async (data: any): Promise<any> => {
  const response = await apiClient.post('/trusted-brand', data);
  return response;
};

export const updateTrustedBrand = async (id: string, data: any): Promise<any> => {
  const response = await apiClient.patch(`/trusted-brand/${id}`, data);
  return response;
};

export const deleteTrustedBrand = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/trusted-brand/${id}`);
  return response;
};
