#!/usr/bin/env node
// Fixtures stay here. ADMIN_URL=http://127.0.0.1:4415 node apps/commerce-admin/e2e/competitor-price-matrix.mjs.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:4403';
const OUT = '.e2e-out/competitor-price-matrix';
const now = new Date().toISOString();
const product = (sku, price) => ({ id: sku, sku, name: `สินค้า ${sku}`, brand: 'Fixture', country: 'TH', storage: 'frozen', packSize: '1kg', sellingUnit: 'แพ็ก', sellingUnitPriceIncVat: price, updatedAt: now, syncedAt: now, removed: false });
const offer = (id, sku, shop, sourceName, context, ourPrice, theirPrice, extra = {}) => ({
  id, revision: 1, ourProductVersion: 'fixture-version', ourProduct: product(sku, ourPrice), ourWeightKg: 1,
  sourceUrl: `https://${shop}/products/${id}`, sourceName, competitorName: `คู่แข่ง ${id}`, competitorSku: id,
  competitorWeightKg: 1, sourceContext: context, vatIncluded: true, collectionAllowed: true, autoRefresh: false,
  ourPricePerKgIncVat: ourPrice, ourPackPriceIncVat: ourPrice, competitorPackPriceIncVat: theirPrice, competitorPricePerKgIncVat: theirPrice,
  differencePerKgIncVat: theirPrice - ourPrice, differenceForOurWeightIncVat: theirPrice - ourPrice, differencePercent: 1,
  comparisonReady: true, comparisonReason: null, verified: true, matchNote: 'Same fixture specification', verifiedAt: now,
  verifiedBy: 'fixture', canRefresh: true, refreshReason: null, observedAt: now, captureMethod: 'manual', lastError: null, ...extra,
});
let items = [
  offer('alpha-retail', 'SKU-A', 'www.alpha.example.test', 'Alpha retail page', 'Retail promotion', 300, 310),
  offer('alpha-wholesale', 'SKU-A', 'alpha.example.test', 'Alpha wholesale page', 'Wholesale 10 packs', 300, 285),
  offer('beta-stale', 'SKU-A', 'beta.example.test', 'Beta store', 'Normal branch', 300, 250, { comparisonReady: false, comparisonReason: 'ราคาเกิน 24 ชั่วโมง กรุณาอัปเดต', observedAt: new Date(Date.now() - 48 * 3600000).toISOString(), differencePerKgIncVat: null }),
  offer('gamma-review', 'SKU-A', 'gamma.example.test', 'Gamma store', 'Member branch', 300, 270, { verified: false, comparisonReady: false, comparisonReason: 'รอตรวจและยืนยันคู่สินค้า', differencePerKgIncVat: null }),
  offer('alpha-b', 'SKU-B', 'alpha.example.test', 'Alpha retail page', 'Normal branch', 200, 220),
  offer('alpha-c', 'SKU-C', 'alpha.example.test', 'Alpha retail page', 'Normal branch', 200, 220),
  offer('beta-c', 'SKU-C', 'beta.example.test', 'Beta store', 'Normal branch', 100, 150, { ourWeightKg: 2 }),
];
const mutations = [], errors = [];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((token) => sessionStorage.setItem('cp_admin_token', token), `x.${Buffer.from(JSON.stringify({ email: 'matrix@example.test', role: 'admin' })).toString('base64url')}.x`);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const body = request.postDataJSON();
    const reply = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    const envelope = (data) => reply({ status: 200, message: '', data });
    if (path === '/admin/stats') return reply({ webhooksPending: 0, webhooksFailed: 0 });
    if (path.includes('/health')) return reply({ now: { problems: [] } });
    if (path === '/competitor-prices' && request.method() === 'GET') return envelope(items);
    if (path.startsWith('/competitor-prices') && request.method() !== 'GET') {
      mutations.push({ path, method: request.method(), body });
      if (path === '/competitor-prices') {
        const next = offer('added-pair', body.sku, 'www.gamma.example.test', 'Gamma store', body.sourceContext, 200, 0, { ...body, competitorPricePerKgIncVat: null, competitorPackPriceIncVat: null, observedAt: null, verified: false, comparisonReady: false, comparisonReason: 'รอตรวจและยืนยันคู่สินค้า', differencePerKgIncVat: null });
        items.push(next); return envelope(next);
      }
      const id = path.split('/')[2], index = items.findIndex((item) => item.id === id);
      assert.ok(index >= 0, `Unknown fixture pair ${id}`);
      let next = items[index];
      if (path.endsWith('/verify')) next = { ...next, verified: true, comparisonReady: true, comparisonReason: null, matchNote: body.matchNote, differencePerKgIncVat: next.competitorPricePerKgIncVat - next.ourPricePerKgIncVat, revision: next.revision + 1 };
      else if (path.endsWith('/price')) next = { ...next, competitorPackPriceIncVat: body.priceIncVat, competitorPricePerKgIncVat: body.priceIncVat, observedAt: body.observedAt, differencePerKgIncVat: body.priceIncVat - next.ourPricePerKgIncVat, revision: next.revision + 1 };
      else if (request.method() === 'PUT') next = { ...next, ...body, revision: next.revision + 1 };
      items[index] = next; return envelope(next);
    }
    return reply({});
  });
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1), `Document overflow on ${page.url()}`);
  const screenshot = async (name) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
  const table = () => page.getByRole('table');
  const skuRow = (sku) => table().getByRole('row').filter({ has: page.getByRole('rowheader').filter({ hasText: sku }) });
  const select = (source, context) => page.getByRole('button', { name: `ดูคู่ SKU-A กับ ${source} ${context}`, exact: true });
  await page.goto(`${ADMIN}/marketing/competitor-prices`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'หลายร้านต่อ SKU', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'หลายร้านต่อ SKU', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await table().locator('tbody tr').count(), 3, 'One row per our SKU.');
  assert.equal(await table().getByRole('columnheader').count(), 5, 'Our SKU, own price and three canonical competitor shops.');
  for (const shop of ['alpha.example.test', 'beta.example.test', 'gamma.example.test']) assert.ok(await table().getByRole('columnheader', { name: shop, exact: true }).count());
  assert.equal(await skuRow('SKU-A').getByRole('button').count(), 4, 'Both Alpha offers survive grouping.');
  assert.equal(await skuRow('SKU-B').getByText('ยังไม่มีคู่สินค้าร้านนี้', { exact: true }).count(), 2);
  assert.ok(await select('Beta store', 'Normal branch').getByText('ราคาเกิน 24 ชั่วโมง กรุณาอัปเดต', { exact: true }).count());
  for (const button of [select('Beta store', 'Normal branch'), select('Gamma store', 'Member branch')]) {
    assert.doesNotMatch(await button.innerText(), /฿|เราถูกกว่า|เราแพงกว่า|ราคาเท่ากัน|ต่ำสุด|ดีที่สุด/, 'Unready offers have no numeric gap or ranking.');
  }
  assert.match(await skuRow('SKU-C').innerText(), /ราคาของเราต่อกก.ไม่ตรงกัน/);
  assert.doesNotMatch(await skuRow('SKU-C').innerText(), /฿|เราถูกกว่า|เราแพงกว่า/, 'Ambiguous own-price projections cannot pick a baseline.');
  await noOverflow();
  await page.setViewportSize({ width: 1024, height: 1000 }); await noOverflow();
  assert.ok(await table().evaluate((element) => element.parentElement.scrollWidth > element.parentElement.clientWidth), 'Wide matrix scrolls in its own container.');
  const sticky = await table().evaluate((element) => {
    const scroll = element.parentElement, sku = element.tBodies[0].rows[0].cells[0], price = element.tBodies[0].rows[0].cells[1];
    const before = [sku.getBoundingClientRect().left, price.getBoundingClientRect().left];
    scroll.scrollLeft = scroll.scrollWidth;
    return { before, after: [sku.getBoundingClientRect().left, price.getBoundingClientRect().left], skuRight: sku.getBoundingClientRect().right, priceLeft: price.getBoundingClientRect().left };
  });
  assert.ok(sticky.before.every((value, index) => Math.abs(value - sticky.after[index]) <= 1), 'SKU and own price stay visible while scrolling.');
  assert.ok(sticky.priceLeft >= sticky.skuRight - 1, 'Pinned columns never overlap.');
  await table().evaluate((element) => { element.parentElement.scrollLeft = 0; });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await screenshot('matrix-desktop');
  await page.getByLabel('ค้นหา SKU หรือร้าน', { exact: true }).fill('Retail promotion');
  assert.equal(await table().locator('tbody tr').count(), 1);
  assert.equal(await skuRow('SKU-A').getByRole('button').count(), 4, 'Searching one offer retains every competitor of its SKU.');
  await page.getByRole('tab', { name: 'รอยืนยัน', exact: true }).click();
  assert.equal(await skuRow('SKU-A').getByRole('button').count(), 4, 'Status filters retain the other offers.');
  await page.getByRole('tab', { name: 'เทียบได้', exact: true }).click();
  assert.equal(await skuRow('SKU-A').getByRole('button').count(), 4);
  await page.getByRole('tab', { name: 'ทั้งหมด', exact: true }).click();
  await select('Alpha wholesale page', 'Wholesale 10 packs').focus(); await page.keyboard.press('Enter');
  const detail = page.locator('[aria-label="รายละเอียดคู่สินค้า"]');
  assert.match(await detail.innerText(), /Alpha wholesale page.*Wholesale 10 packs/);
  await page.getByRole('button', { name: 'แก้ไขคู่สินค้า', exact: true }).click();
  await page.getByLabel('ชื่อสินค้าคู่แข่ง', { exact: true }).fill('Wholesale edited');
  await page.getByRole('form', { name: 'เพิ่มหรือแก้ไขคู่สินค้า', exact: true }).getByRole('button', { name: 'บันทึก', exact: true }).click();
  await page.getByText('Wholesale edited', { exact: true }).first().waitFor();
  assert.equal(mutations.at(-1).path, '/competitor-prices/alpha-wholesale');
  await page.getByRole('button', { name: 'บันทึกราคา', exact: true }).click();
  await page.getByLabel('ราคาเต็มแพ็ก 1 กก. (บาท รวม VAT)', { exact: true }).fill('299');
  await page.getByRole('form', { name: 'บันทึกราคา', exact: true }).getByRole('button', { name: 'บันทึก', exact: true }).click();
  await page.getByRole('form', { name: 'บันทึกราคา', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(mutations.at(-1).path, '/competitor-prices/alpha-wholesale/price');
  const refreshed = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().endsWith('/competitor-prices'));
  await page.getByRole('button', { name: 'ดึงราคา', exact: true }).click(); await refreshed;
  assert.equal(mutations.at(-1).path, '/competitor-prices/alpha-wholesale/refresh');
  await select('Gamma store', 'Member branch').click();
  await detail.getByText(/Gamma store.*Member branch/).waitFor();
  await page.getByRole('button', { name: 'ตรวจคู่สินค้า', exact: true }).click();
  await page.getByLabel('เหตุผลและสเปกที่ตรงกัน', { exact: true }).fill('ตรวจชนิดและน้ำหนัก fixture ตรงกันแล้ว');
  await page.getByLabel('ตรวจสเปกแล้ว', { exact: true }).check();
  await page.getByRole('form', { name: 'ตรวจคู่สินค้า', exact: true }).getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await page.getByRole('form', { name: 'ตรวจคู่สินค้า', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(mutations.at(-1).path, '/competitor-prices/gamma-review/verify');
  await page.getByLabel('ค้นหา SKU หรือร้าน', { exact: true }).fill('');
  await page.getByRole('tab', { name: 'คู่สินค้า / จัดการ', exact: true }).click();
  assert.equal(await table().locator('tbody tr').count(), 7, 'The maintenance pair list remains available.');
  await screenshot('pairs-desktop');
  await page.getByRole('tab', { name: 'หลายร้านต่อ SKU', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow();
    if (width === 320) {
      assert.equal(await page.getByRole('article', { name: 'ราคาของ SKU-A', exact: true }).getByRole('button').count(), 4);
      await screenshot('matrix-mobile');
    }
  }
  await page.getByRole('button', { name: 'เพิ่มคู่สินค้า', exact: true }).click();
  await page.getByLabel('SKU ของเรา', { exact: true }).fill('SKU-B');
  await page.getByLabel('ชื่อสินค้าคู่แข่ง', { exact: true }).fill('Gamma new fixture');
  await page.getByLabel('ลิงก์หน้าสินค้า', { exact: true }).fill('https://www.gamma.example.test/products/sku-b');
  await page.getByLabel('เงื่อนไขราคา / สาขา / โปรโมชั่น', { exact: true }).fill('Normal branch');
  await page.getByRole('form', { name: 'เพิ่มหรือแก้ไขคู่สินค้า', exact: true }).getByRole('button', { name: 'บันทึก', exact: true }).click();
  await page.getByRole('form', { name: 'เพิ่มหรือแก้ไขคู่สินค้า', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(mutations.at(-1).path, '/competitor-prices');
  assert.equal(items.length, 8);
  assert.deepEqual(errors, []);
  console.log('PASS Competitor matrix: three shops per SKU, all offers, missing/stale/unverified cells, ambiguous own price, row search/status, pair details/maintenance/mutations and mobile cards.');
} finally { await browser.close(); }
