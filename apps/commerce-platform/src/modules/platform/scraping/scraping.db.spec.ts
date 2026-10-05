import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { ScrapingModule } from './scraping.module';
import { ScrapingService } from './application/scraping.service';
import { PublicWebReader, scrapingVersion } from './infrastructure/public-web.reader';

/*
 * Ported from josh apps/backend/src/app/competitor-prices/competitor-prices.spec.ts (scraping cases, af81a227):
 * one-click paging, dropped-run retry/resume (#442/#453), whole paged listing + night window + pair refresh +
 * master switch, and site-login storage. Opt-in: needs a migrated scratch database —
 *   SCRAPING_TEST_DATABASE_URL=postgresql:///scrape_test?host=/tmp npx jest -c apps/commerce-platform/jest.config.cts scraping.db
 * The reader is stubbed: no request ever leaves the machine.
 */
const url = process.env.SCRAPING_TEST_DATABASE_URL;
const dbDescribe = url ? describe : describe.skip;
const doNotFake = ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'performance', 'hrtime'] as const;
const listing = (slug: string) => (n: number) =>
  `<main>${[0, 1, 2].map(i => `<div><a href="/p/${slug}-${n}-${i}"><span>${slug} ${n}-${i} 1 กก.</span><span>฿</span><span>${100 + n}</span></a></div>`).join('')}</main>`;

