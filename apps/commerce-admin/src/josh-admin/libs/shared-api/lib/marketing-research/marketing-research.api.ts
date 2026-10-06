import axios, { type AxiosResponse } from 'axios';
import { apiClient } from '../api-client/api-client';

export type MarketingResearchKind =
  | 'sales'
  | 'competitor'
  | 'procurement'
  | 'trend'
  | 'content';
export type MarketingResearchSource =
  | 'facebook'
  | 'instagram'
  | 'google'
  | 'tiktok'
  | 'youtube'
  | 'tat'
  | 'osm';
export type MarketingResearchDraft = {
  title: string;
  kind: MarketingResearchKind;
  area: string;
  days: number;
  sector: string;
  sources: MarketingResearchSource[];
  followHourly: boolean;
};
export type MarketingResearchTopic = MarketingResearchDraft & {
  id: string;
  version: number;
  createdBy: string;
  canManage?: boolean;
  nextRunAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type MarketingResearchSourceStatus = {
  id: MarketingResearchSource;
  ready: boolean;
  reason: string;
  provider?: string;
  costMode?: 'free' | 'free-quota' | 'credit';
  setupUrl?: string;
  scope?: string;
};
export type MarketingResearchTopicDetail = MarketingResearchTopic & {
  canManage: boolean;
  sourceStatus: MarketingResearchSourceStatus[];
};
export type MarketingResearchRunStatus =
  | 'waiting_configuration'
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';
export type MarketingResearchReport = {
  analysis?: {
    status:
      | 'queued'
      | 'running'
      | 'completed'
      | 'not_configured'
      | 'unavailable'
      | 'insufficient_data';
    provider: 'gemini';
    model?: string;
    keyAlias?: string;
    generatedAt?: string;
    sampleSize: number;
    summary: string;
    findings: Array<{ text: string; evidenceIds: string[] }>;
    suggestions: Array<{ text: string; evidenceIds: string[] }>;
    reason: string;
    requestId?: string;
    requestedAt?: string;
    leaseExpiresAt?: string;
    attempts?: number;
  };
  summary: string;
  evidence: Array<{
    id: string;
    source: MarketingResearchSource;
    url: string;
    excerpt: string;
    publishedAt?: string;
    collectedAt: string;
  }>;
  findings: Array<{ text: string; evidenceIds: string[] }>;
  suggestions: string[];
  limitations: string[];
  coverage: Array<{
    source: MarketingResearchSource;
    status: 'searched' | 'unavailable';
    from?: string;
    to?: string;
    reason?: string;
  }>;
};
export type MarketingResearchRunSummary = {
  id: string;
  topicId: string;
  topicVersion: number;
  status: MarketingResearchRunStatus;
  message: string;
  attempts: number;
  findingsCount: number;
  keptBy: string | null;
  keptAt: string | null;
  createdAt: string;
  finishedAt: string | null;
};
export type MarketingResearchRun = MarketingResearchRunSummary & {
  scope: Omit<MarketingResearchDraft, 'followHourly'>;
  availableSources: MarketingResearchSource[];
  report: MarketingResearchReport | null;
};
export type MarketingResearchPage<T> = {
  items: T[];
  totalCount: number;
  page: number;
  limit: number;
};
type Envelope<T> = { status: 200; data: T; message: string };

/** HTTP 200 with a failure message is an error, never an empty/successful list. */
async function researchResponse<T>(
  request: Promise<AxiosResponse<Envelope<T>>>,
): Promise<T> {
  try {
    const { data: body } = await request;
    if (
      !body ||
      body.status !== 200 ||
      typeof body.message !== 'string' ||
      body.data === undefined
    )
      throw new Error('คำตอบจาก Research ไม่ถูกต้อง กรุณาลองโหลดใหม่');
    if (body.message) throw new Error(body.message);
    return body.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const message: unknown = error.response?.data?.message;
      if (typeof message === 'string') throw new Error(message);
      if (Array.isArray(message))
        throw new Error(
          message.filter((item) => typeof item === 'string').join(' · '),
        );
      throw new Error(
        'เชื่อมต่อ Research ไม่ได้ กรุณาตรวจ backend และลองอีกครั้ง',
      );
    }
    throw error;
  }
}

const root = '/marketing-research';
export const listMarketingResearchTopics = (params: {
  page: number;
  limit: number;
  kind?: MarketingResearchKind;
}) =>
  researchResponse<MarketingResearchPage<MarketingResearchTopic>>(
    apiClient.get(`${root}/topics`, { params }),
  );
export const getMarketingResearchTopic = (id: string) =>
  researchResponse<MarketingResearchTopicDetail>(
    apiClient.get(`${root}/topics/${id}`),
  );
export const createMarketingResearchTopic = (
  draft: MarketingResearchDraft & { requestId?: string },
) =>
  researchResponse<MarketingResearchTopic>(
    apiClient.post(`${root}/topics`, draft),
  );
export const updateMarketingResearchTopic = (
  id: string,
  draft: MarketingResearchDraft & { version: number },
) =>
  researchResponse<MarketingResearchTopic>(
    apiClient.patch(`${root}/topics/${id}`, draft),
  );
export const archiveMarketingResearchTopic = (id: string, version: number) =>
  researchResponse<MarketingResearchTopic>(
    apiClient.post(`${root}/topics/${id}/archive`, { version }),
  );
export const requestMarketingResearchRun = (id: string, requestId: string) =>
  researchResponse<MarketingResearchRun>(
    apiClient.post(`${root}/topics/${id}/runs`, { requestId }),
  );
export const listMarketingResearchRuns = (
  id: string,
  params: { page: number; limit: number },
) =>
  researchResponse<MarketingResearchPage<MarketingResearchRunSummary>>(
    apiClient.get(`${root}/topics/${id}/runs`, { params }),
  );
export const getMarketingResearchRun = (id: string) =>
  researchResponse<MarketingResearchRun>(apiClient.get(`${root}/runs/${id}`));
export const keepMarketingResearchRun = (id: string) =>
  researchResponse<MarketingResearchRun>(
    apiClient.post(`${root}/runs/${id}/keep`),
  );
export const summarizeMarketingResearchRun = (id: string, requestId: string) =>
  researchResponse<MarketingResearchRun>(
    apiClient.post(`${root}/runs/${id}/summarize`, { requestId }),
  );
export const getMarketingResearchSources = () =>
  researchResponse<MarketingResearchSourceStatus[]>(
    apiClient.get(`${root}/sources`),
  );
