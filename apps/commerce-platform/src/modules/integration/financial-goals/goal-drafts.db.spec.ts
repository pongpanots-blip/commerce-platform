import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { GoalInputsService } from './goal-inputs.service';
import { GoalDraftsService } from './goal-drafts.service';
import { fixtureGoalScenario } from './goal-fixtures';
import { PackDraftsService } from '../pack-price-planning/pack-drafts.service';
import { comparePacks } from '../pack-price-planning/pack-price';
import { fixtureInputs, fixtureScenario } from '../pack-price-planning/pack-fixtures';
import { PromotionDraftsService } from '../promotion-planning/promotion-drafts.service';
import { PromotionInputsService } from '../promotion-planning/promotion-inputs.service';
const url = process.env.GOAL_PLANNING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('financial goals in existing private draft infrastructure (owned synthetic SQL)', () => {
  let db: DataSource, goals: GoalDraftsService, inputs: GoalInputsService, packs: PackDraftsService, promotions: PromotionDraftsService, draftId: string, firstRequest: string;
  const reports = { available: true, source: 'copies', dashboard: async () => ({ gmv: 10700, target: { set: true, baht: 20000 } }) };
  beforeAll(async () => {
    const parsed = new URL(url!); if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/commerce_preview_test' || parsed.port !== process.env.GOAL_FIXTURE_PORT || process.env.GOAL_FIXTURE_OWNED !== 'commerce-pack-price-20261009') throw Error('Explicit owned localhost synthetic fixture only');
    const schema = `financial_goal_fixture_${randomUUID().replace(/-/g, '')}`;
    db = await new DataSource({ type: 'postgres', url, synchronize: false, extra: { max: 4, options: `-c search_path=${schema}` } }).initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    // Fixture-only SQL copies existing owned table definitions. No migration import/execution or application schema change.
    for (const table of ['commerce_promotion_drafts', 'commerce_promotion_draft_requests', 'josh_catalog_products', 'product_promotion_rules']) await db.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    // LIKE does not copy foreign keys; reproduce the existing reference in this test namespace only.
    await db.query('ALTER TABLE commerce_promotion_draft_requests ADD CONSTRAINT goal_fixture_draft_reference FOREIGN KEY(draft_id) REFERENCES commerce_promotion_drafts(id)');
    await db.query('INSERT INTO josh_catalog_products SELECT * FROM public.josh_catalog_products'); await db.query('INSERT INTO product_promotion_rules SELECT * FROM public.product_promotion_rules');
    inputs = new GoalInputsService(reports as never); goals = new GoalDraftsService(db, inputs);
    packs = new PackDraftsService(db, { preview: async (s: unknown) => ({ scenario: s, inputs: fixtureInputs(), preview: comparePacks(s as ReturnType<typeof fixtureScenario>, fixtureInputs()) }) } as never);
    promotions = new PromotionDraftsService(db, new PromotionInputsService(db));
  });
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });
  const scenario = async () => fixtureGoalScenario(await inputs.inputs('2026-10'));
  it('serializes duplicate submissions into one private draft with immutable committed recovery', async () => {
    firstRequest = randomUUID(); const body = { requestId: firstRequest, scenario: await scenario() };
    const replies = await Promise.all([goals.create(body, 'goal-fixture-actor'), goals.create(body, 'goal-fixture-actor')]); draftId = replies[0].id;
    expect(replies.map(r => r.replayed).sort()).toEqual([false, true]); expect(replies[1].id).toBe(draftId); expect(replies[0]).toMatchObject({ revision: 1, persisted: true, operationalWrites: false, activationAllowed: false, preview: { actual: null, achievementPercent: null } });
    expect((await db.query("SELECT count(*)::int n FROM commerce_promotion_drafts WHERE scenario->>'kind'='financial_goal'"))[0].n).toBe(1);
    expect(await goals.request(firstRequest, 'goal-fixture-actor')).toMatchObject({ id: draftId, revision: 1 });
    await expect(goals.create({ ...body, scenario: { ...body.scenario, name: 'Different intent' } }, 'goal-fixture-actor')).rejects.toThrow('different goal operation');
  });
  it('isolates actors and all three scenario kinds and prevents cross-kind request-key reuse', async () => {
    await expect(goals.get(draftId, 'other-fixture-actor')).rejects.toThrow('not found'); expect(await goals.list('other-fixture-actor')).toEqual({ items: [], next: null });
    for (const other of [packs, promotions]) { await expect(other.get(draftId, 'goal-fixture-actor')).rejects.toThrow('not found'); await expect(other.request(firstRequest, 'goal-fixture-actor')).rejects.toThrow('not found'); expect(await other.list('goal-fixture-actor')).toEqual({ items: [], next: null }); }
    const packKey = randomUUID(), pack = await packs.create({ requestId: packKey, scenario: fixtureScenario() }, 'goal-fixture-actor');
    await expect(goals.get(pack.id, 'goal-fixture-actor')).rejects.toThrow('not found'); await expect(goals.request(packKey, 'goal-fixture-actor')).rejects.toThrow('not found');
    await expect(goals.create({ requestId: packKey, scenario: await scenario() }, 'goal-fixture-actor')).rejects.toThrow('different goal operation');
    await expect(packs.create({ requestId: firstRequest, scenario: fixtureScenario() }, 'goal-fixture-actor')).rejects.toThrow('different planning operation');
    await expect(goals.update(pack.id, { requestId: randomUUID(), revision: 1, scenario: await scenario() }, 'goal-fixture-actor')).rejects.toThrow('not found');
  });
  it('CAS allows one concurrent editor and original create replay survives later changes', async () => {
    const base = await scenario(); const outcomes = await Promise.allSettled([goals.update(draftId, { requestId: randomUUID(), revision: 1, scenario: { ...base, name: 'Editor A' } }, 'goal-fixture-actor'), goals.update(draftId, { requestId: randomUUID(), revision: 1, scenario: { ...base, name: 'Editor B' } }, 'goal-fixture-actor')]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1); expect(await goals.get(draftId, 'goal-fixture-actor')).toMatchObject({ revision: 2 });
    const old = await goals.request(firstRequest, 'goal-fixture-actor'); expect(await goals.create({ requestId: firstRequest, scenario: old.scenario }, 'goal-fixture-actor')).toMatchObject({ id: draftId, revision: 1, replayed: true });
  });
  it('changed native GMV context blocks a new save without draft/receipt but preserves committed replay', async () => {
    const old = await scenario(), key = randomUUID(), count = (await goals.list('goal-fixture-actor')).items.length; reports.dashboard = async () => ({ gmv: 10800, target: { set: true, baht: 20000 } });
    await expect(goals.create({ requestId: key, scenario: old }, 'goal-fixture-actor')).rejects.toThrow('context changed'); expect((await goals.list('goal-fixture-actor')).items).toHaveLength(count); await expect(goals.request(key, 'goal-fixture-actor')).rejects.toThrow('not found');
    const committed = await goals.request(firstRequest, 'goal-fixture-actor'); expect(await goals.create({ requestId: firstRequest, scenario: committed.scenario }, 'goal-fixture-actor')).toMatchObject({ revision: 1, replayed: true }); reports.dashboard = async () => ({ gmv: 10700, target: { set: true, baht: 20000 } });
  });
  it('receipt failure rolls back the draft and retries the exact confirmed-absent intent safely', async () => {
    await db.query("CREATE FUNCTION fail_goal_fixture_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.receipt->'scenario'->>'kind'='financial_goal' THEN RAISE EXCEPTION 'fixture receipt failure'; END IF; RETURN NEW; END $$"); await db.query('CREATE TRIGGER fail_goal_receipt BEFORE INSERT ON commerce_promotion_draft_requests FOR EACH ROW EXECUTE FUNCTION fail_goal_fixture_receipt()');
    const count = (await goals.list('goal-fixture-actor')).items.length, body = { requestId: randomUUID(), scenario: await scenario() };
    try { await expect(goals.create(body, 'goal-fixture-actor')).rejects.toThrow('Check the original request'); expect((await goals.list('goal-fixture-actor')).items).toHaveLength(count); await expect(goals.request(body.requestId, 'goal-fixture-actor')).rejects.toThrow('not found'); }
    finally { await db.query('DROP TRIGGER fail_goal_receipt ON commerce_promotion_draft_requests'); await db.query('DROP FUNCTION fail_goal_fixture_receipt()'); }
    expect(await goals.create(body, 'goal-fixture-actor')).toMatchObject({ persisted: true, revision: 1, replayed: false });
  });
  it('paginates this owner/kind only, preserving prior Pack and original operational data', async () => {
    const s = await scenario(); for (let n = 0; n < 21; n++) await goals.create({ requestId: randomUUID(), scenario: s }, 'goal-paging-fixture-actor');
    const page = await goals.list('goal-paging-fixture-actor'); expect(page.items).toHaveLength(20); expect(page.next).not.toBeNull(); expect((await goals.list('goal-paging-fixture-actor', page.next!)).items).toHaveLength(1); expect(await packs.list('goal-paging-fixture-actor')).toEqual({ items: [], next: null });
    expect((await packs.list('goal-fixture-actor')).items).toHaveLength(1); expect((await db.query('SELECT ordering_price::text price FROM josh_catalog_products'))[0].price).toBe('107.00'); expect((await db.query('SELECT rules FROM product_promotion_rules'))[0].rules).toEqual([]);
  });
});
