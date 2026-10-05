import { apiClient } from '../api-client/api-client';

export type MarketingOfferActive = {
  id: string;
  title: string | null;
  body: string | null;
  coupon_id: string | null;
  coupon_code: string;
  code_to_use: string;
  image_url: string | null;
  /** Popup primary-button label; shop defaults to "ไปใช้ที่ตะกร้า" when null. */
  cta_text: string | null;
  /** Popup primary-button destination; shop defaults to "/cart/placement" when null. */
  cta_url: string | null;
  /**
   * Drag-and-drop popup layout (from a popup template, vars pre-substituted):
   * blocks of `{type: 'text'|'image'|'coupon'|'button', ...}` — when present
   * the shop renders these instead of the fixed layout.
   */
  /** Legacy blocks array or `{ schemaVersion: 1, ...ChannelDesign }` creative layout. */
  layout: unknown | null;
  /** Suppress the code block + copy button in the fixed popup layout. */
  hide_code: boolean;
  /** Ad/creative only — no coupon; close is session-scoped. */
  display_only?: boolean;
  /** Max opens per browser session for display_only (default 1). */
  max_per_session?: number;
  expires_at: string | null;
};

export type MarketingOfferInspectRow = {
  id: string;
  status: string;
  title: string | null;
  user_id: string | null;
  individual_id: string | null;
  coupon_id: string;
  enrollment_id: string;
  workflow_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

export type MarketingOfferInspectResult = {
  individual_id: string | null;
  user_id_query: string | null;
  device_linked_user_id: string | null;
  resolved_user_id: string | null;
  active_for_shop: MarketingOfferActive[];
  offers: MarketingOfferInspectRow[];
};

export const getActiveMarketingOffers = async (opts?: {
  individualId?: string;
}): Promise<MarketingOfferActive[]> => {
  const params = opts?.individualId
    ? { individual_id: opts.individualId }
    : undefined;
  const response = await apiClient.get('/marketing-offers/active', { params });
  return response.data?.data ?? [];
};

export const dismissMarketingOffer = async (
  offerId: string,
  opts?: { individualId?: string },
): Promise<{ id: string; status: string }> => {
  const response = await apiClient.post(
    `/marketing-offers/${encodeURIComponent(offerId)}/dismiss`,
    opts?.individualId ? { individual_id: opts.individualId } : {},
  );
  return response.data?.data;
};

/** Admin Offer Check — device link + all statuses + what shop would see. */
export const inspectMarketingOffers = async (opts?: {
  individualId?: string;
  userId?: string;
}): Promise<MarketingOfferInspectResult> => {
  const params: Record<string, string> = {};
  if (opts?.individualId) params.individual_id = opts.individualId;
  if (opts?.userId) params.user_id = opts.userId;
  const response = await apiClient.get('/marketing-offers/inspect', { params });
  return response.data?.data;
};

export const reactivateMarketingOffer = async (
  offerId: string,
): Promise<{ id: string; status: string }> => {
  const response = await apiClient.post(
    `/marketing-offers/${encodeURIComponent(offerId)}/reactivate`,
  );
  return response.data?.data;
};
