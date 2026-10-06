import { apiClient } from '../api-client/api-client';

export type MarketingLinkType = 'product' | 'cuisine' | 'promotion' | 'custom';

export type MarketingLinkParams = {
  type: MarketingLinkType;
  /** product id / cuisine card id / promotion id (ตาม type) */
  id?: string;
  /** custom: shop-relative path เช่น /product/detail/123, /search?q=x */
  path?: string;
  utm?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
};

export type MarketingLinkResult = {
  /** ลิงก์ที่เอาไปยิง ads (ChottuLink short link / web URL ถ้ายังไม่ตั้งค่า) */
  shortUrl: string;
  /** ปลายทางเว็บเต็ม */
  webUrl: string;
  /** 'chottulink' | 'fallback' */
  provider: string;
};

/**
 * สร้าง (หรือดึงจาก cache) marketing deep link จาก backend.
 * Admin only — backend ถือ ChottuLink secret key ไว้ฝั่ง server.
 */
export const getMarketingDeeplink = async (
  params: MarketingLinkParams,
): Promise<MarketingLinkResult> => {
  const qs = new URLSearchParams();
  qs.set('type', params.type);
  if (params.id) qs.set('id', params.id);
  if (params.path) qs.set('path', params.path);
  if (params.utm?.source) qs.set('utm_source', params.utm.source);
  if (params.utm?.medium) qs.set('utm_medium', params.utm.medium);
  if (params.utm?.campaign) qs.set('utm_campaign', params.utm.campaign);
  if (params.utm?.term) qs.set('utm_term', params.utm.term);
  if (params.utm?.content) qs.set('utm_content', params.utm.content);

  const response = await apiClient.get<MarketingLinkResult>(
    `/marketing/deeplink?${qs.toString()}`,
  );
  return response.data;
};
