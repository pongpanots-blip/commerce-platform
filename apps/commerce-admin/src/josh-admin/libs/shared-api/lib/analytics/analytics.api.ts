import { apiClient } from '../api-client/api-client';

export type AnalyticsPlatform = 'web' | 'ios' | 'android';

export type IngestAnalyticsEventBody = {
  event_id: string;
  event_name: string;
  individual_id: string;
  session_id?: string;
  platform: AnalyticsPlatform;
  occurred_at?: string;
  payload?: Record<string, unknown>;
};

/** Best-effort ingest; callers should void+catch (shop-web fan-out). May throw. */
export async function ingestAnalyticsEvent(
  body: IngestAnalyticsEventBody,
): Promise<void> {
  await apiClient.post('/analytics/events', body);
}

export type AnalyticsFunnelStep =
  | 'view_item'
  | 'add_to_cart'
  | 'begin_checkout'
  | 'purchase';

export type AnalyticsFunnelStepResult = {
  step: AnalyticsFunnelStep;
  session_count: number;
  conversion_from_previous: number | null;
};

/** Mirrors `FunnelResponse` from the backend funnel service (Task 4). */
export type AnalyticsFunnelResponse = {
  steps: AnalyticsFunnelStepResult[];
  login_sessions: number;
};

export type GetAnalyticsFunnelParams = {
  from: string;
  to: string;
  audience?: 'guest' | 'logged_in' | 'all';
  platform?: AnalyticsPlatform | 'all';
};

export async function getAnalyticsFunnel(
  params: GetAnalyticsFunnelParams,
): Promise<AnalyticsFunnelResponse> {
  const response = await apiClient.get<AnalyticsFunnelResponse>(
    '/analytics/funnel',
    { params },
  );
  return response.data;
}

export type AnalyticsTimelineItem = {
  event_id: string;
  event_name: string;
  platform: string;
  session_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};

export type GetUserAnalyticsTimelineParams = {
  from?: string;
  to?: string;
  platform?: AnalyticsPlatform;
  limit?: number;
  cursor?: string;
};

/** Mirrors `TimelinePage` from the backend timeline service (Task 5). */
export type AnalyticsTimelinePage = {
  items: AnalyticsTimelineItem[];
  next_cursor: string | null;
};

export async function getUserAnalyticsTimeline(
  userId: string,
  params: GetUserAnalyticsTimelineParams = {},
): Promise<AnalyticsTimelinePage> {
  const response = await apiClient.get<AnalyticsTimelinePage>(
    `/analytics/users/${encodeURIComponent(userId)}/timeline`,
    { params },
  );
  return response.data;
}
