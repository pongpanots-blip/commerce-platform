import { apiClient } from '../api-client/api-client';

export type ProfileCompanySummary = {
  id: string;
  name: string;
  register_number: string | null;
};

export type UserProfile = {
  id: string;
  first_name: string;
  last_name: string;
  nickname: string | null;
  mobile_phone: string | null;
  email: string;
  role: string;
  job_title: string | null;
  delivery_address: string | null;
  company: ProfileCompanySummary | null;
};

export type ApiSuccess<T> = {
  status: true;
  statusCode: number;
  message: string;
  data: T;
};

export const getProfile = async (userId: string) => {
  const response = await apiClient.get<ApiSuccess<UserProfile>>(`/users/${userId}`);
  return response;
};

export const getMyProfile = async () => {
  return apiClient.get<ApiSuccess<UserProfile>>('/user/me');
};

export const updateProfile = async (
  userId: string,
  body: {
    first_name?: string;
    last_name?: string;
    mobile_phone?: string;
    nickname?: string;
    delivery_address?: string;
    job_title?: string;
  },
) => {
  const response = await apiClient.patch<ApiSuccess<UserProfile>>(
    `/users/${userId}`,
    body,
  );
  return response;
};

export const updateMyProfile = async (body: {
  first_name?: string;
  last_name?: string;
  mobile_phone?: string;
  nickname?: string;
  delivery_address?: string;
  job_title?: string;
}) => {
  return apiClient.patch<ApiSuccess<UserProfile>>('/user/me', body);
};
