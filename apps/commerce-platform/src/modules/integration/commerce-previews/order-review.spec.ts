import { OrderReviewInput, OrderSnapshot, reviewOrder } from './order-review';

const at = '2026-10-09T12:00:00Z';
const before = '2026-10-09T10:00:00Z';
const fixture = (): OrderReviewInput => {
  const snapshot = (source: OrderSnapshot['source']): OrderSnapshot => ({ source, id: 'order-1', version: '90071992547409931234', capturedAt: at,
    createdAt: before, changedAt: before, values: { orderNumber: 'ORDER-1', status: 'paid', totalIncVat: '107.00', paid: true } });
  return { orderId: 'order-1', at, policy: { consistencyGraceMs: 30_000, maxEvidenceAgeMs: 300_000, maxCaptureSkewMs: 30_000, pendingSyncAfterMs: 900_000 },
    josh: snapshot('josh'), commerce: snapshot('commerce'),
    sync: [{ id: 'sync-1', orderId: 'order-1', shipmentId: null, version: '2', createdAt: before, capturedAt: at, importedAt: at, status: 'sent', docNo: 'DOC-1' }],
    stockDeductions: [{ lineId: 'line-1', orderId: 'order-1', sku: 'SKU-1', ordered: 5, deducted: 5, state: 'deducted', capturedAt: at, updatedAt: before }] };
};
const codes = (p: OrderReviewInput) => reviewOrder(p).findings.map(f => f.code);

