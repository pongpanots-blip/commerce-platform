import { apiClient } from '../api-client/api-client';
import type { BranchSpecialPriceListItem } from './branch-pricing.api';

/** @deprecated Use BranchSpecialPriceListItem — backward-compatible alias */
export type PrivatePriceListItem = BranchSpecialPriceListItem & {
  private_selling_price: number;
};

function mapLegacy(
  rows: Array<Partial<BranchSpecialPriceListItem> & { private_selling_price?: number; price?: number }>,
): PrivatePriceListItem[] {
  return rows.map((row) => {
    const price = Number(row.private_selling_price ?? row.price ?? 0);
    return {
      ...(row as BranchSpecialPriceListItem),
      price,
      private_selling_price: price,
    };
  });
}

export const getUserPrivatePrices = async (
  userId: string,
  branchId?: string,
): Promise<{ data: PrivatePriceListItem[] }> => {
  const response = await apiClient.get(`/users/${userId}/private-prices`, {
    params: branchId ? { branchId } : undefined,
  });
  return {
    ...response.data,
    data: mapLegacy(response.data?.data ?? []),
  };
};

export const getCompanyPrivatePrices = async (
  companyId: string,
): Promise<{ data: PrivatePriceListItem[] }> => {
  const response = await apiClient.get(`/company/${companyId}/private-prices`);
  return {
    ...response.data,
    data: mapLegacy(response.data?.data ?? []),
  };
};

export const getProductCustomerPrices = async (
  productId: string,
): Promise<{ data: PrivatePriceListItem[] }> => {
  const response = await apiClient.get(`/product/${productId}/customer-prices`);
  return {
    ...response.data,
    data: mapLegacy(response.data?.data ?? []),
  };
};

export const createCompanyPrivatePrice = async (
  companyId: string,
  payload: {
    branch_id?: string;
    product_inventory_id?: string;
    sku?: string;
    private_selling_price: number;
    start_date?: string;
    end_date?: string;
  },
): Promise<any> => {
  const response = await apiClient.post(
    `/company/${companyId}/private-prices`,
    payload,
  );
  return response.data;
};

export const updatePrivatePrice = async (
  id: string,
  payload: {
    private_selling_price?: number;
    price?: number;
    start_date?: string;
    end_date?: string;
  },
): Promise<any> => {
  const response = await apiClient.patch(`/company/private-prices/${id}`, {
    private_selling_price: payload.private_selling_price ?? payload.price,
    start_date: payload.start_date,
    end_date: payload.end_date,
  });
  return response.data;
};

export const deletePrivatePrice = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/company/private-prices/${id}`);
  return response.data;
};

export const bulkDeletePrivatePrices = async (ids: string[]): Promise<any> => {
  const response = await apiClient.post(`/company/private-prices/bulk-delete`, {
    ids,
  });
  return response.data;
};

export const importCompanyPrivatePricesCsv = async (
  companyId: string,
  file: File,
  branchId?: string,
): Promise<any> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post(
    `/company/${companyId}/private-prices/import`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: branchId ? { branchId } : undefined,
    },
  );
  return response.data;
};

export {
  getBranchSpecialPrices,
  getBranchContractPrices,
  createBranchSpecialPrice,
  createBranchContractPrice,
  updateBranchSpecialPrice,
  updateBranchContractPrice,
  deleteBranchSpecialPrice,
  deleteBranchContractPrice,
  bulkDeleteBranchSpecialPrices,
  bulkDeleteBranchContractPrices,
  importBranchSpecialPricesCsv,
} from './branch-pricing.api';

export type {
  BranchSpecialPriceListItem,
  BranchContractPriceListItem,
  ProductPromotionRuleRow,
} from './branch-pricing.api';
