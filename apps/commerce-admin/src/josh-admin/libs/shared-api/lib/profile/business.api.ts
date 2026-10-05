import { apiClient } from '../api-client/api-client';
import type { ApiSuccess } from './profile.api';

export type BusinessCompanyProfile = {
  id: string;
  /** Masked PII (first 3 + last 4). Never the full juristic number. */
  register_number: string | null;
  name: string;
  address: string | null;
  billing_address: string | null;
  document_language: 'thai' | 'english';
  /** Remaining active credit-note balance for this company. */
  creditNote: number;
  /** Remaining active credit-back balance for this company. */
  creditBack: number;
};

export const getBusinessProfile = async (_companyId?: string) => {
  const response = await apiClient.get<ApiSuccess<BusinessCompanyProfile>>(
    `/company/me`,
  );
  return response;
};

export const updateBusinessProfile = async (
  companyIdOrBody:
    | string
    | {
        billing_address?: string;
        document_language?: 'thai' | 'english';
      },
  body?: {
    billing_address?: string;
    document_language?: 'thai' | 'english';
  },
) => {
  const payload =
    typeof companyIdOrBody === 'object' ? companyIdOrBody : body;
  const response = await apiClient.patch<ApiSuccess<BusinessCompanyProfile>>(
    `/company/me`,
    payload,
  );
  return response;
};
