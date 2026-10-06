import { apiClient } from '../api-client/api-client';

/**
 * `lang` (th | en) → each image comes back as ONE language (en falls back to
 * th) and the `_en` fields are omitted. Without it the raw columns are
 * returned, `_en` included (admin).
 */
export const getBanner = async (
  page = 1,
  limit = 10,
  filter = '',
  lang?: 'th' | 'en',
): Promise<any> => {
  const searchParams = new URLSearchParams();
  searchParams.set('page', String(page));
  searchParams.set('limit', String(limit));
  searchParams.set('search', filter);
  searchParams.set('placement', 'HERO');
  if (lang) searchParams.set('lang', lang);
  const response = await apiClient.get<any[]>(
    `/banner?${searchParams.toString()}`,
  );
  return response;
};

export type CriteriaBanner = {
  id: string;
  title?: string;
  image_url_desktop: string;
  image_url_mobile?: string;
  link_url?: string;
  placement: 'POPUP_GUEST' | 'POPUP_MEMBER';
  /** The promotion page's deeplink for a banner that points at one, else null. */
  mobile_deeplink?: string | null;
};

export const getCriteriaBanner = async (
  audience: 'guest' | 'member',
  lang?: 'th' | 'en',
): Promise<CriteriaBanner | null> => {
  const response = await apiClient.get<{
    data: CriteriaBanner | null;
  }>(`/banner/criteria?audience=${audience}${lang ? `&lang=${lang}` : ''}`);
  return response.data?.data ?? null;
};

export const getCriteriaBanners = async (
  placement: 'POPUP_GUEST' | 'POPUP_MEMBER',
): Promise<any> => {
  const response = await apiClient.get(`/banner?placement=${placement}`);
  return response;
};

export type Banner = {
  id: string;
  title: string | null;
  title_th: string | null;
  title_en: string | null;
  link_url: string | null;
  placement: 'HERO' | 'POPUP_GUEST' | 'POPUP_MEMBER';
  target_type: 'PROMOTION' | 'CUISINE' | 'CRITERIA';
  target_id: string | null;
  image_url_desktop: string;
  image_url_mobile: string | null;
  /** English images — present only on reads without `lang` (admin); with `lang` the image fields above are already resolved. */
  image_url_desktop_en?: string | null;
  image_url_mobile_en?: string | null;
  /** The promotion page's deeplink for a banner that points at one, else null. */
  mobile_deeplink?: string | null;
  sort_order: number;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
};

export type BannerResponse = {
  status: number;
  data: Banner | [];
  message: string;
};

export const getBannerById = async (id: string) => {
  const response = await apiClient.get<BannerResponse>(`/banner/${id}`);
  return response;
};

export const updateBanner = async (id: string, data: FormData) => {
  const response = await apiClient.patch<BannerResponse>(
    `/banner/${id}`,
    data,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response;
};

export const createdBanner = async (data: any): Promise<any> => {
  const response = await apiClient.post<any[]>(`/banner`, data, {
    headers: { 'Content-Type': 'multipart-form-data' },
  });
  return response;
};

export const deleteBanner = async (id: string): Promise<any> => {
  const response = await apiClient.delete(`/banner/${id}`);
  return response;
};
