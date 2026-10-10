import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CommercePromotionDrafts1796200000000 } from '../../../migrations/1796200000000-CommercePromotionDrafts';
import { PromotionDraftsService } from './promotion-drafts.service';
import { PromotionInputsService } from './promotion-inputs.service';
const url = process.env.PROMOTION_PLANNING_TEST_DATABASE_URL;
const scenario = { name: 'Local proposal', line: { sku: 'SKU', quantity: 2, unit: 'PC', quantityKind: 'count' }, proposedValue: { type: 'percentage', percent: 10 }, minimumGrossMarginPercent: null };
(url ? describe : describe.skip)('promotion proposal persistence (fresh scratch PostgreSQL)', () => {
  let db: DataSource, service: PromotionDraftsService; let draftId: string;
  const migration = new CommercePromotionDrafts1796200000000();
  beforeAll(async () => {
    const parsed = new URL(url!); if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/commerce_preview_test') throw new Error('Use the explicitly created local scratch database only');
    db = await new DataSource({ type: 'postgres', url, synchronize: false, extra: { max: 4 } }).initialize();
    await migration.up(db.createQueryRunner());
    await db.query('CREATE TABLE josh_catalog_products(id uuid, sku text, selling_unit text, packaging_type text, pack_size text, vat_type text, selling_unit_price numeric(12,2), source_version bigint, synced_at timestamptz, removed_at timestamptz)');
    await db.query('CREATE TABLE product_promotion_rules(sku text, rules jsonb, shadow_rules jsonb, version bigint, shadow_version bigint, lock jsonb, lock_version bigint)');
    await db.query(`INSERT INTO josh_catalog_products VALUES($1,'SKU','PC','fixed','1 PC','7%',107,5,now(),NULL)`, [randomUUID()]);
    await db.query(`INSERT INTO product_promotion_rules VALUES('SKU','[]','[]',1,1,NULL,1)`);
    service = new PromotionDraftsService(db, new PromotionInputsService(db));
  });
  afterAll(async () => { if (db?.isInitialized) { await db.query('DROP TABLE josh_catalog_products, product_promotion_rules'); await migration.down(db.createQueryRunner()); await db.destroy(); } });
  it('serializes duplicate create clicks into one persisted draft and recovers the committed request', async () => {
    const requestId = randomUUID();
    const replies = await Promise.all([service.create({ requestId, scenario }, 'actor-a'), service.create({ requestId, scenario }, 'actor-a')]);
    draftId = replies[0].id; expect(replies[1].id).toBe(draftId); expect(replies.map(r => r.replayed).sort()).toEqual([false, true]);
    expect(replies[0]).toMatchObject({ revision: 1, saved: true, persisted: true, activationAllowed: false, preview: { persisted: false, status: 'incomplete' } });
    expect((await db.query('SELECT count(*)::int n FROM commerce_promotion_drafts'))[0].n).toBe(1);
    expect(await service.request(requestId, 'actor-a')).toMatchObject({ id: draftId, revision: 1 });
    await expect(service.create({ requestId, scenario: { ...scenario, name: 'different' } }, 'actor-a')).rejects.toThrow('different operation');
  });
  it('makes actor scope authoritative and returns useful empty data', async () => {
    expect(await service.list('actor-b')).toEqual({ items: [], next: null });
    await expect(service.get(draftId, 'actor-b')).rejects.toThrow('not found');
    const id = randomUUID(); await expect(service.request(id, 'actor-a')).rejects.toThrow('not found');
  });
  it('uses version preconditions for concurrent editors and keeps immutable replay receipts', async () => {
    const a = randomUUID(), b = randomUUID();
    const outcomes = await Promise.allSettled([service.update(draftId, { requestId: a, revision: 1, scenario: { ...scenario, name: 'A' } }, 'actor-a'),
      service.update(draftId, { requestId: b, revision: 1, scenario: { ...scenario, name: 'B' } }, 'actor-a')]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter(r => r.status === 'rejected')).toHaveLength(1);
    const saved = (outcomes.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof service.update>>>).value;
    expect(saved.revision).toBe(2); expect(await service.get(draftId, 'actor-a')).toMatchObject({ revision: 2 });
    const winner = saved.scenario as { name: string }; const key = winner.name === 'A' ? a : b;
    const replay = await service.update(draftId, { requestId: key, revision: 1, scenario: { ...scenario, name: winner.name } }, 'actor-a');
    expect(replay).toMatchObject({ id: draftId, revision: 2, replayed: true });
  });
  it('rolls back the draft if its durable recovery receipt cannot be stored', async () => {
    await db.query(`CREATE FUNCTION fail_local_draft_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'local receipt failure'; END $$`);
    await db.query('CREATE TRIGGER fail_receipt BEFORE INSERT ON commerce_promotion_draft_requests FOR EACH ROW EXECUTE FUNCTION fail_local_draft_receipt()');
    const before = (await db.query('SELECT count(*)::int n FROM commerce_promotion_drafts'))[0].n;
    const requestId = randomUUID(); await expect(service.create({ requestId, scenario }, 'actor-a')).rejects.toThrow('Reconcile the request ID');
    expect((await db.query('SELECT count(*)::int n FROM commerce_promotion_drafts'))[0].n).toBe(before);
    await expect(service.request(requestId, 'actor-a')).rejects.toThrow('not found');
    await db.query('DROP TRIGGER fail_receipt ON commerce_promotion_draft_requests'); await db.query('DROP FUNCTION fail_local_draft_receipt()');
    expect(await service.create({ requestId, scenario }, 'actor-a')).toMatchObject({ saved: true, revision: 1, replayed: false });
  });
  it('rejects malformed bodies before transactions, retains source state and paginates without fake completion', async () => {
    await expect(service.create({ requestId: randomUUID(), scenario: { ...scenario, actorId: 'actor-b' } }, 'actor-a')).rejects.toThrow();
    for (let n = 0; n < 21; n++) await service.create({ requestId: randomUUID(), scenario }, 'paging-actor');
    const page = await service.list('paging-actor'); expect(page.items).toHaveLength(20); expect(page.next).not.toBeNull(); expect((await service.list('paging-actor', page.next!)).items).toHaveLength(1);
    expect((await db.query(`SELECT selling_unit_price::text price FROM josh_catalog_products WHERE sku='SKU'`))[0].price).toBe('107.00');
    expect((await db.query(`SELECT rules FROM product_promotion_rules WHERE sku='SKU'`))[0].rules).toEqual([]);
  });
});
