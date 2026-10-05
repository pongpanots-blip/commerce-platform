import { Product } from '@josh/shared-models';
import { apiClient } from '../api-client/api-client';
// Import interface จาก shared-models ที่เราเคยทำไว้

export const getCompany = async (
  page = 1,
  limit = 10,
  filter = '',
): Promise<any> => {
 
  const response = await apiClient.get<any[]>(
    `/company?page=${page}&limit=${limit}&search=${filter}`,
  );
  return response;
};

export type CompanyBranchUser = {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  mobile_phone: string | null;
  role: string;
  role_label: string;
  job_title: string | null;
  job_title_label: string | null;
};

export type CompanyBranchDetail = {
  id: string;
  name: string;
  phone: string | null;
  delivery_address: string | null;
  type: string | null;
  users: CompanyBranchUser[];
};

export type CompanyDetail = {
  id: string;
  name: string;
  register_number: string | null;
  phone: string | null;
  address: string | null;
  credit_limit: number;
  credit_used: number;
  credit_term_days: number;
  credit_balance: number;
  created_at: string;
  branches: CompanyBranchDetail[];
  unassigned_users: CompanyBranchUser[];
};

export const getCompanyById = async (id: string) => {
  const response = await apiClient.get<{ data: CompanyDetail }>(
    `/company/${id}?view=admin`,
  );
  return response;
};

export const updateCompany = async (
  id: string,
  payload: {
    name?: string;
    register_number?: string;
    phone?: string;
    address?: string;
    credit_limit?: number;
    credit_term_days?: number;
  },
) => {
  const response = await apiClient.patch<{ data: CompanyDetail }>(
    `/company/${id}?view=admin`,
    payload,
  );
  return response;
};

