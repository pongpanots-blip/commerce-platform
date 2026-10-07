/** Type-only API contract. Money is THB, nullable when unverified. */
export type GrowthTemplate = 'cart_idle' | 'reorder' | 'winback' | 'market';
export type GrowthStatus = 'draft' | 'review' | 'approved' | 'exporting' | 'ready' | 'export_unknown';
export interface GrowthEvidence {
  id: string; source: string; title: string; url: string | null;
  collectedAt: string; excerpt: string;
}
export interface GrowthContent { label: string; title: string; body: string; evidenceIds: string[] }
export interface GrowthPlanInput {
  title: string; goal: string; template: GrowthTemplate;
  owner: string; segmentIds: string[]; excludeSegmentIds: string[];
  productSkus: string[]; notifyTemplateKey: string | null;
  scheduleAt: string | null; budgetThb: number; minimumMarginPercent: number;
  holdoutPercent: number; cooldownDays: number; conversionWindowDays: number;
  variants: GrowthContent[]; selectedVariant: number;
  researchTopicId: string | null; researchRunId: string | null;
  analysisId?: string | null;
}
export interface GrowthTask { id: string; title: string; owner: string; dueAt: string | null; done: boolean }
export interface GrowthPlanPage { items: GrowthPlan[]; totalCount: number; page: number; limit: number }
export interface GrowthHistory { at: string; actor: string; action: string; version: number }
export interface GrowthPlan extends GrowthPlanInput {
  id: string; version: number; status: GrowthStatus; createdBy: string;
  approvedBy: string | null; approvedVersion: number | null; workflowId: string | null;
  evidence: GrowthEvidence[]; tasks: GrowthTask[]; history: GrowthHistory[];
  createdAt: string; updatedAt: string; canManage: boolean;
}
export interface GrowthReadiness {
  ai: boolean; workflow: boolean;
  /** Shop data reachable (josh's replica, or commerce's copies when dataSource = copies). */
  replica: boolean;
  dataSource?: 'replica' | 'copies';
  activationBlockers: string[];
}
export interface GrowthMetric { key: string; label: string; value: number | null; unit: 'THB' | 'percent' | 'count' | 'hours'; note: string }
export interface GrowthOpportunity {
  id: string; title: string; reason: string; template: GrowthTemplate;
  priority: 'high' | 'medium'; evidenceIds: string[]; href: string | null;
}
export interface GrowthWorkspace {
  generatedAt: string; period: { from: string; to: string }; availability: 'ready' | 'partial' | 'unavailable';
  metrics: GrowthMetric[]; opportunities: GrowthOpportunity[]; evidence: GrowthEvidence[]; limitations: string[];
}
export interface GrowthResults {
  workflowId: string; name: string; generatedAt: string;
  funnel: { label: string; count: number }[];
  attributedRevenueThb: number | null; contributionThb: number | null; missingCosts: string[];
  experiment: {
    sent: { enrolled: number; converted: number }; holdout: { enrolled: number; converted: number };
    rateDifferencePoints: number | null; confidence: 'insufficient' | 'inconclusive' | 'positive' | 'negative';
    note: string;
  };
  operations: { label: string; count: number }[]; limitations: string[]; suggestions: string[];
}
export interface GrowthTimeline {
  companyId: string; name: string; generatedAt: string;
  events: { id: string; at: string; kind: string; title: string; href: string | null }[];
  limitations: string[];
}
export interface GrowthAiDraft { variants: GrowthContent[]; rationale: string; evidenceIds: string[] }
export interface MarketAnalysisInput { question: string; area: string; days: number }
export interface MarketAnalysisReport extends MarketAnalysisInput {
  id: string; createdBy: string; createdAt: string; summary: string;
  findings: { title: string; detail: string; kind: 'fact' | 'hypothesis'; evidenceIds: string[] }[];
  recommendations: { id: string; title: string; why: string; nextStep: string; successMetric: string; productSkus: string[]; evidenceIds: string[] }[];
  evidence: GrowthEvidence[];
  trace: { tool: string; status: 'read' | 'unavailable'; detail: string }[];
  limitations: string[];
}
