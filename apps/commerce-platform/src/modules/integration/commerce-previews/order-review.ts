/** Read-only evidence rules. Nothing here fetches a URL, mutates an order, retries a send, or assigns an owner. */
export interface OrderSnapshot {
  source: 'josh' | 'commerce'; id: string; version: string | null;
  capturedAt: string; createdAt: string; changedAt: string | null;
  storedAt?: string | null;
  values: { orderNumber: string | null; status: string; totalIncVat: string | null; paid: boolean | null };
}
export interface SyncEvidence {
  id: string; orderId: string; shipmentId: string | null; version: string | null;
  capturedAt: string; importedAt: string | null; createdAt: string; status: string; docNo: string | null;
}
export interface StockDeductionEvidence {
  lineId: string; orderId: string; sku: string | null; ordered: number;
  deducted: number; state: string; capturedAt: string; updatedAt: string;
}
export interface OrderReviewInput {
  orderId: string; at: string;
  policy: { consistencyGraceMs: number; maxEvidenceAgeMs: number; maxCaptureSkewMs: number; pendingSyncAfterMs: number | null };
  josh: OrderSnapshot | null; commerce: OrderSnapshot | null;
  // null means unavailable; [] is a successfully read empty scope.
  sync: SyncEvidence[] | null; stockDeductions: StockDeductionEvidence[] | null;
  unavailableSources?: string[];
  truncatedSources?: string[];
}
export interface ReviewFinding {
  id: string; code: string; classification: 'data_gap' | 'consistency_risk' | 'order_risk';
  certainty: 'review_required'; ageMs: number | null;
  suggestedOwnerRole: 'admin';
  evidence: Array<{ source: string; id: string; version: string | null; capturedAt: string; values: Record<string, unknown> }>;
  proposal: { action: 'inspect_source' | 'compare_versions' | 'check_sync_receipt' | 'inspect_stock_deduction';
    automatic: false; requiresReview: true; link: string };
}
export interface OrderReviewResult {
  mode: 'review'; operationalWrites: false; at: string; orderId: string;
  reconciliation: 'consistent' | 'within_grace' | 'review' | 'incomplete';
  riskAssessment: 'no_supported_risk_observed' | 'risks_observed' | 'incomplete';
  riskCoverage: 'complete' | 'partial';
  findings: ReviewFinding[];
}
const syncHandled = new Set(['sent', 'confirmed', 'reserved', 'skipped']); // JoshOrders' existing handled states.
const settled = new Set(['paid', 'preparing', 'shipped', 'delivered']);
const otherSupported = new Set(['payment_pending', 'cancelled', 'refunded']);
const validInstant = (s: string | null) => s != null && Number.isFinite(Date.parse(s));
const revision = (v: string | null) => v != null && /^[1-9]\d{0,39}$/.test(v) ? BigInt(v) : null;
const amount = (v: string | null) => {
  if (v == null || !/^\d{1,12}(\.\d{1,2})?$/.test(v)) return null;
  const [whole, frac = ''] = v.split('.'); return BigInt(whole) * BigInt(100) + BigInt(frac.padEnd(2, '0'));
};

