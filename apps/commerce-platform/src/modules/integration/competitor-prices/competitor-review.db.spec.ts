import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ScrapingModule } from '../../platform/scraping/scraping.module';
import { scrapingVersion } from '../../platform/scraping/infrastructure/public-web.reader';
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';
import { JoshCatalogSyncService } from '../connector/josh/josh-catalog-sync.service';
import { CompetitorMatchRejection, CompetitorMatchReview, CompetitorPrice } from './competitor-price.entity';
import { CompetitorPricesService } from './competitor-prices.service';
import { CompetitorReviewService } from './competitor-review.service';

/*
 * Ported from josh competitor-prices.spec.ts "review grid" (origin/main 8a44dd00), against commerce's catalog copy
 * and services instead of josh's HTTP routes. Opt-in: needs a migrated scratch database —
 *   SCRAPING_TEST_DATABASE_URL=postgres:///commerce_stage1_test npx jest -c apps/commerce-platform/jest.config.cts competitor-review.db
 */
const url = process.env.SCRAPING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('competitor review grid against a database (ported from josh)', () => {
  let app: INestApplication;
  let db: DataSource;
  let review: CompetitorReviewService;
  const chicken = '00000000-0000-4000-8000-000000000651';

  beforeAll(async () => {
    process.env.SCRAPING_CRON_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ type: 'postgres', url, autoLoadEntities: true, synchronize: false }),
        TypeOrmModule.forFeature([CompetitorPrice, CompetitorMatchRejection, CompetitorMatchReview, JoshCatalogProduct]),
        ScrapingModule,
      ],
      providers: [CompetitorPricesService, CompetitorReviewService, { provide: JoshCatalogSyncService, useValue: { configured: false } }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    review = app.get(CompetitorReviewService);
    await db.query(`DELETE FROM scraping_sources WHERE origin = 'https://grid.example.com'`);
    await db.query(`DELETE FROM josh_catalog_products WHERE id = $1`, [chicken]);
    await db.query(`INSERT INTO josh_catalog_products (id, sku, status, ordering_price, selling_unit, vat_type, storage_temperature, translations, josh_updated_at, image_url, category_name_th)
      VALUES ($1, 'TEST-CHK', 'active', 89, 'KG', '0%', 'Frozen', '[{"language_code":"th","product_name":"น่องติดสะโพกไก่ แช่แข็ง"}]', now(), 'https://img.example.com/chk.jpg', 'ทดสอบกริด')`, [chicken]);
  });
  afterAll(async () => {
    await db?.query(`DELETE FROM scraping_sources WHERE origin = 'https://grid.example.com'`);
    await db?.query(`DELETE FROM josh_catalog_products WHERE id = $1`, [chicken]);
    await app?.close();
  });

  it('proposes per site, saves each tick, remembers "not this one", typed range sizes, finishes a batch', async () => {
    const config = { startUrls: ['https://grid.example.com/c'], pathPrefixes: ['/'], mode: 'html', itemSelector: '', fields: [], autoCards: true,
      currency: 'THB', vatIncluded: true, priceContext: 'ราคาปกติ', collectionAllowed: true, intervalHours: 24, maxPages: 10, delayMs: 1000 };
    const source = await app.get(CompetitorPricesService)['scraping'].save({ name: 'Grid Mart', origin: 'https://grid.example.com', enabled: false, config } as never);
    const insert = (slug: string, name: string, price: number, weight: number | null) => db.query(`INSERT INTO scraped_items (source_id, url, page_url, name, fields, price_inc_vat, weight_kg, currency, config_version, observed_at)
      VALUES ($1, $2, 'https://grid.example.com/c', $3, '{}', $4, $5, 'THB', $6, now()) RETURNING id`, [source.id, `https://grid.example.com/p/${slug}`, name, price, weight, scrapingVersion(config as never)]);
    const [[twoKg], [loose]] = await Promise.all([insert('two', 'น่องติดสะโพกไก่ แช่แข็ง 2 กก.', 172, 2), insert('loose', 'น่องติดสะโพกไก่ แช่แข็ง ชั่งน้ำหนัก', 90, null)]);

    const grid = await review.grid({ category: 'ทดสอบกริด' });
    const row = grid.rows.find(r => r.sku === 'TEST-CHK')!;
    expect(row.image).toBe('https://img.example.com/chk.jpg');
    const cell = row.cells.find(c => c.site === 'Grid Mart');
    // 2 กก. at ฿172 = ฿86/กก. vs our ฿89/กก. → ฿3 per our 1 กก.: "พอๆ กัน", not a big % gap.
    expect(cell).toMatchObject({ state: 'proposed', itemId: twoKg.id, checked: true, tone: 'close', verdict: 'พอๆ กัน (ต่าง ฿3)' });
    expect((cell as { equivLine: string }).equivLine).toBe('ถ้าซื้อ 1 กก. เท่าเรา: เขา ฿86 · เรา ฿89');

    // Untick → remembered; the next proposal on that site is the loose item, which needs a size.
    let next = await review.setCell('mer@commerce', { sku: 'TEST-CHK', on: false, itemId: twoKg.id });
    let siteCell = next.cells.find(c => c.site === 'Grid Mart');
    expect(siteCell).toMatchObject({ state: 'proposed', itemId: loose.id, checked: false, size: null, verdict: 'ใส่ขนาดก่อนเทียบ' });
    // Typed range 0.8–1.2 กก. → paired, compared at the middle.
    next = await review.setCell('mer@commerce', { sku: 'TEST-CHK', on: true, itemId: loose.id, size: { unit: 'g', min: 800, max: 1200 } });
    siteCell = next.cells.find(c => c.site === 'Grid Mart') as typeof siteCell & { pairId: string; equivLine: string };
    expect(siteCell).toMatchObject({ state: 'paired', checked: true, size: { unit: 'kg', min: 0.8, max: 1.2, text: '0.8–1.2 กก.' } });
    expect((siteCell as { equivLine: string }).equivLine).toContain('(ค่ากลางของช่วง)');
    const [stored] = await db.query(`SELECT competitor_unit, competitor_qty_min, competitor_qty_max, competitor_weight_kg, verified_by FROM competitor_prices WHERE id = $1`,
      [(siteCell as { pairId: string }).pairId]);
    expect(stored).toMatchObject({ competitor_unit: 'kg', competitor_qty_min: '0.8000', competitor_qty_max: '1.2000', competitor_weight_kg: '1.0000', verified_by: 'mer@commerce' });
    const [rejection] = await db.query(`SELECT source_url FROM competitor_match_rejections WHERE product_id = $1`, [chicken]);
    expect(rejection.source_url).toBe('https://grid.example.com/p/two');

    // Search what we collected; then finish the batch → reviewed, moves to the "done" list.
    const found = await review.search('Grid Mart', 'น่องติด', 'TEST-CHK');
    expect(found.map(f => f.itemId).sort()).toEqual([twoKg.id, loose.id].sort());
    expect(await review.finish('mer@commerce', { skus: ['TEST-CHK'], accept: [] })).toMatchObject({ reviewed: 1, failed: [] });
    const done = await review.grid({ category: 'ทดสอบกริด', show: 'done' });
    expect(done.rows.map(r => r.sku)).toContain('TEST-CHK');

    // A product that leaves josh drops out of the grid but its pairs stay.
    await db.query(`UPDATE josh_catalog_products SET removed_at = now() WHERE id = $1`, [chicken]);
    expect((await review.grid({ category: 'ทดสอบกริด', show: 'done' })).rows.map(r => r.sku)).not.toContain('TEST-CHK');
    expect(await db.query(`SELECT count(*)::int AS n FROM competitor_prices WHERE product_id = $1`, [chicken])).toEqual([{ n: 1 }]);
  });
});
