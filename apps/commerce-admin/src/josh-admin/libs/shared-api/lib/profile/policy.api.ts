import { apiClient } from '../api-client/api-client';
import type { ApiSuccess } from './profile.api';

export type PolicyType = 'terms' | 'privacy' | 'cookies';

export type PolicySection = {
  title: string;
  body: string;
};

export type PolicyContent = {
  type: PolicyType;
  title: string;
  last_updated_at: string;
  sections: PolicySection[];
  language?: 'th' | 'en';
};

export type AboutJoshListItem = {
  id: PolicyType;
  title: string;
  last_updated_at: string;
};

export type LegalDocument = PolicyContent & {
  language: 'th' | 'en';
};

export type LegalList = {
  language: 'th' | 'en';
  items: AboutJoshListItem[];
};

export type AboutJoshDetail = {
  id: PolicyType;
  title: string;
  last_updated_at: string;
  sections: PolicySection[];
};

export const listAboutJosh = async () => {
  return apiClient.get<ApiSuccess<{ items: AboutJoshListItem[] }>>(
    '/about-josh',
  );
};

export const getAboutJoshById = async (id: PolicyType | string) => {
  return apiClient.get<ApiSuccess<AboutJoshDetail>>(`/about-josh/${id}`);
};

export type ContactUsChannel = {
  id: string;
  type: 'phone' | 'email' | string;
  label: string;
  value: string;
  action: string;
};

export type ContactUs = {
  title: string;
  company: string;
  address: string;
  phone: string;
  email: string;
  channels: ContactUsChannel[];
};

export const getContactUs = async (lang?: 'th' | 'en') => {
  return apiClient.get<ApiSuccess<ContactUs>>(
    '/contact-us',
    lang ? { params: { lang } } : undefined,
  );
};

export const getPolicy = async (
  type: PolicyType,
  lang?: 'th' | 'en',
) => {
  const response = await apiClient.get<ApiSuccess<PolicyContent>>(
    `/policies/${type}`,
    lang ? { params: { lang } } : undefined,
  );
  return response;
};

export const listPolicies = async (lang: 'th' | 'en' = 'th') => {
  return apiClient.get<ApiSuccess<{ language: 'th' | 'en'; items: AboutJoshListItem[] }>>(
    '/policies',
    { params: { lang } },
  );
};

export const listLegal = async (lang: 'th' | 'en' = 'th') => {
  const response = await apiClient.get<LegalList>('/legal', {
    params: { lang },
  });
  return response.data;
};

export const getLegal = async (
  type: PolicyType,
  lang: 'th' | 'en' = 'th',
) => {
  const response = await apiClient.get<LegalDocument>(`/legal/${type}`, {
    params: { lang },
  });
  return response.data;
};
