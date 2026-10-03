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
    const ready =
      (freeResearchEnabled() && FREE_RESEARCH_SOURCES.includes(id)) ||
      (workerConfigured && enabled.has(id));
    return {
      id,
      ready,
      reason: ready
        ? ''
        : 'ยังไม่ได้เชื่อมแหล่งข้อมูลนี้ เลือก ททท. หรือ OpenStreetMap เพื่อเริ่มค้นจากฐานรายชื่อฟรี',
    };
  });
}
