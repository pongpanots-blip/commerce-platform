import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { FixturePreviewUnavailable, FixtureSegmentExecutor } from './fixture-executor';
import { previewGuidedFixture, guidedDefinition } from './guided-previews';
import { FixtureScope } from './segment-contracts';
import { FIXTURE_EVALUATED_AT as AT, fixtureEvent, FIXTURE_GRANTS, FixtureDataset, syntheticDataset, validateFixtureDataset } from './synthetic-fixtures';

const url = process.env.BA_FOUNDATION_TEST_DATABASE_URL;
const milliseconds = (offset: number) => new Date(Date.parse(AT) + offset).toISOString();
const days = (n: number) => milliseconds(-n * 86400000);
const scope = (branchIds: string[], tenantId = 'tenant_a') => FixtureScope.authorize('test', new Map([['test', { tenantId, branchIds }]]));
const count = (windowDays: number, value: number, operator = 'eq') => ({ schemaVersion: 1, ruleVersion: 1, rule: { kind: 'event_count', event: 'order_accepted', window: { kind: 'last_days', days: windowDays }, operator, value } });

(url ? describe : describe.skip)('BA foundation: owned local fixture PostgreSQL only', () => {
  let db: DataSource, executor: FixtureSegmentExecutor;
  beforeAll(async () => {
    const u = new URL(url!);
    if (u.hostname !== '127.0.0.1' || u.pathname !== '/commerce_analytics_foundation_test') throw new Error('Explicit owned fixture database required.');
    db = new DataSource({ type: 'postgres', url, synchronize: false, extra: { max: 4 } });
    executor = new FixtureSegmentExecutor(db); await db.initialize();
    await db.query(`CREATE TABLE ba_fixture_branches (tenant_id text,company_id text NOT NULL,branch_id text,created_at timestamptz,approved_at timestamptz,eligible boolean,region text,profile_as_of timestamptz,PRIMARY KEY(tenant_id,branch_id))`);
    await db.query(`CREATE TABLE ba_fixture_events (tenant_id text,event_id uuid,event_name text,company_id text,branch_id text,subject_user_id text,actor_user_id text,actor_kind text,order_id text,occurred_at timestamptz,received_at timestamptz,PRIMARY KEY(tenant_id,event_id))`);
    await db.query(`CREATE TABLE ba_fixture_coverage (tenant_id text,branch_id text,event_name text,complete_from timestamptz,complete_through timestamptz,asserted_at timestamptz,identity_complete boolean,PRIMARY KEY(tenant_id,branch_id,event_name))`);
  });
  afterAll(async () => {
    if (db?.isInitialized) { await db.query('DROP TABLE ba_fixture_coverage,ba_fixture_events,ba_fixture_branches'); await db.destroy(); }
  });
  async function load(input: FixtureDataset = syntheticDataset()) {
    const d = validateFixtureDataset(input);
    await db.transaction(async m => {
      await m.query('TRUNCATE ba_fixture_branches,ba_fixture_events,ba_fixture_coverage');
      for (const b of d.branches) await m.query('INSERT INTO ba_fixture_branches VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [b.tenantId, b.companyId, b.branchId, b.createdAt, b.approvedAt, b.eligible, b.region, b.profileAsOf]);
      for (const e of d.events) await m.query('INSERT INTO ba_fixture_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [e.context.tenantId, e.eventId, e.name, e.context.companyId, e.context.branchId, e.context.subjectUserId, e.context.actorUserId, e.context.actorKind, e.context.orderId, e.occurredAt, e.receivedAt]);
      for (const c of d.coverage) await m.query('INSERT INTO ba_fixture_coverage VALUES($1,$2,$3,$4,$5,$6,$7)', [c.tenantId, c.branchId, c.event, c.completeFrom, c.completeThrough, c.assertedAt, c.identityComplete]);
    });
  }
  beforeEach(async () => load());
  const evaluate = (rule: unknown, ids: string[] = ['repeat_inactive'], at = AT, tenantId = 'tenant_a') => executor.evaluate(rule, scope(ids, tenantId), at);
  it('matches hand-calculated guided memberships and exports real synthetic receipts without AST/SQL', async () => {
    const a = await previewGuidedFixture(executor, { template: 'approved_without_order' }, FixtureScope.authorize('analyst_a', FIXTURE_GRANTS), AT);
    const b = await previewGuidedFixture(executor, { template: 'repeat_buyers_inactive' }, FixtureScope.authorize('analyst_a', FIXTURE_GRANTS), AT);
    expect(a.preview.branches.filter(v => v.result === 'included').map(v => v.branchId)).toEqual(['first_order_waiting']);
    expect(a.preview).toMatchObject({ matchedCount: 1, excludedCount: 3, unknownCount: 4, activationAllowed: false, liveIntegrationComplete: false });
    expect(b.preview.branches.filter(v => v.result === 'included').map(v => v.branchId)).toEqual(['repeat_inactive']);
    expect(b.preview).toMatchObject({ matchedCount: 1, excludedCount: 5, unknownCount: 2 });
    const text = JSON.stringify([a, b]); expect(text).not.toMatch(/SELECT|ba_fixture_|"rule"|"parameters"|"text"/);
    const file = process.env.BA_FOUNDATION_PREVIEW_RECEIPT;
    if (file) {
      if (!file.startsWith('/workspace/commerce-ui-audit-20261009/ba-foundation-')) throw new Error('Owned receipt destination required.');
      writeFileSync(file, JSON.stringify({ fixtureOnly: true, evaluatedAt: AT, handCalculatedMembershipVerified: true, previews: [a, b] }, null, 2) + '\n');
      writeFileSync(file.replace('guided-previews.json', 'synthetic-fixtures.json'), JSON.stringify(syntheticDataset(), null, 2) + '\n');
    }
  });
  it('includes the exact window start, excludes evaluation time and rejects one millisecond outside', async () => {
    const d = syntheticDataset(); const atStart = fixtureEvent(50, 'repeat_inactive', 90);
    d.events = [atStart, fixtureEvent(51, 'repeat_inactive', 30), fixtureEvent(52, 'repeat_inactive', 20), fixtureEvent(53, 'repeat_inactive', 0), fixtureEvent(54, 'repeat_inactive', 90, { occurredAt: milliseconds(-90 * 86400000 - 1), receivedAt: milliseconds(-90 * 86400000 - 1) })];
    await load(d);
    const r = await evaluate(count(90, 3)); expect(r.matchedCount).toBe(1); expect(r.branches[0].reasons[0].observedCount).toBe(3);
  });
  it.each([[-14 * 86400000, 1], [-14 * 86400000 - 1, 0], [-14 * 86400000 + 1, 1], [0, 0]])('handles the fourteen-day boundary offset %s as count %s', async (offset, expected) => {
    const d = syntheticDataset(); d.events = [fixtureEvent(55, 'repeat_inactive', 14, { occurredAt: milliseconds(offset), receivedAt: milliseconds(offset) })]; await load(d);
    const r = await evaluate(count(14, expected)); expect(r.matchedCount).toBe(1); expect(r.branches[0].reasons[0].observedCount).toBe(expected);
  });
  it('never counts checkout attempts or selection events as accepted orders', async () => {
    const d = syntheticDataset(); d.events = Array.from({ length: 5 }, (_, i) => fixtureEvent(60 + i, 'first_order_waiting', 1, { name: i % 2 ? 'branch_selected' : 'checkout_started', acceptanceBasis: null })); await load(d);
    expect((await evaluate(count(90, 0), ['first_order_waiting'])).matchedCount).toBe(1);
    const attempts = { schemaVersion: 1, ruleVersion: 1, rule: { kind: 'event_count', event: 'checkout_started', window: { kind: 'last_days', days: 90 }, operator: 'eq', value: 3 } };
    expect((await evaluate(attempts, ['first_order_waiting'])).matchedCount).toBe(1);
  });
  it('deduplicates repeated deliveries and distinct events for the same accepted order', async () => {
    const d = syntheticDataset(), e = d.events[0];
    d.events.push({ ...e, receivedAt: AT }, { ...e, eventId: fixtureEvent(70, null, 0).eventId }); await load(d);
    const r = await evaluate(count(90, 3)); expect(r.branches[0].reasons[0].observedCount).toBe(3);
    expect((await db.query('SELECT count(*)::int AS n FROM ba_fixture_events WHERE order_id=$1', [e.context.orderId]))[0].n).toBe(2);
  });
  it('aggregates multiple customers/staff on one branch without merging a customer across branches', async () => {
    const r = await evaluate(count(90, 3), ['repeat_inactive', 'first_order_waiting']);
    expect(r.branches.map(b => [b.branchId, b.result, b.reasons[0].observedCount])).toEqual([['repeat_inactive', 'included', 3], ['first_order_waiting', 'excluded', 0]]);
    expect((await db.query('SELECT DISTINCT subject_user_id,actor_kind FROM ba_fixture_events WHERE tenant_id=$1 AND branch_id=$2', ['tenant_a', 'repeat_inactive'])).length).toBe(2);
  });
  it('isolates same branch IDs and same people in different tenants independently of the rule', async () => {
    const a = await evaluate(count(90, 3)), b = await evaluate(count(90, 5), ['repeat_inactive'], AT, 'tenant_b');
    expect(a.matchedCount).toBe(1); expect(b.matchedCount).toBe(1);
    expect(a.branches[0].companyId).toBe('company_a'); expect(b.branches[0].companyId).toBe('company_b');
    expect(JSON.stringify(a)).not.toContain('company_b'); expect(JSON.stringify(b)).not.toContain('first_order_waiting');
    const or = { schemaVersion: 1, ruleVersion: 1, rule: { kind: 'or', children: [{ kind: 'profile', field: 'eligible', operator: 'eq', value: true }, { kind: 'profile', field: 'eligible', operator: 'eq', value: false }] } };
    expect((await evaluate(or, ['repeat_inactive'], AT, 'tenant_b')).branches).toHaveLength(1);
  });
  it('keeps absent authorized IDs unknown and supports a genuinely empty authorized scope', async () => {
    expect((await evaluate(count(90, 0), ['absent_branch'])).branches[0]).toMatchObject({ branchId: 'absent_branch', result: 'unknown', companyId: null });
    expect(await evaluate(count(90, 0), [])).toMatchObject({ matchedCount: 0, excludedCount: 0, unknownCount: 0, branches: [] });
  });
  it.each([['not', 'unknown'], ['and', 'excluded'], ['or', 'included']])('preserves three-valued %s with missing eligibility as %s', async (kind, expected) => {
    const d = syntheticDataset(); d.branches.find(b => b.branchId === 'first_order_waiting')!.eligible = null; await load(d);
    const missing = { kind: 'profile', field: 'eligible', operator: 'eq', value: true };
    const rule = kind === 'not' ? { kind, child: missing } : { kind, children: [missing, { kind: 'profile', field: 'region', operator: 'eq', value: kind === 'and' ? 'other' : 'bangkok' }] };
    expect((await evaluate({ schemaVersion: 1, ruleVersion: 1, rule }, ['first_order_waiting'])).branches[0].result).toBe(expected);
  });
  it('never infers zero or first-order eligibility from truncated or incomplete history', async () => {
    const d = syntheticDataset(); for (const c of d.coverage.filter(c => c.branchId === 'first_order_waiting')) c.completeFrom = days(90); await load(d);
    const r = await evaluate(guidedDefinition({ template: 'approved_without_order' }).definition, ['first_order_waiting', 'incomplete_history']);
    expect(r.unknownCount).toBe(2); expect(r.matchedCount).toBe(0);
    expect((await evaluate(count(90, 0), ['incomplete_history'])).branches[0].reasons[0].observedCount).toBeNull();
  });
  it('requires lifetime history before approval as well as after it', async () => {
    const d = syntheticDataset(); d.events.push(fixtureEvent(80, 'first_order_waiting', 30)); await load(d);
    const r = await evaluate(guidedDefinition({ template: 'approved_without_order' }).definition, ['first_order_waiting']);
    expect(r.excludedCount).toBe(1); expect(r.branches[0].reasons[2].observedCount).toBe(1);
  });
  it.each([[-7 * 86400000, 'included'], [-7 * 86400000 + 1, 'excluded']])('handles approval boundary %s as %s', async (offset, expected) => {
    const d = syntheticDataset(); d.branches.find(b => b.branchId === 'first_order_waiting')!.approvedAt = milliseconds(offset); await load(d);
    expect((await evaluate(guidedDefinition({ template: 'approved_without_order' }).definition, ['first_order_waiting'])).branches[0].result).toBe(expected);
  });
  it.each(['createdAt', 'approvedAt', 'profileAsOf'] as const)('keeps missing %s unknown for lifetime first-order preview', async field => {
    const d = syntheticDataset(); d.branches.find(b => b.branchId === 'first_order_waiting')![field] = null; await load(d);
    expect((await evaluate(guidedDefinition({ template: 'approved_without_order' }).definition, ['first_order_waiting'])).unknownCount).toBe(1);
  });
  it('does not use future profile/coverage assertions or unbounded birth dates as known data', async () => {
    const d = syntheticDataset(); d.branches.find(b => b.branchId === 'first_order_waiting')!.profileAsOf = days(-1); await load(d);
    expect((await evaluate(count(90, 0), ['first_order_waiting'])).unknownCount).toBe(1);
    d.branches.find(b => b.branchId === 'first_order_waiting')!.profileAsOf = AT;
    d.coverage.filter(c => c.branchId === 'first_order_waiting').forEach(c => c.assertedAt = days(-1)); await load(d);
    expect((await evaluate(count(90, 0), ['first_order_waiting'])).unknownCount).toBe(1);
    expect((await evaluate(guidedDefinition({ template: 'approved_without_order' }).definition, ['old_birth'])).unknownCount).toBe(1);
  });
  it('keeps late-arrival counts unknown until receipt and a complete watermark are present', async () => {
    expect((await evaluate(count(90, 0), ['late_arrival'])).unknownCount).toBe(1);
    const next = days(-1), d = syntheticDataset(); d.coverage.forEach(c => { c.completeThrough = next; c.assertedAt = next; }); await load(d);
    const r = await evaluate(count(90, 1), ['late_arrival'], next);
    expect(r.matchedCount).toBe(1); expect(r.branches[0].reasons[0].observedCount).toBe(1);
  });
  it('does not let a late duplicate of an already observed canonical order invalidate complete history', async () => {
    const d = syntheticDataset(), e = d.events[0];
    d.events.push({ ...e, eventId: fixtureEvent(95, null, 0).eventId, receivedAt: days(-1) }); await load(d);
    expect((await evaluate(count(90, 3))).matchedCount).toBe(1);
  });
  it('cannot establish zero from a known late event whose branch is unresolved', async () => {
    const d = syntheticDataset(); d.events.push(fixtureEvent(96, null, 20, { receivedAt: days(-1) })); await load(d);
    expect((await evaluate(count(90, 0), ['first_order_waiting'])).unknownCount).toBe(1);
  });
  it('treats branch birth after its profile evidence time as unknown', async () => {
    const d = syntheticDataset(); d.events = d.events.filter(e => e.context.branchId !== 'first_order_waiting');
    d.branches.find(b => b.branchId === 'first_order_waiting')!.createdAt = days(-1); await load(d);
    expect((await evaluate(count(90, 0), ['first_order_waiting'])).unknownCount).toBe(1);
  });
  it('expires membership as evaluation time moves even without new events', async () => {
    expect((await evaluate(guidedDefinition({ template: 'repeat_buyers_inactive' }).definition)).matchedCount).toBe(1);
    const d = syntheticDataset(), next = days(-1); d.coverage.forEach(c => { c.completeThrough = next; c.assertedAt = next; }); await load(d);
    const r = await evaluate(guidedDefinition({ template: 'repeat_buyers_inactive' }).definition, ['repeat_inactive'], next);
    expect(r.excludedCount).toBe(1); expect(r.branches[0].reasons[1].observedCount).toBe(2);
  });
  it('does not establish zero when event branch/company identity is unresolved', async () => {
    const d = syntheticDataset(); d.events.push(fixtureEvent(90, null, 20)); await load(d);
    expect((await evaluate(count(90, 0), ['first_order_waiting'])).unknownCount).toBe(1);
    expect((await evaluate(count(90, 5), ['repeat_inactive'], AT, 'tenant_b')).matchedCount).toBe(1);
  });
  it('counts a known branch when customer identity is unknown, without device aliasing', async () => {
    const d = syntheticDataset(), e = fixtureEvent(91, 'first_order_waiting', 20); e.context = { ...e.context, actorUserId: null, subjectUserId: null, actorKind: 'system' }; d.events.push(e); await load(d);
    expect((await evaluate(count(90, 1), ['first_order_waiting'])).matchedCount).toBe(1);
  });
  it('treats missing identity-completeness evidence as unknown, not zero', async () => {
    const d = syntheticDataset(); d.coverage.filter(c => c.branchId === 'first_order_waiting').forEach(c => c.identityComplete = false); await load(d);
    expect((await evaluate(count(90, 0), ['first_order_waiting'])).unknownCount).toBe(1);
  });
  it('executes injection-like values as data without changing membership scope or tables', async () => {
    const payload = "bangkok' OR TRUE; DROP TABLE ba_fixture_events; --";
    const r = await evaluate({ schemaVersion: 1, ruleVersion: 1, rule: { kind: 'profile', field: 'region', operator: 'eq', value: payload } });
    expect(r).toMatchObject({ matchedCount: 0, excludedCount: 1 }); expect((await db.query('SELECT count(*)::int n FROM ba_fixture_events'))[0].n).toBeGreaterThan(0);
  });
  it('bounds blocked reads, returns a safe retryable error and succeeds after the lock clears', async () => {
    const runner = db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
    try {
      await runner.query('LOCK TABLE ba_fixture_events IN ACCESS EXCLUSIVE MODE');
      await expect(evaluate(count(90, 3))).rejects.toBeInstanceOf(FixturePreviewUnavailable);
      await expect(evaluate(count(90, 3))).rejects.toThrow('Retry after the local fixture database is ready');
    } finally { await runner.rollbackTransaction(); await runner.release(); }
    expect((await evaluate(count(90, 3))).matchedCount).toBe(1);
  });
  it('performs read-only evaluation without changing any fixture records', async () => {
    const snapshot = async () => Promise.all(['ba_fixture_branches', 'ba_fixture_events', 'ba_fixture_coverage'].map(table => db.query(`SELECT row_to_json(t) data FROM ${table} t ORDER BY row_to_json(t)::text`)));
    const before = await snapshot(); await evaluate(guidedDefinition({ template: 'repeat_buyers_inactive' }).definition); expect(await snapshot()).toEqual(before);
  });
});
