import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitterBus } from '../../../shared-kernel/infrastructure/event-emitter.bus';
import { OutboxMessage } from '../../../shared-kernel/infrastructure/outbox.entity';
import { EVENT_BUS } from '../../../shared-kernel/interfaces/event-bus.interface';
import { CATEGORY_TREE_AGGREGATE_ID } from './category-tree.events';
import { ProductCategoriesService } from './product-categories.service';

/*
 * Stage 4c: josh's category rules on commerce's copy. Opt-in, migrated scratch DB with the tree imported
 * (import-from-josh -- categories):
 *   CATEGORIES_TEST_DATABASE_URL=postgres:///commerce_4c_test npx jest -c apps/commerce-platform/jest.config.cts --runInBand product-categories.service.db
 */
const url = process.env.CATEGORIES_TEST_DATABASE_URL;

(url ? describe : describe.skip)('ProductCategoriesService against a database', () => {
  let db: DataSource;
  let svc: ProductCategoriesService;
  const made: string[] = [];
  const row = async (id: string) => (await db.query(`SELECT * FROM product_categories WHERE id = $1`, [id]))[0];
  const lastTree = async () => (await db.query(`SELECT payload FROM outbox_messages WHERE aggregate_id = $1 ORDER BY created_at DESC LIMIT 1`, [CATEGORY_TREE_AGGREGATE_ID]))[0]?.payload;

  beforeAll(async () => {
    process.env.COMMERCE_OWNS_CATEGORIES = 'true';
    const mod = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, entities: [OutboxMessage] }), TypeOrmModule.forFeature([OutboxMessage])],
      providers: [ProductCategoriesService, EventEmitterBus, { provide: EVENT_BUS, useExisting: EventEmitterBus }],
    }).compile();
    db = mod.get(DataSource);
    svc = mod.get(ProductCategoriesService);
  });
  afterAll(async () => {
    for (const id of made.reverse()) await svc.remove(id).catch(() => undefined);
    await db?.destroy();
    delete process.env.COMMERCE_OWNS_CATEGORIES;
  });

  it('create / rename / reorder children rebuild codes and paths like josh, and every write sends the whole tree', async () => {
    const root = (await svc.create({ category_name_en: 'T4C ROOT' })).data;
    made.push(root.category_id_uuid);
    expect(root).toMatchObject({ category_name_en: 'T4c Root', category_level: 0, cat_code: 'T4C_ROOT' });
    const l1 = (await svc.create({ category_name_en: 'T4c Level One', parent_id: root.category_id_uuid })).data;
    made.push(l1.category_id_uuid);
    const a = (await svc.create({ category_name_en: 'T4c A', parent_id: l1.category_id_uuid })).data;
    const b = (await svc.create({ category_name_en: 'T4c B', parent_id: l1.category_id_uuid })).data;
    made.push(a.category_id_uuid, b.category_id_uuid);
    expect([a.category_code, b.category_code]).toEqual([`${l1.category_code}-1`, `${l1.category_code}-2`]);
    expect(a.category_path).toBe('T4c Root > T4c Level One > T4c A');
    await expect(svc.create({ category_name_en: 't4c a', parent_id: l1.category_id_uuid })).rejects.toThrow('ถูกใช้แล้วในระดับเดียวกัน');

    await svc.update(l1.category_id_uuid, { category_name_en: 'T4C LEVEL UNO' });
    expect((await row(a.category_id_uuid)).category_path).toBe('T4c Root > T4c Level Uno > T4c A');

    await svc.reorderChildren(l1.category_id_uuid, [b.category_id_uuid, a.category_id_uuid]);
    expect((await row(b.category_id_uuid)).category_code).toBe(`${l1.category_code}-1`);
    expect((await row(a.category_id_uuid)).category_code).toBe(`${l1.category_code}-2`);
    await expect(svc.reorderChildren(l1.category_id_uuid, [b.category_id_uuid])).rejects.toThrow('ขาดหมวดย่อย');

    const tree = await lastTree();
    const [{ n }] = await db.query(`SELECT count(*)::int AS n FROM product_categories`);
    expect(tree.rows).toHaveLength(n);
    expect(tree.rows.find((r: { id: string }) => r.id === a.category_id_uuid)).toMatchObject({ category_code: `${l1.category_code}-2`, sort: 2 });
  });

  it('level-1 reorder takes the whole row; brand names publish one brand', async () => {
    const ids: string[] = (await db.query(`SELECT id FROM product_categories WHERE level = 1 ORDER BY sort, id`)).map((r: { id: string }) => r.id);
    const moved = [...ids.slice(1), ids[0]];
    await svc.reorderLevel1(moved);
    expect((await row(ids[0])).sort).toBe(ids.length);
    await expect(svc.reorderLevel1(moved.slice(1))).rejects.toThrow('ขาดหมวด Level 1');
    await svc.reorderLevel1(ids);
    expect((await row(ids[0])).sort).toBe(1);

    const [brand] = await db.query(`SELECT * FROM product_brands ORDER BY brand_code LIMIT 1`);
    const r = await svc.updateBrand(brand.id, { brand_name_en: 'T4c Brand' }, 'staff-1');
    expect(r.data).toMatchObject({ id: brand.id, brand_code: brand.brand_code, brand_name_en: 'T4c Brand', brand_name_th: brand.brand_name_th });
    const [snap] = await db.query(`SELECT payload FROM outbox_messages WHERE type = 'brand.snapshot' AND aggregate_id = $1 ORDER BY created_at DESC LIMIT 1`, [brand.id]);
    expect(snap.payload).toMatchObject({ id: brand.id, brand_name_en: 'T4c Brand' });
    await svc.updateBrand(brand.id, { brand_name_en: brand.brand_name_en ?? undefined }, 'staff-1');
  });
});