describe('order reconciliation and supported risk rules', () => {
  it('compares stable identities, arbitrary-size sequence and canonical money without a false conflict', () => {
    const p = fixture(); p.commerce!.values.totalIncVat = '107';
    const r = reviewOrder(p);
    expect(r).toMatchObject({ reconciliation: 'consistent', riskAssessment: 'no_supported_risk_observed', riskCoverage: 'complete', operationalWrites: false });
    expect(r.findings).toEqual([]);
  });
  it('distinguishes a grace window from an older version lag, including the exact boundary', () => {
    const p = fixture(); p.commerce!.version = '90071992547409931233'; p.josh!.changedAt = '2026-10-09T11:59:30Z';
    p.commerce!.values.status = 'preparing';
    expect(reviewOrder(p).reconciliation).toBe('within_grace');
    expect(codes(p)).toContain('field_difference_within_grace');
    p.josh!.changedAt = '2026-10-09T11:59:29Z';
    expect(reviewOrder(p).reconciliation).toBe('review'); expect(codes(p)).toContain('commerce_copy_behind');
  });
  it('never restarts grace at read time when source change time is absent', () => {
    const p = fixture(); p.commerce!.version = '2'; p.josh!.changedAt = null;
    const r = reviewOrder(p);
    expect(r.reconciliation).toBe('incomplete'); expect(codes(p)).toContain('change_time_unavailable');
    expect(codes(p)).toContain('commerce_copy_behind'); expect(codes(p)).not.toContain('version_difference_within_grace');
  });
  it('handles a source replica behind Commerce without declaring Commerce wrong', () => {
    const p = fixture(); p.josh!.version = '2';
    expect(codes(p)).toContain('josh_snapshot_behind');
    expect(reviewOrder(p).findings.every(f => f.certainty === 'review_required' && !f.proposal.automatic)).toBe(true);
  });
  it('reports same-version value conflicts, not just version differences', () => {
    const p = fixture(); p.commerce!.values.totalIncVat = '106.99';
    const r = reviewOrder(p); expect(r.reconciliation).toBe('review');
    expect(r.findings.find(f => f.code === 'snapshot_field_conflict')).toMatchObject({ evidence: [
      { source: 'josh', values: { totalIncVat: '107.00' } }, { source: 'commerce', values: { totalIncVat: '106.99' } },
    ], suggestedOwnerRole: 'admin', proposal: { action: 'compare_versions', automatic: false } });
  });
  it('separates newly missing copies, older missing copies, not-found and failed reads', () => {
    const p = fixture(); p.commerce = null; p.josh!.createdAt = p.josh!.changedAt = '2026-10-09T11:59:45Z';
    expect(reviewOrder(p).reconciliation).toBe('within_grace'); expect(codes(p)).toContain('snapshot_missing_within_grace');
    p.josh!.createdAt = p.josh!.changedAt = before; expect(reviewOrder(p).reconciliation).toBe('review');
    p.unavailableSources = ['commerce']; expect(reviewOrder(p).reconciliation).toBe('incomplete'); expect(codes(p)).not.toContain('snapshot_missing');
    p.josh = null; p.unavailableSources = []; expect(codes(p)).toContain('order_not_found');
  });
  it.each(['0', null, '-1', 'not-a-sequence'])('unversioned/invalid revision %s is not consistent', v => {
    const p = fixture(); p.josh!.version = v;
    expect(reviewOrder(p).reconciliation).toBe('incomplete'); expect(codes(p)).toContain('snapshot_version_unavailable');
  });
  it('rejects identity mismatch, missing money, invalid times and stale captures as gaps', () => {
    const p = fixture(); p.commerce!.id = 'other'; expect(codes(p)).toContain('snapshot_identity_mismatch');
    p.commerce!.id = p.orderId; p.commerce!.values.totalIncVat = null; expect(codes(p)).toContain('snapshot_fields_unavailable');
    p.commerce!.values.totalIncVat = '107.00'; p.commerce!.capturedAt = '2026-10-09T12:01:00Z'; expect(codes(p)).toContain('snapshot_time_invalid');
    p.commerce!.capturedAt = before; expect(codes(p)).toContain('snapshot_stale');
    p.commerce!.capturedAt = 'invalid'; expect(reviewOrder(p).reconciliation).toBe('incomplete');
  });
  it('does not compare captures taken too far apart', () => {
    const p = fixture(); p.commerce!.capturedAt = '2026-10-09T11:59:00Z';
    expect(codes(p)).toContain('capture_time_skew'); expect(reviewOrder(p).reconciliation).toBe('incomplete');
  });
  it('uses per-shipment latest attempt; one successful shipment cannot hide another failure', () => {
    const p = fixture(); p.sync![0].shipmentId = 'shipment-a'; p.sync!.push({ ...p.sync![0], id: 'sync-2', shipmentId: 'shipment-b', status: 'failed' });
    const r = reviewOrder(p); expect(r.riskAssessment).toBe('risks_observed'); expect(codes(p)).toContain('sync_attempt_reported_failed');
    p.sync!.push({ ...p.sync![1], id: 'sync-3', status: 'confirmed', createdAt: '2026-10-09T11:00:00Z' });
    expect(codes(p)).not.toContain('sync_attempt_reported_failed');
  });
  it.each(['sent', 'confirmed', 'reserved', 'skipped'])('preserves handled state %s, not a missing acknowledgement', status => {
    const p = fixture(); p.sync![0].status = status;
    expect(reviewOrder(p).findings).toEqual([]);
  });
  it('flags overdue pending attempts only with a configured threshold; missing attempt age stays unknown', () => {
    const p = fixture(); p.sync![0].status = 'pending'; p.sync![0].createdAt = '2026-10-09T11:45:00Z';
    expect(codes(p)).not.toContain('sync_acknowledgement_overdue');
    p.sync![0].createdAt = '2026-10-09T11:44:59Z'; expect(codes(p)).toContain('sync_acknowledgement_overdue');
    p.policy.pendingSyncAfterMs = null; expect(codes(p)).toContain('sync_deadline_unavailable'); expect(codes(p)).not.toContain('sync_acknowledgement_overdue');
    p.sync = []; p.policy.pendingSyncAfterMs = 1000; expect(codes(p)).toContain('sync_attempt_missing_due_time_unknown');
  });
  it('keeps data coverage partial when records are ambiguous, stale, unrecognized or truncated', () => {
    const p = fixture(); p.sync!.push({ ...p.sync![0], id: 'sync-2', status: 'failed' });
    expect(reviewOrder(p).riskCoverage).toBe('partial'); expect(codes(p)).toContain('sync_attempt_order_ambiguous');
    p.sync = [{ ...p.sync![0], orderId: 'other' }]; expect(codes(p)).toContain('sync_evidence_invalid_or_stale');
    p.sync = [{ ...fixture().sync![0], status: 'invented' }]; expect(codes(p)).toContain('sync_status_unsupported');
    p.truncatedSources = ['sync']; expect(reviewOrder(p).riskCoverage).toBe('partial');
  });
  it('does not hide known risks when other sources are unavailable', () => {
    const p = fixture(); p.stockDeductions = null; p.sync![0].status = 'failed';
    const r = reviewOrder(p); expect(r).toMatchObject({ reconciliation: 'consistent', riskAssessment: 'risks_observed', riskCoverage: 'partial' });
    expect(codes(p)).toContain('stock_evidence_unavailable');
  });
  it('a fresh read cannot renew stale copied sync data or silently hide an unknown import time', () => {
    const p = fixture(); p.sync![0].importedAt = before;
    expect(codes(p)).toContain('sync_copy_freshness_unavailable_or_stale'); expect(reviewOrder(p).riskCoverage).toBe('partial');
    p.sync![0].importedAt = null; expect(reviewOrder(p).riskAssessment).toBe('incomplete');
  });
  it('duplicate input records retain conflict evidence with unique stable finding IDs', () => {
    const p = fixture(); p.sync!.push({ ...p.sync![0], status: 'failed' }, { ...p.sync![0], status: 'pending' });
    const r = reviewOrder(p); const duplicates = r.findings.filter(f => f.code === 'sync_evidence_invalid_or_stale');
    expect(duplicates).toHaveLength(1); expect(duplicates[0].evidence).toHaveLength(2);
    expect(new Set(r.findings.map(f => f.id)).size).toBe(r.findings.length); expect(r.riskCoverage).toBe('partial');
  });
  it('shows recorded deduction shortfall as review evidence, not a forecast or automatic repair', () => {
    const p = fixture(); p.stockDeductions![0].deducted = 3;
    const r = reviewOrder(p); expect(r.riskAssessment).toBe('risks_observed');
    expect(r.findings[0]).toMatchObject({ code: 'recorded_stock_deduction_shortfall', ageMs: 7_200_000,
      proposal: { action: 'inspect_stock_deduction', link: '/j/order/order-1', automatic: false } });
    p.stockDeductions![0].deducted = NaN; expect(codes(p)).toContain('stock_deduction_invalid_or_stale');
    p.stockDeductions = []; expect(reviewOrder(p).riskCoverage).toBe('partial');
  });
  it('does not run settled-order rules for cancelled/refunded or inconsistent snapshots', () => {
    const p = fixture(); p.sync![0].status = 'failed'; p.stockDeductions![0].deducted = 1;
    p.josh!.values.status = p.commerce!.values.status = 'cancelled'; expect(reviewOrder(p).findings).toEqual([]);
    p.josh!.values.status = 'paid'; p.commerce!.values.status = 'paid'; p.commerce!.version = '1';
    expect(reviewOrder(p).findings.every(f => f.classification !== 'order_risk')).toBe(true);
  });
  it('is deterministic, does not mutate evidence and fails malformed policies before work', () => {
    const p = fixture(); const beforeJson = JSON.stringify(p);
    expect(reviewOrder(p)).toEqual(reviewOrder(p)); expect(JSON.stringify(p)).toBe(beforeJson);
    p.policy.consistencyGraceMs = -1; expect(() => reviewOrder(p)).toThrow('invalid_review_policy');
    p.policy.consistencyGraceMs = NaN; expect(() => reviewOrder(p)).toThrow('invalid_review_policy');
  });
});
