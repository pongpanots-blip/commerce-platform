import { apiClient } from '../api-client/api-client';
import type { CreativeLayoutDesign, PopupTriggerConfig } from '../marketing-workflow/marketing-creative.schema';

export type PopupAudienceMode = 'all' | 'guest' | 'member' | 'segment';
export type PopupTriggerType = 'immediate' | 'delay' | 'scroll_depth' | 'exit_intent' | 'page_match' | 'time_on_page';

export type PopupDefinitionActive = {
  id: string;
  name: string;
  layout: CreativeLayoutDesign;
  audience_mode: PopupAudienceMode;
  segment_id: string | null;
  trigger_type: PopupTriggerType;
  trigger_config: PopupTriggerConfig | null;
  frequency_cap_hours: number;
  max_per_session: number;
};

export type PopupDefinitionSummary = PopupDefinitionActive & {
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export type CreatePopupDefinitionPayload = {
  name: string;
  layout: Record<string, unknown>;
  audience_mode?: PopupAudienceMode;
  segment_id?: string;
  trigger_type?: PopupTriggerType;
  trigger_config?: PopupTriggerConfig;
  frequency_cap_hours?: number;
  max_per_session?: number;
  is_active?: boolean;
  start_date?: string;
  end_date?: string;
};

export async function getActivePopupDefinitions(opts?: {
  deviceId?: string;
  userId?: string;
}): Promise<PopupDefinitionActive[]> {
  const params: Record<string, string> = {};
  if (opts?.deviceId) params['device_id'] = opts.deviceId;
  if (opts?.userId) params['user_id'] = opts.userId;
  const res = await apiClient.get('/popup-definitions/active', { params });
  return res.data;
}

export async function listPopupDefinitions(): Promise<PopupDefinitionSummary[]> {
  const res = await apiClient.get('/popup-definitions');
  return res.data;
}

export async function getPopupDefinition(id: string): Promise<PopupDefinitionSummary> {
  const res = await apiClient.get(`/popup-definitions/${id}`);
  return res.data;
}

export async function createPopupDefinition(payload: CreatePopupDefinitionPayload): Promise<PopupDefinitionSummary> {
  const res = await apiClient.post('/popup-definitions', payload);
  return res.data;
}

export async function updatePopupDefinition(id: string, payload: CreatePopupDefinitionPayload): Promise<PopupDefinitionSummary> {
  const res = await apiClient.put(`/popup-definitions/${id}`, payload);
  return res.data;
}

export async function deletePopupDefinition(id: string): Promise<void> {
  await apiClient.delete(`/popup-definitions/${id}`);
}
