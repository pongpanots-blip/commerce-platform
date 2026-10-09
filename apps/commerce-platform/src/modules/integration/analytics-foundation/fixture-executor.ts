import { DataSource } from 'typeorm';
import { compileFixtureSegment, CompiledAtom } from './segment-compiler';
import { FixtureScope, SEGMENT_LIMITS } from './segment-contracts';

export type Membership = 'included' | 'excluded' | 'unknown';
export interface ConditionEvidence { result: Membership; description: string; observedCount?: number | null }
export interface BranchMembership { branchId: string; companyId: string | null; result: Membership; reasons: ConditionEvidence[] }
export interface FixtureSegmentPreview {
  schemaVersion: 1; ruleVersion: number; evaluatedAt: string; mode: 'synthetic_fixture';
  matchedCount: number; excludedCount: number; unknownCount: number;
  dataFreshness: { source: 'synthetic_fixture'; coverageAssertions: Array<{ branchId: string; event: string; completeFrom: string; completeThrough: string; assertedAt: string; identityComplete: boolean }>; profileAsOf: Array<{ branchId: string; asOf: string | null }>; note: string };
  branches: BranchMembership[];
  activationAllowed: false; liveIntegrationComplete: false;
}
const membership = (v: unknown): Membership => v === true ? 'included' : v === false ? 'excluded' : 'unknown';
export class FixturePreviewUnavailable extends Error {
  readonly retryable = true;
  constructor() { super('Synthetic preview unavailable. Retry after the local fixture database is ready.'); }
}
const iso = (v: unknown): string | null => v instanceof Date ? v.toISOString() : typeof v === 'string' ? new Date(v).toISOString() : null;
function evidence(atom: CompiledAtom, row: Record<string, unknown>): ConditionEvidence {
  const n = atom.predicate, result = membership(row[atom.alias]);
  const comparison = n.operator === 'eq' ? 'equals' : n.operator === 'gte' ? 'is at least' : n.operator === 'lte' ? 'is at most' : n.operator === 'ne' ? 'differs from' : 'is at least this old';
  const description = n.kind === 'event_count'
    ? `${n.event === 'order_accepted' ? 'Confirmed order count' : n.event === 'checkout_started' ? 'Checkout attempt count' : 'Branch selection count'} ${comparison} ${n.value}; ${n.window.kind === 'last_days' ? `last ${n.window.days} days` : `complete branch lifetime within ${n.window.maxDays} days`}. ${result === 'unknown' ? 'History, identity or interval completeness is unverified.' : 'Complete scoped interval.'}`
    : `${n.field === 'approvedAt' ? `Approval is at least ${n.value} days old` : n.field === 'eligible' ? `Branch must be ${n.value ? 'eligible' : 'ineligible'}` : `Region ${comparison} ${n.value}`}. ${result === 'unknown' ? 'Profile evidence is unverified.' : ''}`.trim();
  return { result, description, ...(atom.countAlias ? { observedCount: typeof row[atom.countAlias] === 'number' ? row[atom.countAlias] as number : null } : {}) };
}

/** Unregistered, fixture-only executor. Refuses non-local/non-owned database configuration. */
export class FixtureSegmentExecutor {
  constructor(private readonly db: DataSource) {
    const o = db.options as { type?: string; url?: string; host?: string; database?: string; replication?: unknown; extra?: Record<string, unknown> };
    if (o.type !== 'postgres' || !o.url) throw new Error('An explicit owned local fixture PostgreSQL URL is required.');
    const u = new URL(o.url);
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.hostname !== '127.0.0.1' || u.pathname !== '/commerce_analytics_foundation_test' || u.search ||
      (o.host !== undefined && o.host !== '127.0.0.1') || (o.database !== undefined && o.database !== 'commerce_analytics_foundation_test') || o.replication ||
      Object.keys(o.extra ?? {}).some(k => k !== 'max')) throw new Error('Only the owned local analytics fixture database is allowed.');
  }
  async evaluate(raw: unknown, scope: FixtureScope, evaluatedAt: unknown): Promise<FixtureSegmentPreview> {
    const plan = compileFixtureSegment(raw, scope, evaluatedAt);
    const evidenceEvents = [...new Set(plan.atoms.filter(a => a.predicate.kind === 'event_count').map(a => (a.predicate as { event: string }).event))];
    const answer = await this.db.transaction('REPEATABLE READ', async m => {
      await m.query('SET TRANSACTION READ ONLY');
      await m.query(`SET LOCAL statement_timeout = '${SEGMENT_LIMITS.statementTimeoutMs}ms'`);
      await m.query(`SET LOCAL lock_timeout = '500ms'`);
      const rows: Array<Record<string, unknown>> = await m.query(plan.text, plan.values);
      if (rows.length > SEGMENT_LIMITS.maxBranches) throw new Error('Fixture projection exceeded branch limit.');
      const coverage: Array<Record<string, unknown>> = await m.query(`SELECT branch_id,event_name,complete_from,complete_through,asserted_at,identity_complete FROM ba_fixture_coverage
        WHERE tenant_id=$1 AND branch_id=ANY($2::text[]) AND event_name=ANY($3::text[]) AND asserted_at <= $4::timestamptz ORDER BY branch_id,event_name LIMIT 301`, [scope.tenantId, [...scope.branchIds], evidenceEvents, plan.evaluatedAt]);
      if (coverage.length > 300) throw new Error('Fixture coverage exceeded row limit.');
      return { rows, coverage };
    }).catch(() => { throw new FixturePreviewUnavailable(); });
    const byId = new Map(answer.rows.map(r => [String(r.branch_id), r]));
    const branches: BranchMembership[] = scope.branchIds.map(branchId => {
      const row = byId.get(branchId);
      return row ? { branchId, companyId: String(row.company_id), result: membership(row.membership), reasons: plan.atoms.map(a => evidence(a, row)) }
        : { branchId, companyId: null, result: 'unknown', reasons: [{ result: 'unknown', description: 'Authorized branch identity has no fixture profile.' }] };
    });
    return { schemaVersion: 1, ruleVersion: plan.definition.ruleVersion, evaluatedAt: plan.evaluatedAt, mode: 'synthetic_fixture',
      matchedCount: branches.filter(b => b.result === 'included').length, excludedCount: branches.filter(b => b.result === 'excluded').length, unknownCount: branches.filter(b => b.result === 'unknown').length,
      dataFreshness: { source: 'synthetic_fixture', coverageAssertions: answer.coverage.map(c => ({ branchId: String(c.branch_id), event: String(c.event_name), completeFrom: iso(c.complete_from)!, completeThrough: iso(c.complete_through)!, assertedAt: iso(c.asserted_at)!, identityComplete: c.identity_complete === true })),
        profileAsOf: scope.branchIds.map(branchId => ({ branchId, asOf: iso(byId.get(branchId)?.profile_as_of) })), note: 'Synthetic completeness watermarks only; evaluation/read time is not source freshness. Intervals include their start and exclude evaluation time.' },
      branches, activationAllowed: false, liveIntegrationComplete: false };
  }
}
