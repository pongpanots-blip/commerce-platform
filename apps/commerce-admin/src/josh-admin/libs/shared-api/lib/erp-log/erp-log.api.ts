import { apiClient } from '../api-client/api-client';

/** ตรงกับ ErpLogListItem ใน apps/backend/src/app/erp-log/erp-log-query.service.ts */
export type ErpInboundLogRow = {
  id: string;
  endpoint: string;
  method: string;
  statusCode: number;
  isSuccess: boolean;
  durationMs: number;
  summary?: string;
  createdAt: string;
};

export type ErpInboundLogDetail = ErpInboundLogRow & {
  url: string;
  ip?: string;
  request?: unknown;
  query?: unknown;
  response?: unknown;
  errorMessage?: string;
};

export type ErpInboundLogPage = {
  items: ErpInboundLogRow[];
  total: number;
  page: number;
  limit: number;
};

export type GetErpInboundLogsParams = {
  endpoint?: string;
  status?: 'ok' | 'fail' | 'all';
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  limit?: number;
};

/** ตรงกับ path ใน apps/backend/src/app/erp/erp-webhook.controller.ts */
export const ERP_LOG_ENDPOINTS = [
  'orders/status',
  'invoices/status',
  'quotations',
  'quotations/status',
  'products',
  'products/bulk',
  'products/image',
  'products/qty',
  'products/moq',
  'products/price',
  'customers',
  'companies',
];

export const getErpInboundLogs = async (
  params: GetErpInboundLogsParams = {},
) => {
  const response = await apiClient.get<{ data: ErpInboundLogPage }>(
    '/erp-logs',
    { params },
  );
  return response;
};

export const getErpInboundLog = async (id: string) => {
  const response = await apiClient.get<{ data: ErpInboundLogDetail }>(
    `/erp-logs/${id}`,
  );
  return response;
};
