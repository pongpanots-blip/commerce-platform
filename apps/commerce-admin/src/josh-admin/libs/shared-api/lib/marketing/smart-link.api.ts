import { apiClient } from '../api-client/api-client';

export type SmartLink = {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  destination_web: string;
  destination_ios: string | null;
  destination_android: string | null;
  fallback_url: string | null;
  show_landing: boolean;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SmartLinkInput = {
  slug: string;
  title?: string;
  description?: string;
  image_url?: string;
  destination_web: string;
  destination_ios?: string;
  destination_android?: string;
  fallback_url?: string;
  show_landing?: boolean;
  active?: boolean;
  expires_at?: string | null;
};

export type SmartLinkListResult = {
  data: SmartLink[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

export const getSmartLinks = async (params: {
  search?: string;
  page?: number;
  limit?: number;
}): Promise<SmartLinkListResult> => {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  qs.set('page', String(params.page ?? 1));
  qs.set('limit', String(params.limit ?? 10));
  const res = await apiClient.get<SmartLinkListResult>(`/smart-links?${qs.toString()}`);
  return res.data;
};

export const getSmartLink = async (id: string): Promise<SmartLink> => {
  const res = await apiClient.get<SmartLink>(`/smart-links/${id}`);
  return res.data;
};

export const createSmartLink = async (input: SmartLinkInput): Promise<SmartLink> => {
  const res = await apiClient.post<SmartLink>('/smart-links', input);
  return res.data;
};

export const updateSmartLink = async (id: string, input: Partial<SmartLinkInput>): Promise<SmartLink> => {
  const res = await apiClient.patch<SmartLink>(`/smart-links/${id}`, input);
  return res.data;
};

export const deactivateSmartLink = async (id: string): Promise<SmartLink> => {
  const res = await apiClient.patch<SmartLink>(`/smart-links/${id}/deactivate`, {});
  return res.data;
};

export const deleteSmartLink = async (id: string): Promise<void> => {
  await apiClient.delete(`/smart-links/${id}`);
};

export type AnalyticsTopN = { key: string; count: number };
export type SmartLinkAnalytics = {
  totals: { clicks: number; uniqueVisitors: number; conversions: number; conversionRate: number };
  timeSeries: { date: string; clicks: number }[];
  topCountries: AnalyticsTopN[];
  topDevices: AnalyticsTopN[];
  topBrowsers: AnalyticsTopN[];
  topCampaigns: AnalyticsTopN[];
};
export type AnalyticsRange = 'today' | '7d' | '30d';

export const getSmartLinkAnalyticsOverview = async (range: AnalyticsRange): Promise<SmartLinkAnalytics> => {
  const res = await apiClient.get<SmartLinkAnalytics>(`/smart-links/analytics/overview?range=${range}`);
  return res.data;
};

export const getSmartLinkAnalytics = async (id: string, range: AnalyticsRange): Promise<SmartLinkAnalytics> => {
  const res = await apiClient.get<SmartLinkAnalytics>(`/smart-links/${id}/analytics?range=${range}`);
  return res.data;
};

export type SmartLinkEntityResult = {
  smartLinkId: string;
  slug: string;
  destination_web: string;
  originConfigured: boolean;
};

export const getOrCreateSmartLinkForEntity = async (params: {
  type: 'product' | 'cuisine' | 'promotion' | 'custom';
  id?: string;
  path?: string;
}): Promise<SmartLinkEntityResult> => {
  const qs = new URLSearchParams();
  qs.set('type', params.type);
  if (params.id) qs.set('id', params.id);
  if (params.path) qs.set('path', params.path);
  const res = await apiClient.get<SmartLinkEntityResult>(`/smart-links/for-entity?${qs.toString()}`);
  return res.data;
};
