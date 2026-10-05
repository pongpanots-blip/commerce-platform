import { apiClient } from '../api-client/api-client';

export const getTrustedUsers = async (
  page = 1,
  limit = 10,
  search = '',
): Promise<any> => {
  const response = await apiClient.get(
    `/trusted-user?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`,
  );
  return response;
};

export const getShopTrustedUsers = async (limit = 10): Promise<any[]> => {
  const response = await apiClient.get<{
    statusCode: number;
    data: any[];
  }>(`/trusted-user/shop?limit=${limit}`);
  return response.data?.data ?? [];
};

export const getTrustedUserById = async (id: string): Promise<any> => {
  const response = await apiClient.get(`/trusted-user/${id}`);
  return response;
};

export const createTrustedUser = async (data: any): Promise<any> => {
  const response = await apiClient.post('/trusted-user', data);
  return response;
};

export const updateTrustedUser = async (id: string, data: any): Promise<any> => {
  const response = await apiClient.patch(`/trusted-user/${id}`, data);
  return response;
};

export const deleteTrustedUser = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/trusted-user/${id}`);
  return response;
};