dbDescribe('scraping against a database (ported from josh)', () => {
  let app: INestApplication;
  let db: DataSource;
  let scraping: ScrapingService;
  let reader: PublicWebReader;
  const base = { pathPrefixes: ['/'], mode: 'html', itemSelector: '', fields: [], autoCards: true, currency: 'THB',
    vatIncluded: true, priceContext: 'ราคาปกติ', collectionAllowed: true, intervalHours: 24, maxPages: 100, delayMs: 1000 };

  beforeAll(async () => {
    process.env.SCRAPING_CRON_DISABLED = 'true';
    const moduleRef = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot({ type: 'postgres', url, autoLoadEntities: true, synchronize: false }), ScrapingModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = app.get(DataSource);
    scraping = app.get(ScrapingService);
    reader = app.get(PublicWebReader);
    await db.query(`DELETE FROM scraping_sources WHERE origin LIKE '%.example.com'`);
    await db.query(`DELETE FROM settings WHERE scope = 'marketing' AND key = 'competitor_scraping'`);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
  afterAll(async () => { await app?.close(); });

  it('stores a site login encrypted and never returns the password', async () => {
    const previousKey = process.env.SCRAPING_CREDENTIALS_KEY;
    process.env.SCRAPING_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
      const source = await scraping.save({ name: 'Login', origin: 'https://login.example.com', enabled: false,
        config: { ...base, startUrls: ['https://login.example.com/c'] } } as never);
      const saved = await scraping.saveLogin(source.id, { url: 'https://login.example.com/login', username: 'buyer@commerce', password: 'p@ss-ลับ' });
      expect(saved.login).toEqual({ url: 'https://login.example.com/login', username: 'buyer@commerce', hasPassword: true });
      expect(JSON.stringify(saved)).not.toContain('p@ss');
      const [stored] = await db.query('SELECT login_password_enc FROM scraping_sources WHERE id = $1', [source.id]);
      expect(stored.login_password_enc).toMatch(/^v1:/);
      expect(stored.login_password_enc).not.toContain('p@ss');
      // Username only: keeps the stored password.
      expect((await scraping.saveLogin(source.id, { url: 'https://login.example.com/login', username: 'other' })).login).toMatchObject({ username: 'other', hasPassword: true });
      const listed = (await scraping.listSources()).find(s => s.id === source.id);
      expect(JSON.stringify(listed)).not.toMatch(/p@ss|login_password|loginPasswordEnc/);
      expect((await scraping.clearLogin(source.id)).login).toBeNull();
    } finally { process.env.SCRAPING_CREDENTIALS_KEY = previousKey; }
  });

  it('switches an old link-crawl source to whole-listing paging in one click', async () => {
    const page = listing('old');
    jest.spyOn(reader, 'paginate').mockImplementation(async (_url, _config, _origin, options) => {
      for (let index = options.skip; index < Math.min(options.maxPages, 60); index++) {
        if (!await options.onPage(page(index), 'https://old.example.com/c', index)) return { pages: index + 1, totalPages: 60, end: 'stopped' as const };
      }
      return { pages: 60, totalPages: 60, end: 'no-next' as const };
    });
    const created = await scraping.save({ name: 'Old', origin: 'https://old.example.com', enabled: true,
      config: { ...base, startUrls: ['https://old.example.com/c'], intervalHours: 168 } } as never);
    // Answers at once; a 20-page first look runs in the background, the rest at night.
    const upgraded = await scraping.enablePaging(created.id, created.revision);
    expect(upgraded).toMatchObject({ status: 'running', config: { pagination: 'browser', nightOnly: true, intervalHours: 24 } });
    let after = await scraping.source(created.id);
    for (let i = 0; i < 50 && after.progress.visited.length < 20; i++) { await new Promise(r => setTimeout(r, 50)); after = await scraping.source(created.id); }
    await new Promise(r => setTimeout(r, 100));
    after = await scraping.source(created.id);
    expect(after.progress.visited).toHaveLength(20);
    expect(after.progress.items).toBe(60);
    expect(after).toMatchObject({ status: 'running', config: { expectedPages: 60, maxPages: 60 } });
    jest.useFakeTimers({ doNotFake: [...doNotFake] });
    jest.setSystemTime(new Date('2026-10-03T09:00:00Z')); // 16:00 Bangkok
    expect((await scraping.listSources()).find(s => s.id === created.id)?.activity).toBe('waiting_for_night');
    expect((await scraping.runNow(created.id, after.revision)).activity).toBe('reading');
    for (let i = 0; i < 100 && (await scraping.source(created.id)).status === 'running'; i++) await new Promise(r => setTimeout(r, 50));
    after = await scraping.source(created.id);
    expect(after.progress.visited).toHaveLength(60);
    expect(after.status).toBe('completed');
    jest.useRealTimers();
    await expect(scraping.enablePaging(created.id, after.revision)).rejects.toThrow('เว็บนี้เก็บทุกหน้าอยู่แล้ว');
  });

  it('a dropped paged run keeps its place, retries on its own (also after a restart), and waits for a person after 3 drops', async () => {
    const page = listing('drop');
    let dropAt = 5;
    jest.spyOn(reader, 'paginate').mockImplementation(async (_url, _config, _origin, options) => {
      for (let index = options.skip; index < 30; index++) {
        if (index >= dropAt) throw new Error('net::ERR_CONNECTION_RESET');
        if (!await options.onPage(page(index), 'https://drop.example.com/c', index)) return { pages: index + 1, totalPages: 30, end: 'stopped' as const };
      }
      return { pages: 30, totalPages: 30, end: 'no-next' as const };
    });
    const created = await scraping.save({ name: 'Drop', origin: 'https://drop.example.com', enabled: true,
      config: { ...base, startUrls: ['https://drop.example.com/c'], pagination: 'browser', nightOnly: true } } as never);
    const started = await scraping.start(created.id, { revision: created.revision, restart: true });
    const freeLease = () => db.query(`UPDATE scraping_sources SET lease_until = NULL WHERE id = $1`, [created.id]);
    const waitFor = async (done: (s: Awaited<ReturnType<typeof scraping.source>>) => boolean) => {
      for (let i = 0; i < 100 && !done(await scraping.source(created.id)); i++) await new Promise(r => setTimeout(r, 50));
    };
    jest.useFakeTimers({ doNotFake: [...doNotFake] });
    jest.setSystemTime(new Date('2026-10-03T09:00:00Z')); // 16:00 Bangkok, outside the night window
    await scraping.runNow(created.id, started.revision);
    await waitFor(s => !!s.progress.retries);
    let after = await scraping.source(created.id);
    expect(after.progress).toMatchObject({ pending: ['https://drop.example.com/c'], retries: 1, now: 'all', failed: 0 });
    expect(after.progress.visited).toHaveLength(5);
    expect(after.status).toBe('running');
    expect(after.lastError).toContain('กำลังลองใหม่เอง (ครั้งที่ 1/3)');
    expect(after.leaseUntil!.getTime()).toBeGreaterThan(Date.now());
    expect((await scraping.listSources()).find(s => s.id === created.id)?.activity).toBe('retrying');
    // Restart / backoff over: the tick picks it up in the daytime because a person asked for now.
    dropAt = Infinity;
    await freeLease();
    await scraping.tick();
    await waitFor(s => s.status !== 'running');
    after = await scraping.source(created.id);
    expect(after.progress.visited).toHaveLength(30);
    expect(after).toMatchObject({ status: 'completed', lastError: null, progress: { failed: 0, items: 90 } });
    expect(after.progress.now).toBeUndefined();

    // Three drops in a row: stop retrying, keep the place, and let a person continue.
    const again = await scraping.start(created.id, { revision: after.revision, restart: true });
    dropAt = 3;
    for (let run = 0; run < 4; run++) { await freeLease(); await scraping.batch(created.id, { ignoreNight: true }); }
    after = await scraping.source(created.id);
    expect(after).toMatchObject({ status: 'limited', progress: { retries: 4, failed: 1, pending: ['https://drop.example.com/c'] } });
    expect(after.progress.visited).toHaveLength(3);
    expect(after.lastError).toContain('ลองใหม่ 3 ครั้งแล้วไม่สำเร็จ');
    expect((await scraping.listSources()).find(s => s.id === created.id)?.activity).toBe('gave_up');
    dropAt = Infinity;
    expect((await scraping.runNow(created.id, again.revision)).status).toBe('running');
    await waitFor(s => s.status !== 'running');
    after = await scraping.source(created.id);
    expect(after.status).toBe('completed');
    expect(after.progress.visited).toHaveLength(30);

    // Dropped by a run before retries existed: listing already gone from pending at page 12 of 30. Still continues.
    await db.query(`UPDATE scraping_sources SET status = 'limited', lease_until = NULL, last_error = 'อ่านหน้ารายการไม่สำเร็จ ลองสำรวจเว็บใหม่',
      config = config || '{"expectedPages":30}', progress = jsonb_set(jsonb_set(progress, '{pending}', '[]'), '{visited}', (progress->'visited') - 29 - 28 - 27 - 26 - 25 - 24 - 23 - 22 - 21 - 20 - 19 - 18 - 17 - 16 - 15 - 14 - 13 - 12)
      WHERE id = $1`, [created.id]);
    const old = (await scraping.listSources()).find(s => s.id === created.id)!;
    expect(old.activity).toBe('gave_up');
    await scraping.runNow(created.id, old.revision);
    await waitFor(s => s.status !== 'running');
    after = await scraping.source(created.id);
    expect(after.status).toBe('completed');
    expect(after.progress.visited).toHaveLength(30);
    expect(after.progress.visited[12]).toBe('https://drop.example.com/c#page=13');
  }, 30000);

  it('reads a whole paged listing in one session, pauses outside the night window, refreshes matched pairs, obeys the master switch', async () => {
    const page = listing('item');
    const paginate = jest.spyOn(reader, 'paginate').mockImplementation(async (_url, _config, _origin, options) => {
      for (let index = options.skip; index < Math.min(options.maxPages, 25); index++) {
        if (!await options.onPage(page(index), 'https://night.example.com/c', index)) return { pages: index + 1, totalPages: null, end: 'stopped' as const };
      }
      return { pages: 25, totalPages: null, end: 'no-next' as const };
    });
    const config = { ...base, startUrls: ['https://night.example.com/c'], pagination: 'browser' };
    const created = await scraping.save({ name: 'Night', origin: 'https://night.example.com', enabled: false, config } as never);
    await scraping.start(created.id, { revision: created.revision, restart: true });
    await scraping.batch(created.id);
    let source = await scraping.source(created.id);
    expect(source.progress.visited).toHaveLength(25);
    expect(source.status).toBe('completed');
    expect(source.leaseUntil).toBeNull();
    expect(Number((await db.query('SELECT count(*) FROM scraped_items WHERE source_id = $1', [created.id]))[0].count)).toBe(75);

    // A matched pair takes the next run's price; a pair whose product name changed is flagged, not repriced.
    const productId = randomUUID();
    await db.query(`INSERT INTO josh_catalog_products (id, sku, josh_updated_at) VALUES ($1, $2, now())`, [productId, `TEST-${productId.slice(0, 8)}`]);
    await db.query(`INSERT INTO competitor_prices (product_id, our_weight_kg, source_url, scraping_source_id, competitor_name, competitor_weight_kg, source_context, vat_included, collection_allowed, auto_refresh, price_inc_vat, observed_at, capture_method, captured_source_version, revision)
      VALUES ($1, 1, 'https://night.example.com/p/item-0-0', $2, 'item 0-0 1 กก.', 1, 'ราคาปกติ', true, true, false, 50, now() - interval '3 days', 'automatic', $3, 1),
             ($1, 1, 'https://night.example.com/p/item-0-1', $2, 'ชื่อเดิม 1 กก.', 1, 'ราคาปกติ', true, true, false, 50, now() - interval '3 days', 'automatic', $3, 1)`,
      [productId, created.id, scrapingVersion(config as never)]);
    source = await scraping.source(created.id);
    await scraping.start(created.id, { revision: source.revision, restart: true });
    await scraping.batch(created.id);
    const pairs = await db.query(`SELECT source_url, price_inc_vat, last_error, observed_at > now() - interval '1 minute' AS fresh FROM competitor_prices WHERE scraping_source_id = $1 ORDER BY source_url`, [created.id]);
    expect(pairs[0]).toMatchObject({ price_inc_vat: '100.00', last_error: null, fresh: true });
    expect(pairs[1]).toMatchObject({ price_inc_vat: '50.00', last_error: 'สินค้าต้นทางเปลี่ยนชื่อหรือน้ำหนัก กรุณาตรวจคู่สินค้าใหม่', fresh: false });
    await db.query(`DELETE FROM josh_catalog_products WHERE id = $1`, [productId]);

    // Night-only outside the window: the run pauses after it notices, keeps its listing and progress for next night.
    source = await scraping.source(created.id);
    await scraping.save({ name: 'Night', origin: 'https://night.example.com', enabled: false, revision: source.revision, config: { ...config, nightOnly: true } } as never, created.id);
    source = await scraping.source(created.id);
    await scraping.start(created.id, { revision: source.revision, restart: true });
    jest.useFakeTimers({ doNotFake: [...doNotFake] });
    jest.setSystemTime(new Date('2026-10-03T09:00:00Z')); // 16:00 Bangkok
    await scraping.batch(created.id);
    expect((await scraping.listSources()).find(s => s.id === created.id)?.activity).toBe('waiting_for_night');
    jest.useRealTimers();
    source = await scraping.source(created.id);
    expect(source.status).toBe('running');
    expect(source.progress.pending).toEqual(['https://night.example.com/c']);
    expect(source.progress.visited).toHaveLength(0);

    // Master switch: default on; while off the scheduler does nothing at all.
    expect((await scraping.automation()).enabled).toBe(true);
    const staffId = randomUUID();
    expect(await scraping.setAutomation(false, staffId)).toMatchObject({ enabled: false, updatedBy: staffId });
    paginate.mockClear();
    await scraping.save({ name: 'Night', origin: 'https://night.example.com', enabled: false, revision: (await scraping.source(created.id)).revision, config } as never, created.id);
    source = await scraping.source(created.id);
    await scraping.start(created.id, { revision: source.revision, restart: true });
    await scraping.tick();
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(paginate).not.toHaveBeenCalled();
    expect((await scraping.setAutomation(true, staffId)).enabled).toBe(true);
    expect(Number((await db.query(`SELECT count(*) FROM settings WHERE scope = 'marketing' AND key = 'competitor_scraping'`))[0].count)).toBe(1);
  });
});
