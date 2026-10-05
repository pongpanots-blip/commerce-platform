import { apiClient } from '../api-client/api-client';

/**
 * Client สำหรับ manual QA console ของ K-Payment Gateway
 * (`apps/backend/src/app/payment/kbank/testing/`) — ดู docs/kbank-payment-integration.md
 * ส่วน "Manual QA console" ก่อนแก้ไฟล์นี้ ทุกฟิลด์ต้องตรงกับ
 * kbank-testing.controller.ts / kbank-testing.service.ts เป๊ะๆ
 */

export type KbankTestTransaction = {
  id: string;
  gateway_charge_id: string;
  amount: string | number;
  currency: string;
  status: string;
  gateway_provider: string;
  payment_method: string;
  is_test: boolean;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
};

export const createKbankTestTransaction = async (body: {
  reference?: string;
  amount: number;
  currency?: string;
}): Promise<any> => apiClient.post('/payment/kbank/testing/transactions', body);

export const listKbankTestTransactions = async (limit = 50): Promise<any> =>
  apiClient.get(`/payment/kbank/testing/transactions?limit=${limit}`);

export const backdateKbankTestTransaction = async (
  id: string,
  minutes: number,
): Promise<any> =>
  apiClient.post(`/payment/kbank/testing/transactions/${id}/backdate`, { minutes });

export const forceKbankTestTransactionProcessing = async (id: string): Promise<any> =>
  apiClient.post(`/payment/kbank/testing/transactions/${id}/force-processing`, {});

export type KbankSimulateNotifyTamper =
  | 'bad-checksum'
  | 'no-checksum'
  | 'no-reference'
  | 'string-livemode';

export type KbankSimulateNotifyInput = {
  reference: string;
  transaction_state?: string;
  status?: string;
  livemode?: boolean;
  amount?: number;
  currency?: string;
  objectType?: 'charge' | 'qr';
  tamper?: KbankSimulateNotifyTamper;
};

export type KbankSimulateNotifyOutcome = {
  httpStatus: number;
  result?: unknown;
  error?: { name: string; message: string };
  payloadSent: Record<string, unknown>;
};

export const simulateKbankNotify = async (
  body: KbankSimulateNotifyInput,
): Promise<any> => apiClient.post('/payment/kbank/testing/simulate-notify', body);

export const reconcileKbankNow = async (): Promise<any> =>
  apiClient.post('/payment/kbank/testing/reconcile-now', {});

export type KbankQrOrderResult = {
  referenceOrder: string;
  orderId: string;
  publicKey: string;
  amount: number;
  currency: string;
  expiresAt: string;
  scriptUrl: string;
};

export const createKbankTestQrOrder = async (amount: number): Promise<any> => {
  const response = await apiClient.post('/payment/kbank/testing/qr-order', {
    amount,
  });
  return response.data;
};

export type KbankTestCaseGroup = 'kpg' | 'payment_link';
export type KbankTestCaseResult = 'not_tested' | 'pass' | 'fail' | 'na';

export type KbankTestCase = {
  id: string;
  code: string;
  group: KbankTestCaseGroup;
  title: string;
  result: KbankTestCaseResult;
  /** false = ยังไล่ไม่ได้ในรอบนี้ — backend ปฏิเสธ pass/fail สำหรับ code นี้เสมอ (ดู updateChecklist) */
  exercisable: boolean;
  note: string | null;
  tested_at: string | null;
  created_at: string;
  updated_at: string;
};

export const listKbankChecklist = async (): Promise<any> =>
  apiClient.get('/payment/kbank/testing/checklist');

export const updateKbankChecklist = async (
  code: string,
  body: { result: KbankTestCaseResult; note?: string },
): Promise<any> => apiClient.patch(`/payment/kbank/testing/checklist/${code}`, body);
