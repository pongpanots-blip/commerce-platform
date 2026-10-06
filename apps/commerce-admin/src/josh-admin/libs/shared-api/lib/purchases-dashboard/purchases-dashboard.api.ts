import { apiClient } from '../api-client/api-client';

export type PurchasesDashboardQuery = {
  company_id: string;
  from: string;
  to: string;
  shop_ids?: string[];
  branch_ids?: string[];
  top_limit?: number;
};

export type PurchasesCompareQuery = PurchasesDashboardQuery & {
  mode: 'shop' | 'branch';
  entity_ids?: string[];
};

export const getPurchasesDashboard = async (
  query: PurchasesDashboardQuery,
): Promise<any> => {
  const response = await apiClient.get('/dashboard/purchases', { params: query });
  return response;
};

export const comparePurchasesDashboard = async (
  query: PurchasesCompareQuery,
): Promise<any> => {
  const response = await apiClient.get('/dashboard/purchases/compare', {
    params: query,
  });
  return response;
};

export const getPurchasesBranchOrders = async (
  branchId: string,
  query: { from: string; to: string; page?: number; limit?: number },
): Promise<any> => {
  const response = await apiClient.get(
    `/dashboard/purchases/branches/${branchId}/orders`,
    { params: query },
  );
  return response;
};

export const reconcilePurchasesDashboard = async (query: {
  company_id: string;
  from: string;
  to: string;
}): Promise<any> => {
  const response = await apiClient.post('/dashboard/purchases/reconcile', null, {
    params: query,
  });
  return response;
};

export const exportPurchasesDashboardExcel = async (
  query: PurchasesDashboardQuery,
): Promise<any> => {
  const response = await apiClient.get('/dashboard/purchases/export', {
    params: query,
  });
  return response;
};
