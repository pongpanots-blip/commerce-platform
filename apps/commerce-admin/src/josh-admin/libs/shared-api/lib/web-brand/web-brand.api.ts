import { apiClient } from '../api-client/api-client';

export const getWebBrands = async (
  page = 1,
  limit = 10,
  search = '',
): Promise<any> => {
  const response = await apiClient.get(
    `/web-brand?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
  );
  return response;
};

export const getWebBrandById = async (id: string): Promise<any> => {
  const response = await apiClient.get(`/web-brand/${id}`);
  return response;
};

export const createWebBrand = async (data: any): Promise<any> => {
  const response = await apiClient.post('/web-brand', data);
  return response;
};

export const updateWebBrand = async (id: string, data: any): Promise<any> => {
  const response = await apiClient.patch(`/web-brand/${id}`, data);
  return response;
};

export const deleteWebBrand = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/web-brand/${id}`);
  return response;
};
