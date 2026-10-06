import { apiClient } from '../api-client/api-client';
import type { ApiSuccess } from './profile.api';

export type PrivacyConsent = {
  marketing_consent: boolean;
};

export type PrivacyPolicyContent = {
  type: string;
  title: string;
  last_updated_at: string;
  sections: Array<{ title: string; body: string }>;
};

export type PrivacySetting = PrivacyConsent & {
  content: PrivacyPolicyContent;
};

export const getMyPrivacy = async () => {
  return apiClient.get<ApiSuccess<PrivacySetting>>('/privacy/me');
};

export const updateMyPrivacy = async (body: PrivacyConsent) => {
  return apiClient.patch<ApiSuccess<PrivacySetting>>('/privacy/me', body);
};

export const getPrivacyConsent = async (userId: string) => {
  const response = await apiClient.get<ApiSuccess<PrivacyConsent>>(
    `/users/${userId}/privacy-consent`,
  );
  return response;
};

export const updatePrivacyConsent = async (
  userId: string,
  body: PrivacyConsent,
) => {
  const response = await apiClient.patch<ApiSuccess<PrivacyConsent>>(
    `/users/${userId}/privacy-consent`,
    body,
  );
  return response;
};
