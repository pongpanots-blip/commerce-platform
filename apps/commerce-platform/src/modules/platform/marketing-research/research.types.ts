import {
  socialSourceStatus,
  type SocialSource,
} from './application/research-social.config';

export const RESEARCH_KINDS = [
  'sales',
  'competitor',
  'procurement',
  'trend',
  'content',
] as const;
export const RESEARCH_SOURCES = [
  'facebook',
  'instagram',
  'google',
  'tiktok',
  'youtube',
  'tat',
  'osm',
] as const;
export type ResearchSource = (typeof RESEARCH_SOURCES)[number];
export type ResearchKind = (typeof RESEARCH_KINDS)[number];
export type ResearchRunStatus =
  | 'waiting_configuration'
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';
export type ResearchActor = { sub: string; role: string };
export type ResearchScope = {
  title: string;
  kind: ResearchKind;
  area: string;
  days: number;
  sector: string;
  sources: ResearchSource[];
};
export type ResearchReport = {
  analysis?: ResearchAnalysis;
  summary: string;
  evidence: Array<{
    id: string;
    source: ResearchSource;
    url: string;
    excerpt: string;
    publishedAt?: string;
    collectedAt: string;
  }>;
  findings: Array<{ text: string; evidenceIds: string[] }>;
  suggestions: string[];
  limitations: string[];
  coverage: Array<{
    source: ResearchSource;
    status: 'searched' | 'unavailable';
    from?: string;
    to?: string;
    reason?: string;
  }>;
};

export type ResearchAnalysis = {
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

export const FREE_RESEARCH_SOURCES: ResearchSource[] = ['tat', 'osm'];
export const freeResearchEnabled = () =>
  !['false', '0'].includes(process.env.RESEARCH_FREE_WORKER_ENABLED ?? 'true');

/** Readiness means a collector can accept work, not a vendor health guarantee. */
export function researchSourceStatus() {
  const workerConfigured =
    process.env.RESEARCH_WORKER_ENABLED === 'true' &&
    (process.env.RESEARCH_WORKER_TOKEN?.trim().length ?? 0) >= 32;
  const enabled = new Set(
    (process.env.RESEARCH_ENABLED_SOURCES ?? '')
      .split(',')
      .map((source) => source.trim()),
  );
  return RESEARCH_SOURCES.map((id) => {
    const social =
      id !== 'tat' && id !== 'osm'
        ? socialSourceStatus(id as SocialSource)
        : null;
    const ready =
      (freeResearchEnabled() && FREE_RESEARCH_SOURCES.includes(id)) ||
      Boolean(social?.ready) ||
      (workerConfigured && enabled.has(id));
    return {
      id,
      ready,
      provider: social?.ready
        ? social.provider
        : workerConfigured && enabled.has(id)
          ? 'external-worker'
          : (social?.provider ?? 'open-data'),
      costMode: social?.costMode ?? 'free',
      setupUrl: social?.setupUrl,
      scope:
        social?.scope ?? 'ข้อมูลรายชื่อธุรกิจสาธารณะ ไม่ยืนยันความต้องการซื้อ',
      reason: ready
        ? ''
        : (social?.reason ??
          'ผู้ดูแลปิด worker ข้อมูลฟรีอยู่ ให้เปิด RESEARCH_FREE_WORKER_ENABLED แล้วรันใหม่'),
    };
  });
}
