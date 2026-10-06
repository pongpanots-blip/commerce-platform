import { apiClient } from '../api-client/api-client';

export type PiiSubjectType =
  | 'user'
  | 'winback_account'
  | 'winback_contact'
  | 'branch'
  | 'supplier';

export type PiiField =
  | 'mobile_phone'
  | 'phone'
  | 'mobile'
  | 'email'
  | 'first_name'
  | 'last_name';

export type RevealPiiRequest = {
  subjectType: PiiSubjectType;
  subjectId: string;
  fields: PiiField[];
  reason: string;
};

export type RevealPiiResponse = Record<string, string | null>;

export const revealPii = async (body: RevealPiiRequest): Promise<RevealPiiResponse> =>
  apiClient.post('/pii/reveal', body);
