import { apiClient } from '../api-client/api-client';

export const seedAll = async (): Promise<any> => {
  const response = await apiClient.post('/seed/all');
  return response;
};

export const seedSchema = async (): Promise<any> => {
  const response = await apiClient.post('/seed/schema');
  return response;
};

export const seedTrustedBrands = async (): Promise<any> => {
  const response = await apiClient.post('/seed/trusted-brands');
  return response;
};

export const seedWebBrands = async (): Promise<any> => {
  const response = await apiClient.post('/seed/web-brands');
  return response;
};

export const seedSuppliers = async (): Promise<any> => {
  const response = await apiClient.post('/seed/suppliers');
  return response;
};

export const seedCoupons = async (): Promise<any> => {
  const response = await apiClient.post('/seed/coupons');
  return response;
};

export const seedCarousels = async (): Promise<any> => {
  const response = await apiClient.post('/seed/carousels');
  return response;
};

export const seedWebBanners = async (): Promise<any> => {
  const response = await apiClient.post('/seed/web-banners');
  return response;
};

export const seedTrustedUsers = async (): Promise<any> => {
  const response = await apiClient.post('/seed/trusted-users');
  return response;
};

export const seedDashboardPurchases = async (): Promise<any> => {
  const response = await apiClient.post('/seed/dashboard-purchases');
  return response;
};

export const importMigrationAll = async (
  customersFile: File,
  ordersFile: File,
  itemsFile: File,
  reset = true,
): Promise<any> => {
  const formData = new FormData();
  formData.append('customers', customersFile);
  formData.append('orders', ordersFile);
  formData.append('items', itemsFile);
  const response = await apiClient.post(
    `/seed/migration/import?reset=${reset ? 'true' : 'false'}`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response;
};

export const resetMigrationData = async (): Promise<any> => {
  const response = await apiClient.post('/seed/migration/reset');
  return response;
};

export const importCustomersCsv = async (
  customersFile: File,
  ordersFile?: File,
): Promise<any> => {
  const formData = new FormData();
  formData.append('customers', customersFile);
  if (ordersFile) {
    formData.append('orders', ordersFile);
  }
  const response = await apiClient.post('/seed/customers/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response;
};
