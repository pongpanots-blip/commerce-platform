import { apiClient } from '../api-client/api-client';

/**
 * Client สำหรับปุ่ม "เทส payment_test" ของ Jagota ใน web-admin
 * (`apps/backend/src/app/payment/jagota/testing/jagota-payment-testing.controller.ts`)
 * ใช้ได้บน staging เท่านั้น — backend คืน `success: false` เสมอถ้า base URL ไม่ใช่ staging
 */
export const testJagotaPayment = async (
  refToken: string,
): Promise<{ success: boolean }> => {
  const response = await apiClient.post('/payment/jagota/testing/payment-test', {
    refToken,
  });
  return response.data;
};

export type JagotaPendingPayment = {
  refToken: string;
  orderId: string | null;
  amount: string | number;
  currency: string;
  createdAt: string;
};

export const listJagotaPendingPayments = async (): Promise<JagotaPendingPayment[]> => {
  const response = await apiClient.get('/payment/jagota/testing/pending');
  return response.data;
};
