import { apiClient } from '../api-client/api-client';

export interface UserListParams {
  page?: number;
  limit?: number;
  search?: string;
  segment_id?: string;
  sortKey?: string;
  sortOrder?: 'ASC' | 'DESC';
  onboarding?: 'complete' | 'incomplete';
}

export const getUsers = async (params: UserListParams = {}): Promise<any> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams.set(key, String(value));
    }
  });
  const response = await apiClient.get(`/users?${searchParams.toString()}`);
  return response;
};

export const getUserById = async (id: string): Promise<any> => {
  const response = await apiClient.get(`/users/${id}`);
  return response;
};

export const getUserDashboard = async (id: string): Promise<any> => {
  const response = await apiClient.get(`/users/${id}/dashboard`);
  return response;
};

export const exportUsersCsv = async (
  params: Omit<UserListParams, 'page' | 'limit'> = {},
): Promise<Blob> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '' && value !== null) {
      searchParams.set(key, String(value));
    }
  });

  const response = await apiClient.get(`/users/export?${searchParams.toString()}`, {
    responseType: 'blob',
  });
  return response.data;
};
