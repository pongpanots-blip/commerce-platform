import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CommercePromotionDrafts1796200000000 } from '../../../migrations/1796200000000-CommercePromotionDrafts';
import { PromotionDraftsService } from '../promotion-planning/promotion-drafts.service';
import { PromotionInputsService } from '../promotion-planning/promotion-inputs.service';
import { CompetitorPricesService, catalogFingerprint } from '../competitor-prices/competitor-prices.service';
import { toInventoryShape } from '../competitor-prices/catalog-shape';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { fixtureScenario } from './pack-fixtures';
import { PackInputsService } from './pack-inputs.service';
import { PackDraftsService } from './pack-drafts.service';

const url = process.env.PACK_PLANNING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('pack drafts in existing infrastructure (owned synthetic PostgreSQL)', () => {
  let db: DataSource, packs: PackDraftsService, promotions: PromotionDraftsService, inputs: PackInputsService, pair: Record<string, unknown>, draftId: string, firstRequest: string;
  const product = { id: '00000000-0000-4000-8000-000000000001', sku: 'SYNTHETIC-SKU', status: 'active', sellingUnit: 'PK', packSize: '1 KG', packagingType: 'fixed', vatType: '7%', orderingPrice: '107.00', translations: [], brandName: null, weightPerUnit: '1 KG', joshUpdatedAt: new Date(), syncedAt: new Date() } as unknown as JoshCatalogProduct;
  const promotionScenario = { name: 'Synthetic isolated promotion', line: { sku: product.sku, quantity: 1, unit: 'PK', quantityKind: 'count' }, proposedValue: null, minimumGrossMarginPercent: null };
  beforeAll(async () => {
    const parsed = new URL(url!); if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/commerce_preview_test' || parsed.port !== process.env.PACK_FIXTURE_PORT || process.env.PACK_FIXTURE_OWNED !== 'commerce-pack-price-20261009') throw Error('Explicit owned localhost synthetic fixture only');
    const schema = `pack_fixture_${randomUUID().replace(/-/g, '')}`;
    db = await new DataSource({ type: 'postgres', url, synchronize: false, extra: { max: 4, options: `-c search_path=${schema}` } }).initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    // Existing migration only in a fresh owned test namespace. Earlier fixture rows stay untouched.
    await new CommercePromotionDrafts1796200000000().up(db.createQueryRunner());
    await db.query('CREATE TABLE josh_catalog_products(id uuid, sku text, selling_unit text, packaging_type text, pack_size text, vat_type text, ordering_price numeric(12,2), source_version bigint, synced_at timestamptz, removed_at timestamptz)');
    await db.query('CREATE TABLE product_promotion_rules(sku text,rules jsonb,shadow_rules jsonb,version bigint,shadow_version bigint,lock jsonb,lock_version bigint)');
    await db.query("INSERT INTO josh_catalog_products VALUES($1,$2,'PK','fixed','1 KG','7%',107,1,now(),NULL)", [product.id, product.sku]);
    await db.query("INSERT INTO product_promotion_rules VALUES($1,'[]','[]',1,1,NULL,1)", [product.sku]);
    pair = { id: '00000000-0000-4000-8000-000000000002', revision: 1, product, ourWeightKg: '1', competitorWeightKg: '1', competitorUnit: 'kg', competitorQtyMin: null, competitorQtyMax: null, competitorPackCount: 1, sourceUrl: 'https://www.bigc.co.th/synthetic-product', competitorName: 'Synthetic pack', sourceContext: 'Synthetic baht inclusive price', priceIncVat: '100.00', observedAt: new Date(), captureMethod: 'manual', vatIncluded: true, verifiedFingerprint: catalogFingerprint(toInventoryShape(product)), scrapingSource: null };
    const competitors = new CompetitorPricesService({ find: async () => [pair] } as never, { find: async () => [product] } as never, { configured: false } as never, {} as never);
    inputs = new PackInputsService(competitors); packs = new PackDraftsService(db, inputs); promotions = new PromotionDraftsService(db, new PromotionInputsService(db));
  });
  afterAll(async () => { if (db?.isInitialized) await db.destroy(); });
  const scenario = async () => fixtureScenario(await inputs.inputs(product.sku));
  it('serializes duplicate submissions into one persisted draft and an immutable recovery receipt', async () => {
    firstRequest = randomUUID(); const body = { requestId: firstRequest, scenario: await scenario() };
    const replies = await Promise.all([packs.create(body, 'pack-fixture-actor'), packs.create(body, 'pack-fixture-actor')]); draftId = replies[0].id;
    expect(replies.map(r => r.replayed).sort()).toEqual([false, true]); expect(replies[1].id).toBe(draftId);
    expect(replies[0]).toMatchObject({ revision: 1, status: 'draft', saved: true, persisted: true, operationalWrites: false, activationAllowed: false, inputs: { cost: null } });
    expect((await db.query("SELECT count(*)::int n FROM commerce_promotion_drafts WHERE scenario->>'kind'='pack_price'"))[0].n).toBe(1);
    expect(await packs.request(firstRequest, 'pack-fixture-actor')).toMatchObject({ id: draftId, revision: 1 });
    await expect(packs.create({ ...body, scenario: { ...body.scenario, name: 'Different intent' } }, 'pack-fixture-actor')).rejects.toThrow('different planning operation');
  });
  it('isolates authenticated owners and separates promotion/pack rows and request recovery', async () => {
    await expect(packs.get(draftId, 'other-fixture-actor')).rejects.toThrow('not found'); expect(await packs.list('other-fixture-actor')).toEqual({ items: [], next: null });
    await expect(promotions.get(draftId, 'pack-fixture-actor')).rejects.toThrow('not found'); await expect(promotions.request(firstRequest, 'pack-fixture-actor')).rejects.toThrow('not found');
    expect(await promotions.list('pack-fixture-actor')).toEqual({ items: [], next: null });
    const key = randomUUID(), promotion = await promotions.create({ requestId: key, scenario: promotionScenario }, 'pack-fixture-actor');
    await expect(packs.get(promotion.id, 'pack-fixture-actor')).rejects.toThrow('not found'); await expect(packs.request(key, 'pack-fixture-actor')).rejects.toThrow('not found');
    expect((await packs.list('pack-fixture-actor')).items).toHaveLength(1); expect((await promotions.list('pack-fixture-actor')).items).toHaveLength(1);
    await expect(promotions.update(draftId, { requestId: randomUUID(), revision: 1, scenario: promotionScenario }, 'pack-fixture-actor')).rejects.toThrow('not found');
    await expect(packs.update(promotion.id, { requestId: randomUUID(), revision: 1, scenario: await scenario() }, 'pack-fixture-actor')).rejects.toThrow('not found');
    await expect(packs.create({ requestId: key, scenario: await scenario() }, 'pack-fixture-actor')).rejects.toThrow('different planning operation');
    await expect(promotions.create({ requestId: firstRequest, scenario: promotionScenario }, 'pack-fixture-actor')).rejects.toThrow('different operation');
  });
  it('CAS permits one concurrent editor and replays the original create even after later edits', async () => {
    const base = await scenario(), a = randomUUID(), b = randomUUID();
    const outcomes = await Promise.allSettled([packs.update(draftId, { requestId: a, revision: 1, scenario: { ...base, name: 'Editor A' } }, 'pack-fixture-actor'), packs.update(draftId, { requestId: b, revision: 1, scenario: { ...base, name: 'Editor B' } }, 'pack-fixture-actor')]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1); expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1); expect(await packs.get(draftId, 'pack-fixture-actor')).toMatchObject({ revision: 2 });
    const original = await packs.request(firstRequest, 'pack-fixture-actor'); const replay = await packs.create({ requestId: firstRequest, scenario: original.scenario }, 'pack-fixture-actor'); expect(replay).toMatchObject({ id: draftId, revision: 1, replayed: true });
  });
  it('changed source evidence rejects a new save without a draft/receipt, while committed replay stays immutable', async () => {
    const old = await scenario(), key = randomUUID(); pair.priceIncVat = '101.00'; pair.revision = 2;
    const count = (await packs.list('pack-fixture-actor')).items.length;
    await expect(packs.create({ requestId: key, scenario: old }, 'pack-fixture-actor')).rejects.toThrow('evidence changed'); expect((await packs.list('pack-fixture-actor')).items).toHaveLength(count);
    await expect(packs.request(key, 'pack-fixture-actor')).rejects.toThrow('not found');
    const original = await packs.request(firstRequest, 'pack-fixture-actor'); expect(await packs.create({ requestId: firstRequest, scenario: original.scenario }, 'pack-fixture-actor')).toMatchObject({ revision: 1, replayed: true });
    pair.priceIncVat = '100.00'; pair.revision = 1;
  });
  it('rolls back the draft if durable receipt persistence fails and safely retries the same absent request', async () => {
    await db.query("CREATE FUNCTION fail_pack_fixture_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.receipt->'scenario'->>'kind'='pack_price' THEN RAISE EXCEPTION 'fixture receipt failure'; END IF; RETURN NEW; END $$");
    await db.query('CREATE TRIGGER fail_pack_receipt BEFORE INSERT ON commerce_promotion_draft_requests FOR EACH ROW EXECUTE FUNCTION fail_pack_fixture_receipt()');
    const count = (await packs.list('pack-fixture-actor')).items.length, body = { requestId: randomUUID(), scenario: await scenario() };
    await expect(packs.create(body, 'pack-fixture-actor')).rejects.toThrow('Check the original request'); expect((await packs.list('pack-fixture-actor')).items).toHaveLength(count); await expect(packs.request(body.requestId, 'pack-fixture-actor')).rejects.toThrow('not found');
    await db.query('DROP TRIGGER fail_pack_receipt ON commerce_promotion_draft_requests'); await db.query('DROP FUNCTION fail_pack_fixture_receipt()');
    expect(await packs.create(body, 'pack-fixture-actor')).toMatchObject({ persisted: true, revision: 1, replayed: false });
  });
  it('paginates only this kind/owner and retains the original operational price and promotion rules', async () => {
    const value = await scenario(); for (let n = 0; n < 21; n++) await packs.create({ requestId: randomUUID(), scenario: value }, 'pack-paging-fixture-actor');
    const page = await packs.list('pack-paging-fixture-actor'); expect(page.items).toHaveLength(20); expect(page.next).not.toBeNull(); expect((await packs.list('pack-paging-fixture-actor', page.next!)).items).toHaveLength(1);
    expect(await promotions.list('pack-paging-fixture-actor')).toEqual({ items: [], next: null }); expect((await db.query('SELECT ordering_price::text price FROM josh_catalog_products'))[0].price).toBe('107.00'); expect((await db.query('SELECT rules FROM product_promotion_rules'))[0].rules).toEqual([]);
  });
});
