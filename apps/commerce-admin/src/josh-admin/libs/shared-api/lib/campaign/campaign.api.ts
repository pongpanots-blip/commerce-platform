import { apiClient } from '../api-client/api-client';

/** Derived by the backend from is_active + the date window — never send it. */
export type CampaignStatus = 'inactive' | 'scheduled' | 'live' | 'ended';

type CampaignBase = {
  id: string;
  name: string;
  start_at: string;
  end_at: string;
  is_active: boolean;
  /** Derived by the backend from is_active + the date window. */
  status: CampaignStatus;
};

/** GET /campaigns row. */
export type CampaignListItem = CampaignBase & {
  mechanic_count: number;
  coupon_count: number;
  page: { id: string; slug: string; is_active: boolean } | null;
};

/** GET /campaigns/:id — also what create, update and setCampaignCoupons return. */
export type CampaignDetail = CampaignBase & {
  mechanics: Array<{
    id: string;
    name: string;
    sku_count: number;
    is_active: boolean;
    /** true = the promotion page lists it for a guest (active, in its window, not company-targeted). */
    on_page: boolean;
  }>;
  page: {
    id: string;
    slug: string;
    name: string;
    is_active: boolean;
  } | null;
  banners: Array<{
    id: string;
    image_url_desktop: string;
    image_url_mobile: string | null;
    sort_order: number;
    is_active: boolean;
  }>;
  /** Same field names as the coupon endpoints. */
  coupons: Array<{
    id: string;
    coupon_code: string;
    title: string;
    /** true → applied to the cart without a code. */
    auto_apply: boolean;
    distribution_type: 'public' | 'assigned' | 'unique_per_user';
    /** null = the promotion page lists this coupon (public, no segment, active, in its window); otherwise why not. */
    page_hidden_reason: 'not_public' | 'segment' | 'inactive' | 'not_started' | 'expired' | null;
  }>;
};

export type CreateCampaignPayload = {
  name: string;
  start_at: string;
  end_at: string;
};

/** Changing dates rewrites the dates of every mechanic, page and banner in the campaign. */
export type UpdateCampaignPayload = {
  name?: string;
  start_at?: string;
  end_at?: string;
  is_active?: boolean;
};

type CampaignEnvelope<T> = {
  status: boolean;
  statusCode: number;
  message: string;
  data: T;
};

export const listCampaigns = async (): Promise<CampaignListItem[]> => {
  const response =
    await apiClient.get<CampaignEnvelope<CampaignListItem[]>>('/campaigns');
  return response.data.data;
};

export const getCampaign = async (id: string): Promise<CampaignDetail> => {
  const response = await apiClient.get<CampaignEnvelope<CampaignDetail>>(
    `/campaigns/${id}`,
  );
  return response.data.data;
};

/** 400 when end is before start. The URL slug lives on the promotion page, not here. */
export const createCampaign = async (
  payload: CreateCampaignPayload,
): Promise<CampaignDetail> => {
  const response = await apiClient.post<CampaignEnvelope<CampaignDetail>>(
    '/campaigns',
    payload,
  );
  return response.data.data;
};

export const updateCampaign = async (
  id: string,
  payload: UpdateCampaignPayload,
): Promise<CampaignDetail> => {
  const response = await apiClient.patch<CampaignEnvelope<CampaignDetail>>(
    `/campaigns/${id}`,
    payload,
  );
  return response.data.data;
};

/** 409 while the campaign still has mechanics. */
export const deleteCampaign = async (id: string): Promise<void> => {
  await apiClient.delete(`/campaigns/${id}`);
};

/** Makes `couponIds` exactly the coupon set of the campaign (400 on an unknown id). */
export const setCampaignCoupons = async (
  id: string,
  couponIds: string[],
): Promise<CampaignDetail> => {
  const response = await apiClient.put<CampaignEnvelope<CampaignDetail>>(
    `/campaigns/${id}/coupons`,
    { coupon_ids: couponIds },
  );
  return response.data.data;
};
