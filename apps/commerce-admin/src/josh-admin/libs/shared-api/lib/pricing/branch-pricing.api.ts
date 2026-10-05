import { apiClient } from '../api-client/api-client';

export type BranchPriceStatus = 'active' | 'scheduled' | 'expired';

export type BranchSpecialPriceListItem = {
  id: string;
  branch_id: string;
  branch_name: string;
  company_id: string;
  company_name: string;
  product_inventory_id: string;
  sku: string;
  product_name: string;
  price: number;
  start_date: string;
  end_date: string | null;
  note: string | null;
  status: BranchPriceStatus;
};

export type BranchContractPriceListItem = {
  id: string;
  branch_id: string;
  branch_name: string;
  company_id: string;
  company_name: string;
  product_inventory_id: string;
  sku: string;
  product_name: string;
  contract_price: number;
  contract_ref: string | null;
  start_date: string;
  end_date: string | null;
  status: BranchPriceStatus;
};

export const getBranchSpecialPrices = async (
  branchId: string,
): Promise<{ data: BranchSpecialPriceListItem[] }> => {
  const response = await apiClient.get(`/branch/${branchId}/special-prices`);
  return response.data;
};

export const createBranchSpecialPrice = async (
  branchId: string,
  payload: {
    sku?: string;
    product_inventory_id?: string;
    price: number;
    start_date?: string;
    end_date?: string;
    note?: string;
  },
): Promise<any> => {
  const response = await apiClient.post(
    `/branch/${branchId}/special-prices`,
    payload,
  );
  return response.data;
};

export const updateBranchSpecialPrice = async (
  id: string,
  payload: {
    price?: number;
    start_date?: string;
    end_date?: string;
    note?: string;
  },
): Promise<any> => {
  const response = await apiClient.patch(`/branch/special-prices/${id}`, payload);
  return response.data;
};

export const deleteBranchSpecialPrice = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/branch/special-prices/${id}`);
  return response.data;
};

export const bulkDeleteBranchSpecialPrices = async (
  ids: string[],
): Promise<any> => {
  const response = await apiClient.post(`/branch/special-prices/bulk-delete`, {
    ids,
  });
  return response.data;
};

export const importBranchSpecialPricesCsv = async (
  branchId: string,
  file: File,
): Promise<any> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post(
    `/branch/${branchId}/special-prices/import`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response.data;
};

export const getBranchContractPrices = async (
  branchId: string,
): Promise<{ data: BranchContractPriceListItem[] }> => {
  const response = await apiClient.get(`/branch/${branchId}/contract-prices`);
  return response.data;
};

export const createBranchContractPrice = async (
  branchId: string,
  payload: {
    sku?: string;
    product_inventory_id?: string;
    contract_price: number;
    contract_ref?: string;
    start_date?: string;
    end_date?: string;
  },
): Promise<any> => {
  const response = await apiClient.post(
    `/branch/${branchId}/contract-prices`,
    payload,
  );
  return response.data;
};

export const updateBranchContractPrice = async (
  id: string,
  payload: {
    contract_price?: number;
    contract_ref?: string;
    start_date?: string;
    end_date?: string;
  },
): Promise<any> => {
  const response = await apiClient.patch(
    `/branch/contract-prices/${id}`,
    payload,
  );
  return response.data;
};

export const deleteBranchContractPrice = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/branch/contract-prices/${id}`);
  return response.data;
};

export const bulkDeleteBranchContractPrices = async (
  ids: string[],
): Promise<any> => {
  const response = await apiClient.post(`/branch/contract-prices/bulk-delete`, {
    ids,
  });
  return response.data;
};

export type ProductPromotionRuleRow = {
  min_qty: number;
  max_qty?: number;
  promotion_price: number;
  unit_label?: string;
  badge_text?: string;
};

/** @deprecated use ProductPromotionRuleRow */
export type ProductTierPriceRow = ProductPromotionRuleRow & { price?: number };
