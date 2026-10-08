#!/usr/bin/env node
// Bilingual UI regression against an isolated local stack; no live Josh integration claims.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:4403';
const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:4404';
const API = process.env.COMMERCE_TEST_API ?? 'http://localhost:3100/api';
for (const value of [ADMIN, PORTAL, API]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(value).hostname));
const credentials = JSON.parse(readFileSync('scripts/.mock-credentials', 'utf8'));
const messages = JSON.parse(readFileSync('libs/ui/src/locales/ui-messages.json', 'utf8'));
const coverage = JSON.parse(readFileSync('docs/design/stitch/full-ui-bilingual/translation-coverage.json', 'utf8'));
assert.deepEqual(coverage.missingKeys, [], 'All inventoried UI copy has both translations');
for (const [key, entry] of Object.entries(messages)) {
  assert.ok(typeof entry.th === 'string' && typeof entry.en === 'string', `Both languages: ${key}`);
  if (key !== 'ไทย / English') assert.ok(!/[\u0E01-\u0E2E\u0E30-\u0E3A\u0E40-\u0E4E]/.test(entry.en), `English UI copy: ${key}`);
  for (const language of ['th', 'en']) assert.deepEqual((entry[language].match(/\{\w+\}/g) ?? []).sort(), (key.match(/\{\w+\}/g) ?? []).sort(), `Keep interpolation: ${key}`);
}
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const portal = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], checks = [], unavailable = new Set();
for (const page of [admin, portal]) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 500) unavailable.add(new URL(response.url()).pathname); });
}
const selectLanguage = async (page, language, scope = page) => {
  await scope.getByRole('combobox', { name: /^(ภาษา|Language)$/ }).selectOption(language);
  assert.equal(await page.locator('html').getAttribute('lang'), language);
};
async function signIn(page, base, credentials) {
  await page.goto(base);
  assert.equal(await page.locator('html').getAttribute('lang'), 'th', 'Default Thai');
  await page.getByLabel('อีเมล', { exact: true }).fill(credentials.email);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(credentials.password);
  await selectLanguage(page, 'en');
  assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), credentials.email);
  assert.equal((await page.getByLabel('Password', { exact: true }).inputValue()).length, credentials.password.length);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('main h1').waitFor();
  checks.push(`${base === ADMIN ? 'Admin' : 'Portal'}: authentication fields survive language switch`);
}
let product, token;
try {
  await signIn(admin, ADMIN, credentials.admin);
  token = await admin.evaluate(() => sessionStorage.getItem('cp_admin_token'));
  const response = await admin.request.post(`${API}/products`, { headers: { Authorization: `Bearer ${token}` }, data: { sku: `locale-${randomUUID()}`, name: 'Save', description: 'Orders', currency: 'THB', status: 'active' } });
  assert.ok(response.ok()); product = await response.json();
  for (const language of ['en', 'th']) {
    await admin.goto(`${ADMIN}/products/${product.id}`);
    await admin.locator('main h1').waitFor(); await selectLanguage(admin, language);
    await admin.getByRole('heading', { name: 'Save', exact: true }).waitFor();
    await admin.getByText('Orders', { exact: true }).last().waitFor();
    await admin.getByRole('button', { name: language === 'th' ? 'แก้ไขสินค้า' : messages['แก้ไขสินค้า'].en, exact: true }).click();
    const modal = admin.locator('dialog[open]');
    const fields = modal.locator('input,textarea'); const before = await fields.evaluateAll(nodes => nodes.map(node => node.value));
    await selectLanguage(admin, language === 'th' ? 'en' : 'th', modal);
    assert.deepEqual(await fields.evaluateAll(nodes => nodes.map(node => node.value)), before, 'Switching inside modal preserves all fields');
    assert.equal(await modal.locator('input').first().inputValue(), product.sku, 'SKU remains data');
    await admin.keyboard.press('Escape');
  }
  checks.push('Product names, descriptions, SKUs and dialog fields remain unchanged in both languages');
  await selectLanguage(admin, 'en');
  await admin.goto(`${ADMIN}/workspaces/orders`); await admin.locator('main h1').waitFor();
  await admin.getByRole('heading', { name: messages['ออเดอร์และการเงิน'].en, exact: true }).waitFor();
  await admin.getByRole('searchbox').last().fill('Credit notes');
  await admin.locator('main').getByRole('link', { name: 'Manage credit notes', exact: true }).waitFor();
  await admin.reload(); assert.equal(await admin.locator('html').getAttribute('lang'), 'en', 'Locale persists on reload');
  checks.push('Translated navigation is searchable and language persists after reload');
  await admin.goto(`${ADMIN}/j/order/import`); await admin.locator('main h1').waitFor();
  const advanced = admin.locator('main details'); assert.equal(await advanced.getAttribute('open'), null);
  assert.equal(await admin.locator('main .cp-section-nav').count(), 0, 'Hidden advanced sections are not advertised as visible sections');
  await advanced.locator('summary').click(); assert.ok(await advanced.getByRole('button', { name: 'Relink all orders', exact: true }).isVisible());
  const picker = admin.locator('main input[type=file]').first();
  await picker.setInputFiles({ name: 'orders.csv', mimeType: 'text/csv', buffer: Buffer.from('customer_code\nUI_ONLY\n') });
  await selectLanguage(admin, 'th'); assert.equal(await picker.evaluate(node => node.files[0].name), 'orders.csv');
  assert.equal(await admin.getByRole('button', { name: messages['Import CSV'].th, exact: true }).isEnabled(), false, 'Both files are required');
  checks.push('Import file selection survives language changes; advanced relinking is separate and import needs both files');
  await admin.goto(`${ADMIN}/j/coupon/create`);
  await admin.locator('main h1').waitFor();
  const audience = admin.getByRole('combobox', { name: messages['รูปแบบกลุ่มเป้าหมาย'].th, exact: true });
  const audienceId = await audience.getAttribute('id');
  const nativeAudience = admin.locator(`select[id="${audienceId}-native"]`);
  const choice = await nativeAudience.locator('option').nth(1).getAttribute('value');
  await audience.click();
  await admin.getByRole('listbox').getByRole('option').nth(1).click();
  await selectLanguage(admin, 'en');
  const englishAudience = admin.getByRole('combobox', { name: messages['รูปแบบกลุ่มเป้าหมาย'].en, exact: true });
  assert.equal(await nativeAudience.inputValue(), choice, 'Audience value remains an API enum');
  await englishAudience.click();
  for (const label of await admin.getByRole('listbox').getByRole('option').allTextContents()) assert.ok(!/[\u0E01-\u0E2E\u0E30-\u0E3A\u0E40-\u0E4E]/.test(label), 'Every audience option updates to English');
  await admin.keyboard.press('Escape');
  await selectLanguage(admin, 'th');
  assert.equal(await nativeAudience.inputValue(), choice, 'Audience choice survives both language changes');
  checks.push('Specialized coupon options update immediately in both languages without changing the selected audience');
  await signIn(portal, PORTAL, credentials.partner);
  await selectLanguage(portal, 'th'); await portal.reload(); assert.equal(await portal.locator('html').getAttribute('lang'), 'th');
  assert.ok(await portal.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'Phone viewport fits');
  checks.push('Portal locale persists and phone layout fits');
  assert.deepEqual(errors, []);
  mkdirSync('.e2e-out/bilingual', { recursive: true });
  writeFileSync('.e2e-out/bilingual/results.json', JSON.stringify({ checks, unavailableEndpoints: [...unavailable], translatedMessages: Object.keys(messages).length }, null, 2));
  console.log(`PASS: ${checks.length} bilingual checks; actual local login, data preservation, form state, search, persistence and mobile layout.`);
} finally {
  if (product && token) await admin.request.delete(`${API}/products/${product.id}`, { headers: { Authorization: `Bearer ${token}` } });
  await browser.close();
}
