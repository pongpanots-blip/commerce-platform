import { apiClient } from '../api-client/api-client';

export type MarketingPageViewPlatform = 'web' | 'ios' | 'android';
export type MarketingPageViewType = 'pdp' | 'category' | 'cart' | 'path';

export type RecordMarketingPageViewPayload = {
  individual_id: string;
  platform: MarketingPageViewPlatform;
  page_type: MarketingPageViewType;
  entity_id?: string;
  path?: string;
};

export async function recordMarketingPageView(
  body: RecordMarketingPageViewPayload,
): Promise<void> {
  await apiClient.post('/marketing-events/page-view', body);
}
