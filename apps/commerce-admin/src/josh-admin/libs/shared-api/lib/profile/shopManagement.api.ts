import { apiClient } from '../api-client/api-client';
import type { ApiSuccess } from './profile.api';

export type ShopBranchSummary = {
  id: string;
  name: string;
  staff_count: number;
};

export type ShopSummary = {
  id: string;
  name: string;
  branch_count: number;
  branches: ShopBranchSummary[];
};

export type MyShopBranch = {
  id: string;
  name: string;
  type: string | null;
  recipient_name: string | null;
  phone: string | null;
  delivery_address: string | null;
  delivery_note: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  staff_count: number;
};

export type MyShop = {
  id: string;
  name: string;
  company_id: string;
  outlet_type: string | null;
  cuisine_type: string;
  branch_count: number;
  branches: MyShopBranch[];
};

export type BranchStaffMember = {
  id: string;
  email: string;
  role: string;
  active: boolean;
};

export type BranchUser = {
  id: string;
  email: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  mobile_phone: string | null;
  job_title: string | null;
  active: boolean;
};

export type MyBranchProfile = {
  id: string;
  name: string;
  shop_id: string;
  shop_name: string | null;
  company_id: string;
  type: string | null;
  recipient_name: string | null;
  phone: string | null;
  delivery_address: string | null;
  delivery_note: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
};

export type BranchDetail = MyBranchProfile & {
  users: BranchUser[];
};

export const getMyBranch = async () => {
  return apiClient.get<ApiSuccess<MyBranchProfile>>('/branch/me');
};

export const getBranchById = async (branchId: string) => {
  return apiClient.get<ApiSuccess<BranchDetail>>(`/branch/${branchId}`);
};

export const updateBranchUserStatus = async (
  branchId: string,
  userId: string,
  body: { active: boolean },
) => {
  return apiClient.patch<ApiSuccess<BranchStaffMember>>(
    `/branch/${branchId}/users/${userId}`,
    body,
  );
};

export const getMyShops = async () => {
  return apiClient.get<ApiSuccess<{ shops: MyShop[] }>>('/shop/me');
};

export const getShopById = async (shopId: string) => {
  return apiClient.get<ApiSuccess<MyShop>>(`/shop/${shopId}`);
};

export type BranchManagementDetail = {
  shop_name: string;
  cuisine_type: string;
  branch_name: string;
  recipient_name: string | null;
  mobile_phone: string | null;
  delivery_address: string | null;
  delivery_note: string | null;
  /**
   * Includes company `super_admin` only when this branch is the company's
   * first branch (oldest `created_at`). Toggle is not allowed for that role.
   */
  staff_count: number;
  staff: BranchStaffMember[];
};

export const listCompanyShops = async (_companyId?: string) => {
  const response = await apiClient.get<ApiSuccess<{ shops: ShopSummary[] }>>(
    `/companies/me/shops`,
  );
  return response;
};

export const getBranchManagement = async (branchId: string) => {
  const response = await apiClient.get<ApiSuccess<BranchManagementDetail>>(
    `/branches/${branchId}/management`,
  );
  return response;
};

export const updateBranchManagement = async (
  branchId: string,
  body: { delivery_note?: string },
) => {
  const response = await apiClient.patch<ApiSuccess<BranchManagementDetail>>(
    `/branches/${branchId}/management`,
    body,
  );
  return response;
};

export const updateStaffStatus = async (
  branchId: string,
  staffId: string,
  body: { active: boolean },
) => {
  const response = await apiClient.patch<ApiSuccess<BranchStaffMember>>(
    `/branches/${branchId}/staff/${staffId}`,
    body,
  );
  return response;
};
