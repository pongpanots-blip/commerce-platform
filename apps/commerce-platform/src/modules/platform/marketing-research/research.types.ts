export const RESEARCH_KINDS = [
  'sales',
  'competitor',
  'procurement',
  'trend',
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

export function researchSourceStatus() {
  const workerConfigured =
    process.env.RESEARCH_WORKER_ENABLED === 'true' &&
    (process.env.RESEARCH_WORKER_TOKEN?.trim().length ?? 0) >= 32;
  const enabled = new Set(
    (process.env.RESEARCH_ENABLED_SOURCES ?? '')
      .split(',')
      .map((source) => source.trim()),
  );
  return RESEARCH_SOURCES.map((id) => ({
    id,
    ready: workerConfigured && enabled.has(id),
    reason:
      workerConfigured && enabled.has(id)
        ? ''
        : 'ยังไม่ได้เปิดใช้งาน connector และ worker สำหรับแหล่งนี้',
  }));
}
