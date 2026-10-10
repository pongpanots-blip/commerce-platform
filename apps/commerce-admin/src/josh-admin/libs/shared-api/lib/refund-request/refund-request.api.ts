import { apiClient } from '../api-client/api-client';
import type { ApiSuccess } from '../profile/profile.api';

/** josh's new refund flow (docs/refund-requests-api.md in josh) — admin queue, admin only. */
export type RefundRequestStatus =
  | 'awaiting_method'
  | 'under_review'
  | 'changes_requested'
  | 'processing'
  | 'awaiting_transfer'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'cancelled';

export type RefundRequestSource = 'return' | 'weight_diff';
export type RefundRequestMethod = 'credit' | 'card' | 'bank_transfer';

export type RefundRequestRow = {
  refundRequestId: string;
  refundNumber: string;
  orderId: string;
  orderNumber: string | null;
  source: RefundRequestSource;
  status: RefundRequestStatus;
  method: RefundRequestMethod | null;
  amountIncVat: number;
  cashAmountIncVat: number | null;
  createdAt: string | null;
  approvedAt: string | null;
  gatewayStatus: 'pending' | 'success' | 'failed' | 'unknown' | null;
};

export type RefundRequestDetail = RefundRequestRow & {
  reason: string;
  creditAmountIncVat: number | null;
  items: { orderItemId: string; productName: string; sku: string | null; quantity: number; amountIncVat: number }[];
  evidenceUrls: string[];
  cashReason: string | null;
  cashReasonNote: string | null;
  bankAccount: {
    bankCode: string;
    bankNameTh: string;
    accountNumber: string | null;
    holderName: string;
    bookbankUrl: string | null;
  } | null;
  policyVersion: string | null;
  policyAcceptedAt: string | null;
  refundTo: string | null;
  gatewayAction: 'void' | 'refund' | null;
  gatewayResponse: unknown;
  transferSlipUrl: string | null;
  transferredAmount: number | null;
  transferredAt: string | null;
  changesRequestedReason: string | null;
  rejectReason: string | null;
  adminNote: string | null;
};

type ActionResult = ApiSuccess<{ refundRequestId: string; status: RefundRequestStatus | null; gatewayStatus: string | null }>;

const BASE = '/admin/refund-requests';

export const listRefundRequests = (params: { status?: RefundRequestStatus; source?: RefundRequestSource; page?: number }) =>
  apiClient.get<ApiSuccess<{ items: RefundRequestRow[]; total: number; page: number }>>(BASE, { params });

export const getRefundRequest = (id: string) => apiClient.get<ApiSuccess<RefundRequestDetail>>(`${BASE}/${id}`);

export const approveRefundRequest = (id: string, note?: string) =>
  apiClient.patch<ActionResult>(`${BASE}/${id}/approve`, note ? { note } : {});

export const rejectRefundRequest = (id: string, reason: string) =>
  apiClient.patch<ActionResult>(`${BASE}/${id}/reject`, { reason });

export const requestRefundChanges = (id: string, reason: string) =>
  apiClient.patch<ActionResult>(`${BASE}/${id}/request-changes`, { reason });

export const retryRefundRequest = (id: string) => apiClient.patch<ActionResult>(`${BASE}/${id}/retry`, {});

export const resolveRefundRequest = (id: string, outcome: 'completed' | 'failed', note: string) =>
  apiClient.patch<ActionResult>(`${BASE}/${id}/resolve`, { outcome, note });

export function markRefundTransferred(id: string, input: { amount: number; transferredAt: string; slip: File }) {
  const form = new FormData();
  form.append('transferredAmount', String(input.amount));
  form.append('transferredAt', input.transferredAt);
  form.append('slip', input.slip);
  return apiClient.post<ActionResult>(`${BASE}/${id}/transfer`, form);
}
