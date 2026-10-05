import { apiClient } from '../api-client/api-client';

const toQuery = (params: Record<string, unknown> = {}) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== null) q.set(k, String(v));
  });
  return q.toString();
};

export const getWinbackPool = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/pool?${toQuery(params)}`);

export const getWinbackCounts = () => apiClient.get('/winback/pool/counts');

export const getWinbackMe = () => apiClient.get('/winback/me');

export const getWinbackSalesUsers = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/sales-users?${toQuery(params)}`);

export const getWinbackTeamStats = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/team-stats?${toQuery(params)}`);

export const getWinbackAging = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/aging?${toQuery(params)}`);

export const getWinbackAccount = (id: string) => apiClient.get(`/winback/account/${id}`);

export const syncWinback = (body: { days?: number } = {}) =>
  apiClient.post('/winback/sync', body);

export const previewWinbackImport = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return apiClient.post('/winback/import/preview', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const commitWinbackImport = (rows: unknown[]) =>
  apiClient.post('/winback/import/commit', { rows });

// --- Sales diary (P2) ---

export const createWinbackLead = (body: unknown) => apiClient.post('/winback/leads', body);

export const getWinbackActivities = (id: string) =>
  apiClient.get(`/winback/account/${id}/activities`);

export const logWinbackActivity = (id: string, body: unknown) =>
  apiClient.post(`/winback/account/${id}/activities`, body);

export const getWinbackMyDay = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/my-day?${toQuery(params)}`);

export const getWinbackDiary = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/diary?${toQuery(params)}`);

/** Planned appointments for calendar (filters by scheduled_at). */
export const getWinbackCalendar = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/calendar?${toQuery(params)}`);

export const getWinbackScorecard = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/scorecard?${toQuery(params)}`);

export const getWinbackDashboard = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/dashboard?${toQuery(params)}`);

export const getWinbackAnalytics = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/analytics?${toQuery(params)}`);

export const getWinbackTeamLocations = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/team-locations?${toQuery(params)}`);

export const getWinbackTeamActivityFeed = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/team-activity-feed?${toQuery(params)}`);

export const getWinbackTargets = (params: Record<string, unknown> = {}) =>
  apiClient.get(`/winback/targets?${toQuery(params)}`);

export const upsertWinbackTarget = (body: unknown) =>
  apiClient.put('/winback/targets', body);

export const moveWinbackStage = (
  id: string,
  stage: string,
  extra: { note?: string; reject_reason?: string; reject_note?: string } = {},
) => apiClient.patch(`/winback/account/${id}/stage`, { stage, ...extra });

export const updateWinbackLead = (id: string, body: unknown) =>
  apiClient.patch(`/winback/account/${id}`, body);

export const promoteWinbackLead = (id: string) =>
  apiClient.patch(`/winback/account/${id}/promote`, {});

export const getWinbackContacts = (id: string) => apiClient.get(`/winback/account/${id}/contacts`);
export const addWinbackContact = (id: string, body: unknown) =>
  apiClient.post(`/winback/account/${id}/contacts`, body);
export const updateWinbackContact = (contactId: string, body: unknown) =>
  apiClient.patch(`/winback/contacts/${contactId}`, body);
export const deleteWinbackContact = (contactId: string) =>
  apiClient.delete(`/winback/contacts/${contactId}`);

export const completeWinbackActivity = (activityId: string, body: unknown) =>
  apiClient.patch(`/winback/activities/${activityId}/complete`, body);

export const winbackCheckin = (id: string, body: unknown) =>
  apiClient.post(`/winback/account/${id}/checkin`, body);
export const winbackCheckout = (
  activityId: string,
  body: {
    outcome: string;
    types: string[];
    photo_urls?: string[];
    note?: string;
  },
) => apiClient.patch(`/winback/activities/${activityId}/checkout`, body);

// Cuisine specialties (level 2) come from the existing shared `getCuisineSpecialties` (cuisine.api).

// Cuisine types come from the existing shared `getCuisineTypes` (cuisine.api).
