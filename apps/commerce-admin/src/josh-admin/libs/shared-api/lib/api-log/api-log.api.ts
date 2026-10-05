import { apiClient } from '../api-client/api-client';

/** ตรงกับ ApiLogSource ใน apps/backend/src/app/api-log/api-log-normalize.util.ts */
export type ApiLogSource = 'internal' | 'jagota' | 'kbank' | 'erp_webhook';

/** ตรงกับ ApiLogListItem ใน apps/backend/src/app/api-log/api-log-query.service.ts */
export type ApiLogRow = {
  id: string;
  method: string;
  url: string;
  statusCode: number;
  isSuccess: boolean;
  durationMs: number;
  message: string;
  createdAt: string;
  source: ApiLogSource;
  requestId: string | null;
  userId: string | null;
};

export type ApiLogDetail = ApiLogRow & {
  errorMessage?: string;
  response?: unknown;
  payload?: unknown;
  query?: unknown;
  ip?: string;
  steps?: Array<{ label: string; ms: number }>;
};

export type ApiLogPage = {
  items: ApiLogRow[];
  total: number;
  page: number;
  limit: number;
};

export type ApiLogStats = {
  from: string;
  to: string;
  bucketMs: number;
  buckets: Array<{
    start: string;
    count: number;
    errors: number;
    avgMs: number;
    maxMs: number;
  }>;
  topEndpoints: Array<{
    method: string;
    route: string;
    count: number;
    errors: number;
    avgMs: number;
    maxMs: number;
  }>;
};

export type GetApiLogsParams = {
  status?: 'all' | '2xx' | '4xx' | '5xx';
  source?: 'all' | ApiLogSource;
  method?: 'all' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
  minDurationMs?: number;
  requestId?: string;
  userId?: string;
  sort?: 'newest' | 'slowest';
};

export const getApiLogs = async (params: GetApiLogsParams = {}) => {
  const response = await apiClient.get<{ data: ApiLogPage }>('/api-logs', {
    params,
  });
  return response;
};

export const getApiLog = async (id: string) => {
  const response = await apiClient.get<{ data: ApiLogDetail }>(
    `/api-logs/${id}`,
  );
  return response;
};

export const getApiLogStats = async (params: GetApiLogsParams = {}) => {
  const response = await apiClient.get<{ data: ApiLogStats }>('/api-logs/stats', {
    params,
  });
  return response;
};
