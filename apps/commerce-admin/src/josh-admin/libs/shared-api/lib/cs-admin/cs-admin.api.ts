import { apiClient } from '../api-client/api-client';
import { commerceClient, ownership } from '../api-client/commerce-client';

export const updateCsUser = async (
  userId: string,
  body: {
    first_name?: string;
    last_name?: string;
    email?: string;
    mobile_phone?: string;
  },
) => apiClient.patch(`/cs-admin/users/${userId}`, body);

export const getCsUserSearchHistory = async (userId: string) =>
  apiClient.get(`/cs-admin/users/${userId}/search-history`);

export const updateCsBranch = async (
  branchId: string,
  body: {
    name?: string;
    delivery_address?: string;
    delivery_latitude?: number;
    delivery_longitude?: number;
    phone?: string;
    recipient_name?: string;
  },
) => apiClient.patch(`/cs-admin/branches/${branchId}`, body);

export const createCsBranch = async (body: {
  user_id: string;
  name: string;
  delivery_address: string;
  delivery_latitude?: number;
  delivery_longitude?: number;
  phone?: string;
  recipient_name?: string;
}) => apiClient.post('/cs-admin/branches', body);

export const mergeCsAccounts = async (body: {
  primary_user_id: string;
  duplicate_user_id: string;
}) => apiClient.post('/cs-admin/accounts/merge', body);

/** Sales-rep assignment goes to whoever owns it (stage 2b): commerce once COMMERCE_OWNS_SALES_REPS=true, josh before. */
export const assignCsSalesRep = async (body: {
  company_id: string;
  sales_user_id?: string | null;
}) => ((await ownership()).salesReps ? commerceClient : apiClient).patch('/cs-admin/sales-assignment', body);

export const getCreditApplications = async (status?: string) => {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiClient.get(`/cs-admin/credit-applications${q}`);
};

export const updateCreditApplication = async (
  applicationId: string,
  body: Record<string, unknown>,
) => apiClient.patch(`/cs-admin/credit-applications/${applicationId}`, body);

export const quoteOrderOnBehalf = async (body: {
  user_id: string;
  branch_id: string;
  items: Array<{ product_inventory_id: string; quantity: number }>;
}) => apiClient.post('/cs-admin/orders/quote', body);

export const placeOrderOnBehalf = async (body: {
  user_id: string;
  branch_id: string;
  payment_method: 'qr' | 'credit' | 'customer_credit' | 'cod';
  items: Array<{ product_inventory_id: string; quantity: number }>;
  coupon_code?: string;
  delivery_date?: string;
}) => apiClient.post('/cs-admin/orders/place-on-behalf', body);

export const getOrderPaymentQr = async (orderId: string) =>
  apiClient.get(`/cs-admin/orders/${orderId}/payment-qr`);

export const debugCouponEligibility = async (body: Record<string, unknown>) =>
  apiClient.post('/cs-admin/coupons/debug-eligibility', body);

export const getSampleRequests = async (status?: string) => {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiClient.get(`/cs-admin/sample-requests${q}`);
};

export const createSampleRequest = async (body: Record<string, unknown>) =>
  apiClient.post('/cs-admin/sample-requests', body);

export const updateSampleRequest = async (id: string, body: Record<string, unknown>) =>
  apiClient.patch(`/cs-admin/sample-requests/${id}`, body);

export const getPriceRequests = async (status?: string) => {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiClient.get(`/cs-admin/price-requests${q}`);
};

export const updatePriceRequest = async (id: string, body: Record<string, unknown>) =>
  apiClient.patch(`/cs-admin/price-requests/${id}`, body);

export const getActiveOffers = async (companyId?: string) => {
  const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return apiClient.get(`/cs-admin/active-offers${q}`);
};

export const getRefunds = async (status?: string) => {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiClient.get(`/cs-admin/refunds${q}`);
};

export const createRefund = async (body: Record<string, unknown>) =>
  apiClient.post('/cs-admin/refunds', body);

export const updateRefund = async (id: string, body: Record<string, unknown>) =>
  apiClient.patch(`/cs-admin/refunds/${id}`, body);

export const getOverdueInvoices = async () =>
  apiClient.get('/cs-admin/invoices/overdue');

export const searchBillingCompanies = (q: string) =>
  apiClient.get('/cs-admin/billing/companies', { params: { q } });

export const getCompanyBilling = (companyId: string, status?: string) =>
  apiClient.get(`/cs-admin/billing/companies/${companyId}`, {
    params: status ? { status } : undefined,
  });

export const createCompanyAdmin = async (body: Record<string, unknown>) =>
  apiClient.post('/cs-admin/companies', body);

export const getDeliveryScheduleInfo = async () =>
  apiClient.get('/cs-admin/delivery-schedule');

export const compareProducts = async (ids: string[]) =>
  apiClient.get(`/cs-admin/products/compare?ids=${ids.join(',')}`);

export const recommendProducts = async (menu: string, limit = 10) =>
  apiClient.get(
    `/cs-admin/products/recommend?menu=${encodeURIComponent(menu)}&limit=${limit}`,
  );

export type CsResolvedProductSku = {
  sku: string;
  product_inventory_id: string;
  name: string;
  price: number;
};

export const resolveCsProductSkus = async (skus: string[]) =>
  apiClient.post('/cs-admin/products/resolve-skus', { skus });

export const logSearchHistory = async (body: {
  query: string;
  result_count?: number;
  branch_id?: string;
  session_id?: string;
}) => apiClient.post('/cs-admin/search/log/anonymous', body);
