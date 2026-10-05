import { apiClient } from '../api-client/api-client';
import type { ApiSuccess } from '../profile/profile.api';
import type { CreditApplicationStatus } from '../credit-application/credit-application.api';

export type CreditBackApplicationStatus = CreditApplicationStatus;

export type CreditBackListItem = {
  cbId: string;
  cbNumber: string;
  issuedFromOrderId: string;
  issuedFromOrderNumber: string | null;
  invoiceNumber: string;
  shopName: string | null;
  branchId: string | null;
  branchName: string | null;
  orderAmountExVat: number;
  invoiceAmountExVat: number;
  totalAmountExVat: number;
  remainingAmountExVat: number;
  cbStatus: string;
  applicationStatus: CreditApplicationStatus;
  statusLabel: string;
  used: boolean;
  issuedDateLabel: string | null;
  createdAt: string | null;
  issuedAt: string;
  usages: Array<{
    id: string;
    appliedToOrderId: string;
    appliedToOrderNumber: string | null;
    amountUsedExVat: number;
    usedAt: string | null;
    usedAtLabel: string | null;
  }>;
};

export type CreditBackDetail = CreditBackListItem & {
  shipmentId: string | null;
  shipmentNumber: string | null;
  reason: string | null;
};

export type CreditBackListData = {
  items: CreditBackListItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

export const listCreditBacks = async (params?: {
  lang?: 'th' | 'en';
  view?: 'admin';
  companyId?: string;
  cbStatus?: 'active' | 'exhausted' | 'cancelled';
  applicationStatus?: CreditApplicationStatus | CreditApplicationStatus[];
  sortOrder?: 'ASC' | 'DESC';
  search?: string;
  page?: number;
  limit?: number;
}) => {
  return apiClient.get<ApiSuccess<CreditBackListData>>('/credit-backs', {
    params,
  });
};

export const getCreditBack = async (
  cbId: string,
  view?: 'admin',
  lang?: 'th' | 'en',
) => {
  return apiClient.get<ApiSuccess<CreditBackDetail>>(`/credit-backs/${cbId}`, {
    params: view || lang ? { view, lang } : undefined,
  });
};