/** Same stable order ID and sequence domain only. Timestamp/grace rules never turn a risk into certain failure. */
export function reviewOrder(input: OrderReviewInput): OrderReviewResult {
  if (!validInstant(input.at) || !input.orderId || input.orderId.length > 128) throw new Error('invalid_review_context');
  for (const [key, value] of Object.entries(input.policy)) {
    if (key === 'pendingSyncAfterMs' && value === null) continue;
    if (!Number.isSafeInteger(value) || value! < 0 || value! > 31_536_000_000) throw new Error('invalid_review_policy');
  }
  const now = Date.parse(input.at);
  const result: OrderReviewResult = { mode: 'review', operationalWrites: false, at: input.at, orderId: input.orderId,
    reconciliation: 'consistent', riskAssessment: 'no_supported_risk_observed', riskCoverage: 'complete', findings: [] };
  const orderLink = `/j/order/${encodeURIComponent(input.orderId)}`;
  const findingIds = new Map<string, ReviewFinding>();
  const add = (code: string, classification: ReviewFinding['classification'], id: string,
    evidence: ReviewFinding['evidence'], action: ReviewFinding['proposal']['action'], since: string | null = null) => {
    const findingId = `${input.orderId}:${code}:${id}`;
    const existing = findingIds.get(findingId);
    if (existing) {
      for (const e of evidence) if (!existing.evidence.some(x => JSON.stringify(x) === JSON.stringify(e))) existing.evidence.push(e);
      return;
    }
    const finding: ReviewFinding = { id: findingId, code, classification, certainty: 'review_required',
      ageMs: validInstant(since) ? Math.max(0, now - Date.parse(since!)) : null,
      suggestedOwnerRole: 'admin', evidence, proposal: { action, automatic: false, requiresReview: true, link: orderLink } };
    result.findings.push(finding); findingIds.set(findingId, finding);
  };
  const snapshotEvidence = (s: OrderSnapshot) => ({ source: s.source, id: s.id, version: s.version, capturedAt: s.capturedAt, values: { ...s.values, storedAt: s.storedAt ?? null } });
  let snapshotsUsable = true;
  for (const source of input.unavailableSources ?? []) {
    add('source_unavailable', 'data_gap', source, [], 'inspect_source');
    if (source === 'josh' || source === 'commerce') snapshotsUsable = false;
  }
  for (const source of input.truncatedSources ?? []) add('source_scope_truncated', 'data_gap', source, [], 'inspect_source');
  for (const [expected, s] of [['josh', input.josh], ['commerce', input.commerce]] as const) {
    if (!s) continue;
    if (s.source !== expected || s.id !== input.orderId) {
      add('snapshot_identity_mismatch', 'data_gap', expected, [snapshotEvidence(s)], 'inspect_source'); snapshotsUsable = false;
    }
    if (!validInstant(s.capturedAt) || !validInstant(s.createdAt) || Date.parse(s.capturedAt) > now || Date.parse(s.createdAt) > now ||
      (s.changedAt != null && (!validInstant(s.changedAt) || Date.parse(s.changedAt) > now || Date.parse(s.changedAt) < Date.parse(s.createdAt)))) {
      add('snapshot_time_invalid', 'data_gap', expected, [snapshotEvidence(s)], 'inspect_source'); snapshotsUsable = false;
    } else if (now - Date.parse(s.capturedAt) > input.policy.maxEvidenceAgeMs) {
      add('snapshot_stale', 'data_gap', expected, [snapshotEvidence(s)], 'inspect_source', s.capturedAt); snapshotsUsable = false;
    }
    if (!s.values.status || amount(s.values.totalIncVat) == null || typeof s.values.paid !== 'boolean') {
      add('snapshot_fields_unavailable', 'data_gap', expected, [snapshotEvidence(s)], 'inspect_source'); snapshotsUsable = false;
    }
  }
  const source = input.josh, copy = input.commerce;
  let withinGrace = false;
  if (!source && !copy && !(input.unavailableSources ?? []).some(s => s === 'josh' || s === 'commerce')) {
    add('order_not_found', 'data_gap', 'both', [], 'inspect_source'); snapshotsUsable = false;
  } else if ((!source || !copy) && snapshotsUsable) {
    const present = (source ?? copy)!;
    withinGrace = now - Date.parse(present.createdAt) <= input.policy.consistencyGraceMs;
    add(withinGrace ? 'snapshot_missing_within_grace' : 'snapshot_missing', 'consistency_risk', present.source,
      [snapshotEvidence(present)], 'inspect_source', present.createdAt);
  } else if (source && copy && snapshotsUsable) {
    const both = [snapshotEvidence(source), snapshotEvidence(copy)];
    if (Math.abs(Date.parse(source.capturedAt) - Date.parse(copy.capturedAt)) > input.policy.maxCaptureSkewMs) {
      add('capture_time_skew', 'data_gap', 'pair', both, 'inspect_source'); snapshotsUsable = false;
    } else {
      const a = revision(source.version), b = revision(copy.version);
      if (a == null || b == null) add('snapshot_version_unavailable', 'data_gap', 'pair', both, 'compare_versions');
      if (a != null && b != null && a !== b) {
        const newest = a > b ? source : copy;
        // Unknown change time must not start a new grace period on every read.
        withinGrace = validInstant(newest.changedAt) && now - Date.parse(newest.changedAt!) <= input.policy.consistencyGraceMs;
        add(withinGrace ? 'version_difference_within_grace' : a > b ? 'commerce_copy_behind' : 'josh_snapshot_behind',
          'consistency_risk', 'version', both, 'compare_versions', newest.changedAt);
        if (newest.changedAt == null) add('change_time_unavailable', 'data_gap', 'version', both, 'compare_versions');
      }
      const fields: Array<keyof OrderSnapshot['values']> = ['orderNumber', 'status', 'totalIncVat', 'paid'];
      for (const field of fields) {
        const same = field === 'totalIncVat' ? amount(source.values.totalIncVat) === amount(copy.values.totalIncVat)
          : source.values[field] === copy.values[field];
        if (!same) add(withinGrace ? 'field_difference_within_grace' : 'snapshot_field_conflict', 'consistency_risk', field,
          both.map(e => ({ ...e, values: { [field]: e.values[field] } })), 'compare_versions', source.changedAt);
      }
    }
  }
  const snapshotProblems = result.findings.filter(f => f.classification !== 'order_risk');
  result.reconciliation = !snapshotsUsable || snapshotProblems.some(f => f.classification === 'data_gap' &&
    !['source_scope_truncated', 'source_unavailable'].includes(f.code)) ? 'incomplete'
    : snapshotProblems.some(f => f.classification === 'consistency_risk' && !f.code.endsWith('within_grace')) ? 'review'
    : withinGrace ? 'within_grace' : 'consistent';
  // Stock and sync source failures do not erase an otherwise usable order comparison.
  if (!source || !copy) result.riskAssessment = 'incomplete';
  const riskOrder = snapshotsUsable && result.reconciliation === 'consistent' ? (copy ?? source) : null;
  if (input.sync == null) { add('sync_evidence_unavailable', 'data_gap', 'sync', [], 'inspect_source'); result.riskAssessment = 'incomplete'; }
  if (input.stockDeductions == null) { add('stock_evidence_unavailable', 'data_gap', 'stock', [], 'inspect_source'); result.riskAssessment = 'incomplete'; }
  if (!riskOrder || result.reconciliation !== 'consistent') result.riskAssessment = 'incomplete';
  if (riskOrder && !settled.has(riskOrder.values.status) && !otherSupported.has(riskOrder.values.status)) {
    add('order_status_unsupported_for_risk_rules', 'data_gap', 'order_status', [snapshotEvidence(riskOrder)], 'inspect_source'); result.riskAssessment = 'incomplete';
  }
  if (riskOrder && settled.has(riskOrder.values.status)) {
    if (!riskOrder.values.paid) add('settled_status_without_payment_evidence', 'order_risk', 'payment', [snapshotEvidence(riskOrder)], 'inspect_source');
    const groups = new Map<string, SyncEvidence>();
    const seen = new Set<string>();
    for (const s of input.sync ?? []) {
      const ev = { source: 'commerce_sync', id: s.id, version: s.version, capturedAt: s.capturedAt,
        values: { orderId: s.orderId, shipmentId: s.shipmentId, status: s.status, createdAt: s.createdAt, importedAt: s.importedAt, docNo: s.docNo } };
      if (!s.id || s.id.length > 128 || s.orderId !== input.orderId || seen.has(s.id) || !validInstant(s.createdAt) || !validInstant(s.capturedAt) ||
        Date.parse(s.createdAt) > now || Date.parse(s.capturedAt) > now || now - Date.parse(s.capturedAt) > input.policy.maxEvidenceAgeMs) {
        add('sync_evidence_invalid_or_stale', 'data_gap', s.id, [ev], 'inspect_source'); result.riskAssessment = 'incomplete'; continue;
      }
      seen.add(s.id);
      if (!validInstant(s.importedAt) || Date.parse(s.importedAt!) > Date.parse(s.capturedAt) ||
        Date.parse(s.importedAt!) < Date.parse(s.createdAt) || now - Date.parse(s.importedAt!) > input.policy.maxEvidenceAgeMs) {
        add('sync_copy_freshness_unavailable_or_stale', 'data_gap', s.id, [ev], 'inspect_source', s.importedAt);
        result.riskAssessment = 'incomplete'; continue;
      }
      const key = s.shipmentId ?? 'order';
      const current = groups.get(key);
      if (current && Date.parse(current.createdAt) === Date.parse(s.createdAt) && current.status !== s.status) {
        add('sync_attempt_order_ambiguous', 'data_gap', key, [ev], 'check_sync_receipt'); result.riskAssessment = 'incomplete';
      }
      if (!current || Date.parse(current.createdAt) < Date.parse(s.createdAt) || (Date.parse(current.createdAt) === Date.parse(s.createdAt) && current.id < s.id)) groups.set(key, s);
    }
    for (const s of groups.values()) {
      const ev = { source: 'commerce_sync', id: s.id, version: s.version, capturedAt: s.capturedAt,
        values: { status: s.status, shipmentId: s.shipmentId, importedAt: s.importedAt, docNo: s.docNo } };
      if (s.status === 'failed') add('sync_attempt_reported_failed', 'order_risk', s.id, [ev], 'check_sync_receipt', s.createdAt);
      else if (s.status === 'pending' && input.policy.pendingSyncAfterMs != null && now - Date.parse(s.createdAt) > input.policy.pendingSyncAfterMs)
        add('sync_acknowledgement_overdue', 'order_risk', s.id, [ev], 'check_sync_receipt', s.createdAt);
      else if (!syncHandled.has(s.status) && s.status !== 'pending') { add('sync_status_unsupported', 'data_gap', s.id, [ev], 'check_sync_receipt'); result.riskAssessment = 'incomplete'; }
    }
    if ((input.sync?.length === 0 || [...groups.values()].some(s => s.status === 'pending')) && input.policy.pendingSyncAfterMs == null) {
      add('sync_deadline_unavailable', 'data_gap', 'sync', [], 'check_sync_receipt'); result.riskAssessment = 'incomplete';
    }
    // Missing attempt age is not the order creation age; paid/sending time is not supplied by these snapshots.
    if (input.sync?.length === 0) { add('sync_attempt_missing_due_time_unknown', 'data_gap', 'sync', [], 'check_sync_receipt'); result.riskAssessment = 'incomplete'; }
    const lines = new Set<string>();
    if (input.stockDeductions?.length === 0) { add('stock_deduction_scope_empty', 'data_gap', 'stock', [], 'inspect_stock_deduction'); result.riskAssessment = 'incomplete'; }
    for (const s of input.stockDeductions ?? []) {
      const ev = { source: 'order_stock_moves', id: s.lineId, version: null, capturedAt: s.capturedAt,
        values: { sku: s.sku, ordered: s.ordered, deducted: s.deducted, state: s.state, updatedAt: s.updatedAt } };
      if (!s.lineId || s.lineId.length > 128 || s.orderId !== input.orderId || lines.has(s.lineId) || !Number.isSafeInteger(s.ordered) || s.ordered < 0 || !Number.isSafeInteger(s.deducted) || s.deducted < 0 ||
        !validInstant(s.capturedAt) || !validInstant(s.updatedAt) || Date.parse(s.capturedAt) > now || Date.parse(s.updatedAt) > now || now - Date.parse(s.capturedAt) > input.policy.maxEvidenceAgeMs) {
        add('stock_deduction_invalid_or_stale', 'data_gap', s.lineId, [ev], 'inspect_stock_deduction'); result.riskAssessment = 'incomplete'; continue;
      }
      lines.add(s.lineId);
      if (s.state === 'deducted' && s.deducted < s.ordered) add('recorded_stock_deduction_shortfall', 'order_risk', s.lineId, [ev], 'inspect_stock_deduction', s.updatedAt);
      else if (s.state === 'returned') add('stock_deduction_returned_for_settled_order', 'order_risk', s.lineId, [ev], 'inspect_stock_deduction', s.updatedAt);
      else if (s.state !== 'deducted' && s.state !== 'returned') { add('stock_deduction_state_unsupported', 'data_gap', s.lineId, [ev], 'inspect_stock_deduction'); result.riskAssessment = 'incomplete'; }
    }
  }
  if ((input.truncatedSources?.length ?? 0) || (input.unavailableSources?.length ?? 0)) result.riskAssessment = 'incomplete';
  result.riskCoverage = result.riskAssessment === 'incomplete' ? 'partial' : 'complete';
  if (result.findings.some(f => f.classification === 'order_risk')) result.riskAssessment = 'risks_observed';
  result.findings.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}
