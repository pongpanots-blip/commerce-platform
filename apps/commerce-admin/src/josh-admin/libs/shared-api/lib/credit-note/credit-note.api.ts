import { apiClient } from '../api-client/api-client';
import type { ApiSuccess } from '../profile/profile.api';
import type { CartSummary } from '../cart/cart.api';
import type { CreditApplicationStatus } from '../credit-application/credit-application.api';

export type CreditNoteListItem = {
  cnId: string;
  cnNumber: string;
  issuedFromOrderId: string;
  issuedFromOrderNumber: string | null;
  shopName: string | null;
  branchId: string | null;
  branchName: string | null;
  totalAmountExVat: number;
  remainingAmountExVat: number;
  cnStatus: string;
  applicationStatus: CreditApplicationStatus;
  statusLabel: string;
  used: boolean;
  createdAt: string;
  issuedAt: string;
  usages: Array<{
    id: string;
    appliedToOrderId: string;
    appliedToOrderNumber: string | null;
    amountUsedExVat: number;
    usedAt: string;
  }>;
};

export type CreditNoteDetail = CreditNoteListItem & {
  claimReason: string | null;
};

export type CreditNoteListData = {
  items: CreditNoteListItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

export const listCreditNotes = async (params?: {
  view?: 'admin';
  companyId?: string;
  cnStatus?: 'active' | 'exhausted' | 'cancelled';
  applicationStatus?: CreditApplicationStatus | CreditApplicationStatus[];
  sortOrder?: 'ASC' | 'DESC';
  search?: string;
  page?: number;
  limit?: number;
}) => {
  return apiClient.get<ApiSuccess<CreditNoteListData>>('/credit-notes', {
    params,
  });
};

export const getCreditNote = async (cnId: string, view?: 'admin') => {
  return apiClient.get<ApiSuccess<CreditNoteDetail>>(`/credit-notes/${cnId}`, {
    params: view ? { view } : undefined,
  });
};

export const applyCreditNote = async (body: { cartId: string; cnId?: string }) => {
  return apiClient.post<
    ApiSuccess<{
      notes: Array<{ cnId: string; amountExVat: number }>;
      creditNoteExVat: number;
      pricing: CartSummary;
      savedToCart: boolean;
    }>
  >('/credit-notes/apply', body);
};

export const removeCartCreditNote = async (body: { cartId: string }) => {
  return apiClient.delete<
    ApiSuccess<{ pricing: CartSummary; savedToCart: boolean }>
  >('/credit-notes/apply', { data: body });
};
