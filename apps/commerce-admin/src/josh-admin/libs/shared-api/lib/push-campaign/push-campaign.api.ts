import { apiClient } from '../api-client/api-client';

export type PushCampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export type PushCampaignAudienceSide = {
  userIds?: string[];
  companyIds?: string[];
  segmentIds?: string[];
};

export type PushCampaignAudience = {
  include: PushCampaignAudienceSide;
  exclude?: PushCampaignAudienceSide;
};

export type PushCampaignAbVariant = {
  title: string;
  body: string;
  title_en?: string | null;
  body_en?: string | null;
  image_url?: string | null;
};

export type PushCampaignStats = {
  queued: number;
  sent: number;
  skipped: number;
  failed: number;
  clicked: number;
};

export type PushCampaign = {
  id: string;
  name: string;
  notification_type: string;
  title: string;
  body: string;
  title_en: string | null;
  body_en: string | null;
  image_url: string | null;
  deep_link: string | null;
  deep_link_web: string | null;
  audience: PushCampaignAudience;
  ab_enabled: boolean;
  ab_variant_b: PushCampaignAbVariant | null;
  status: PushCampaignStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  stats: PushCampaignStats;
  created_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PushCampaignOverview = {
  campaigns: number;
  scheduled: number;
  sentToday: number;
  totalQueued: number;
  totalSent: number;
  totalClicked: number;
  clickRate: number;
};

export type PushAudiencePreview = {
  userIds: string[];
  included: number;
  excluded: number;
  uniqueUsers: number;
};

export type SavePushCampaignPayload = {
  name: string;
  title: string;
  body: string;
  title_en?: string | null;
  body_en?: string | null;
  image_url?: string | null;
  deep_link?: string | null;
  deep_link_web?: string | null;
  audience: PushCampaignAudience;
  ab_enabled?: boolean;
  ab_variant_b?: PushCampaignAbVariant | null;
};

type ApiEnvelope<T> = { statusCode: number; message: string; data: T };

function unwrap<T>(response: { data: ApiEnvelope<T> | T }): T {
  const body = response.data as ApiEnvelope<T> | T;
  if (body && typeof body === 'object' && 'data' in body) {
    return (body as ApiEnvelope<T>).data;
  }
  return body as T;
}

export const getPushCampaignOverview = async (): Promise<PushCampaignOverview> => {
  const response = await apiClient.get('/admin/push-campaigns/overview');
  return unwrap(response);
};

export const getPushCampaigns = async (): Promise<PushCampaign[]> => {
  const response = await apiClient.get('/admin/push-campaigns');
  return unwrap(response);
};

export const getPushCampaign = async (id: string): Promise<PushCampaign> => {
  const response = await apiClient.get(`/admin/push-campaigns/${id}`);
  return unwrap(response);
};

export const previewPushAudience = async (
  audience: PushCampaignAudience,
): Promise<PushAudiencePreview> => {
  const response = await apiClient.post('/admin/push-campaigns/preview-audience', {
    audience,
  });
  return unwrap(response);
};

export const createPushCampaign = async (
  payload: SavePushCampaignPayload,
): Promise<PushCampaign> => {
  const response = await apiClient.post('/admin/push-campaigns', payload);
  return unwrap(response);
};

export const updatePushCampaign = async (
  id: string,
  payload: Partial<SavePushCampaignPayload>,
): Promise<PushCampaign> => {
  const response = await apiClient.patch(`/admin/push-campaigns/${id}`, payload);
  return unwrap(response);
};

export const schedulePushCampaign = async (
  id: string,
  scheduledAt: string,
): Promise<PushCampaign> => {
  const response = await apiClient.post(`/admin/push-campaigns/${id}/schedule`, {
    scheduledAt,
  });
  return unwrap(response);
};

export const sendPushCampaign = async (id: string): Promise<PushCampaign> => {
  const response = await apiClient.post(`/admin/push-campaigns/${id}/send`);
  return unwrap(response);
};

export const testPushCampaign = async (
  id: string,
  userId: string,
): Promise<{ ok: true }> => {
  const response = await apiClient.post(`/admin/push-campaigns/${id}/test`, {
    userId,
  });
  return unwrap(response);
};

export const getPushCampaignDelivery = async (id: string): Promise<{
  campaign: PushCampaign;
  pipeline: PushCampaignStats;
  deliveryStats: unknown;
  recentDeliveries: Array<{
    id: string;
    userId: string;
    channel: string;
    status: string;
    reason: string | null;
    sentAt: string;
    clickedAt: string | null;
  }>;
}> => {
  const response = await apiClient.get(`/admin/push-campaigns/${id}/delivery`);
  return unwrap(response);
};
