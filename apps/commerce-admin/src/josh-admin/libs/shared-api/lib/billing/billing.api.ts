import { apiClient } from '../api-client/api-client';

export type InvoiceStatus = 'unpaid' | 'paid' | 'overdue';

export interface InvoiceItem {
  id: string;
  invoice_number: string;
  order_number: string | null;
  order_date: string | null;
  due_date: string;
  branch_name: string | null;
  shop_name: string | null;
  total: number;
  status: InvoiceStatus;
  overdue_by: number | null;
  paid_date: string | null;
  payment_method: string | null;
  receipt_number: string | null;
  receipt_id: string | null;
  download_url: string | null;
}

export interface ReceiptItem {
  id: string;
  receipt_number: string;
  receipt_date: string;
  payment_method: string | null;
  /** @deprecated Use ReceiptDetail.invoices[].invoice_number. */
  invoice_numbers: string[];
  total: number;
  download_url: string | null;
}

export interface ReceiptInvoiceItem {
  invoice_number: string;
  order_number: string | null;
  total_inc_vat: number;
}

export interface ReceiptDetail extends ReceiptItem {
  invoices: ReceiptInvoiceItem[];
}

export type ReceiptSortOrder = 'default' | 'invoice_oldest_first';

export interface BillingApiResponse<T> {
  status: boolean;
  statusCode: number;
  message: string;
  data: T;
}

export type BillingListPage<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};

export type BillingSummary = {
  creditLimit: number;
  creditUsed: number;
  creditAvailable: number;
  creditTermDays: number;
  unpaidCount: number;
  overdueCount: number;
  outstandingTotal: number;
  companyName: string | null;
};

export type GetInvoicesParams = {
  userId?: string;
  status?: InvoiceStatus;
  page?: number;
  limit?: number;
};

export type GetReceiptsParams = {
  userId?: string;
  page?: number;
  limit?: number;
  sortOrder?: ReceiptSortOrder;
};

export const getBillingSummary = async (): Promise<
  BillingApiResponse<BillingSummary>
> => {
  const response = await apiClient.get<BillingApiResponse<BillingSummary>>(
    '/billing/summary',
  );
  return response.data;
};

export const getInvoices = async (
  params: GetInvoicesParams = {},
): Promise<BillingApiResponse<BillingListPage<InvoiceItem>>> => {
  const query = new URLSearchParams();
  if (params.userId) query.set('userId', params.userId);
  if (params.status) query.set('status', params.status);
  if (params.page != null) query.set('page', String(params.page));
  if (params.limit != null) query.set('limit', String(params.limit));
  const qs = query.toString();
  const response = await apiClient.get<
    BillingApiResponse<BillingListPage<InvoiceItem>>
  >(`/billing/invoices${qs ? `?${qs}` : ''}`);
  return response.data;
};

export const getInvoiceById = async (
  invoiceId: string,
): Promise<BillingApiResponse<InvoiceItem>> => {
  const response = await apiClient.get<BillingApiResponse<InvoiceItem>>(
    `/billing/invoices/${invoiceId}`,
  );
  return response.data;
};

export const getReceipts = async (
  params: GetReceiptsParams = {},
): Promise<BillingApiResponse<BillingListPage<ReceiptItem>>> => {
  const query = new URLSearchParams();
  if (params.userId) query.set('userId', params.userId);
  if (params.page != null) query.set('page', String(params.page));
  if (params.limit != null) query.set('limit', String(params.limit));
  if (params.sortOrder) query.set('sortOrder', params.sortOrder);
  const qs = query.toString();
  const response = await apiClient.get<
    BillingApiResponse<BillingListPage<ReceiptItem>>
  >(`/billing/receipts${qs ? `?${qs}` : ''}`);
  return response.data;
};

export const getReceiptById = async (
  receiptId: string,
): Promise<BillingApiResponse<ReceiptDetail>> => {
  const response = await apiClient.get<BillingApiResponse<ReceiptDetail>>(
    `/billing/receipts/${receiptId}`,
  );
  return response.data;
};
