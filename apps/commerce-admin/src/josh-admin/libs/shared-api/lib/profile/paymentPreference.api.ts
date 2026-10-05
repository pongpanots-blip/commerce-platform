import { apiClient } from '../api-client/api-client';
import type { ApiSuccess } from './profile.api';

export type PaymentPreferenceMethod = 'customer_credit' | 'credit' | 'qr';

export type PaymentPreferences = {
  default_method: PaymentPreferenceMethod;
  remind_before_due: boolean;
  alert_on_overdue: boolean;
};

export const getPaymentPreferences = async (userId: string) => {
  const response = await apiClient.get<ApiSuccess<PaymentPreferences>>(
    `/users/${userId}/payment-preferences`,
  );
  return response;
};

export const updatePaymentPreferences = async (
  userId: string,
  body: Partial<PaymentPreferences>,
) => {
  const response = await apiClient.patch<ApiSuccess<PaymentPreferences>>(
    `/users/${userId}/payment-preferences`,
    body,
  );
  return response;
};
