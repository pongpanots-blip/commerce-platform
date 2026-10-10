import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { FixtureSegmentExecutor } from '../analytics-foundation/fixture-executor';
import { FixtureScope } from '../analytics-foundation/segment-contracts';
import { FIXTURE_EVALUATED_AT, FIXTURE_GRANTS, syntheticDataset } from '../analytics-foundation/synthetic-fixtures';
import { GuidedAnalysisService } from './guided-analysis.service';

const url = process.env.BA_FOUNDATION_TEST_DATABASE_URL;
const tables = ['ba_fixture_branches', 'ba_fixture_events', 'ba_fixture_coverage'] as const;
/** Fresh owned namespace only; cleanup removes this exact generated namespace and preserves existing fixtures. */
(url ? describe : describe.skip)('guided analysis: native executor through owned test-source injection', () => {
  let db: DataSource, service: GuidedAnalysisService, baseline: unknown, schemaCreated = false;
  const schema = 'guided_analysis_fixture_' + randomUUID().replace(/-/g, '');
  const staff = (id: string) => ({ userId: id, role: 'business_analyst' as const, email: 'fixture@example.invalid' });
  async function publicSnapshot() {
    const values = [];
    for (const table of tables) {
      const [exists] = await db.query('SELECT to_regclass($1) IS NOT NULL AS present', ['public.' + table]);
      values.push({ table, rows: exists.present ? await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`) : null });
    }
    return values;
  }
  async function ownedSnapshot() {
    const values = [];
    for (const table of tables) values.push(await db.query(`SELECT to_jsonb(t) AS row FROM ${schema}.${table} t ORDER BY to_jsonb(t)::text`));
    return values;
  }
  beforeAll(async () => {
    db = new DataSource({ type: 'postgres', url, synchronize: false, extra: { max: 1 } });
    const executor = new FixtureSegmentExecutor(db); // Refuses non-owned URL/driver configuration before connecting.
    await db.initialize(); baseline = await publicSnapshot();
    if (!/^guided_analysis_fixture_[a-f0-9]{32}$/.test(schema)) throw Error('Invalid owned fixture namespace');
    await db.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    // A single owned connection keeps a session-only fixture path; no app database configuration is changed.
    await db.query(`SET search_path TO ${schema}`);
    await db.query('CREATE TABLE ba_fixture_branches (tenant_id text,company_id text NOT NULL,branch_id text,created_at timestamptz,approved_at timestamptz,eligible boolean,region text,profile_as_of timestamptz,PRIMARY KEY(tenant_id,branch_id))');
    await db.query('CREATE TABLE ba_fixture_events (tenant_id text,event_id uuid,event_name text,company_id text,branch_id text,subject_user_id text,actor_user_id text,actor_kind text,order_id text,occurred_at timestamptz,received_at timestamptz,PRIMARY KEY(tenant_id,event_id))');
    await db.query('CREATE TABLE ba_fixture_coverage (tenant_id text,branch_id text,event_name text,complete_from timestamptz,complete_through timestamptz,asserted_at timestamptz,identity_complete boolean,PRIMARY KEY(tenant_id,branch_id,event_name))');
    const data = syntheticDataset();
    await db.transaction(async m => {
      for (const b of data.branches) await m.query('INSERT INTO ba_fixture_branches VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [b.tenantId, b.companyId, b.branchId, b.createdAt, b.approvedAt, b.eligible, b.region, b.profileAsOf]);
      for (const e of data.events) await m.query('INSERT INTO ba_fixture_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [e.context.tenantId, e.eventId, e.name, e.context.companyId, e.context.branchId, e.context.subjectUserId, e.context.actorUserId, e.context.actorKind, e.context.orderId, e.occurredAt, e.receivedAt]);
      for (const c of data.coverage) await m.query('INSERT INTO ba_fixture_coverage VALUES($1,$2,$3,$4,$5,$6,$7)', [c.tenantId, c.branchId, c.event, c.completeFrom, c.completeThrough, c.assertedAt, c.identityComplete]);
    });
    service = new GuidedAnalysisService({ purpose: 'owned_local_fixture', evaluate: (definition, actor) => executor.evaluate(definition, FixtureScope.authorize(actor.userId, FIXTURE_GRANTS), FIXTURE_EVALUATED_AT) });
  });
  afterAll(async () => {
    if (db?.isInitialized) {
      try { expect(await publicSnapshot()).toEqual(baseline); }
      finally {
        try {
          await db.query('RESET search_path');
          if (schemaCreated && /^guided_analysis_fixture_[a-f0-9]{32}$/.test(schema)) await db.query(`DROP SCHEMA ${schema} CASCADE`);
        } finally { await db.destroy(); }
      }
    }
  });
  it.each([
    ['approved_without_order', { matched: 1, excluded: 3, unknown: 4 }, 'first_order_waiting'],
    ['repeat_buyers_inactive', { matched: 1, excluded: 5, unknown: 2 }, 'repeat_inactive'],
  ])('preserves native hand-calculated %s membership and readable evidence', async (template, counts, included) => {
    const before = await ownedSnapshot(), value = await service.preview({ template }, staff('analyst_a'));
    expect(value.counts).toEqual(counts); expect(value.branches.filter(b => b.result === 'included').map(b => b.branchId)).toEqual([included]);
    expect(value).toMatchObject({ mode: 'synthetic_fixture', evaluatedAt: FIXTURE_EVALUATED_AT, activationAllowed: false, operationalWrites: false, liveIntegrationComplete: false });
    expect(JSON.stringify(value)).not.toMatch(/SELECT|ba_fixture_|"rule"|"parameters"|"text"/);
    expect(await ownedSnapshot()).toEqual(before);
  });
  it('uses server fixture grants to isolate same branch identifiers in another tenant', async () => {
    const value = await service.preview({ template: 'repeat_buyers_inactive' }, staff('analyst_b'));
    expect(value.branches.map(b => b.branchId)).toEqual(['repeat_inactive']); expect(value.counts).toEqual({ matched: 0, excluded: 1, unknown: 0 });
    expect(value.branches[0].companyId).toBe('company_b');
  });
  it('preserves incomplete and late-arrival history as unknown rather than zero', async () => {
    const value = await service.preview({ template: 'repeat_buyers_inactive' }, staff('analyst_a'));
    for (const id of ['incomplete_history', 'late_arrival']) {
      const b = value.branches.find(branch => branch.branchId === id)!; expect(b.result).toBe('unknown');
      expect(b.reasons.filter(r => r.observedCount !== undefined).some(r => r.observedCount === null)).toBe(true);
    }
  });
  it('cannot override server grants or evaluation time from query fields', async () => {
    const before = await ownedSnapshot();
    for (const extra of [{ tenantId: 'tenant_b' }, { branchIds: ['repeat_inactive'] }, { evaluatedAt: '2030-01-01T00:00:00.000Z' }, { principalId: 'analyst_b' }]) await expect(service.preview({ template: 'repeat_buyers_inactive', ...extra }, staff('analyst_a'))).rejects.toThrow('supported template');
    expect(await ownedSnapshot()).toEqual(before);
  });
  it('unknown fixture principals cannot query branch evidence', async () => {
    await expect(service.preview({ template: 'repeat_buyers_inactive' }, staff('not_granted'))).rejects.toThrow('evidence unavailable');
  });
});
