#!/usr/bin/env node
// Isolated UI checks for merged staff permissions; every API request is mocked locally.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.env.ADMIN_URL ?? 'http://localhost:4403';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local UI server');
const roles = ['marketing', 'merchandising', 'cs', 'sales_manager', 'business_analyst', 'graphic'];
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const errors = [], checks = [];
async function open(role, locale) {
  const context = await browser.newContext();
  const requests = [];
  const claims = Buffer.from(JSON.stringify({ sub: 'ui-role-fixture', email: 'role-fixture@example.invalid', role, exp: 4102444800 })).toString('base64url');
  await context.addInitScript(({ claims, locale }) => {
    sessionStorage.setItem('cp_admin_token', `e30.${claims}.ui-fixture`);
    localStorage.setItem('cp_ui_locale', locale);
  }, { claims, locale });
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/api/, '');
    requests.push({ method: request.method(), path });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      errors.push(`${role}: unexpected write ${request.method()} ${path}`);
      return route.fulfill({ status: 405, json: { message: 'Writes disabled in UI fixture' } });
    }
    if (path === '/admin/auth/me') return route.fulfill({ json: { userId: 'ui-role-fixture', email: 'role-fixture@example.invalid', role, mustChangePassword: false } });
    if (path === '/admin/staff') return route.fulfill({ json: [] });
    if (['/products', '/orders'].includes(path)) return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
    return route.fulfill({ status: 503, json: { message: 'UI fixture: external service unavailable' } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('main h1').waitFor();
  return { context, page, requests };
}
try {
  for (const role of roles) for (const locale of ['th', 'en']) {
    const { context, page, requests } = await open(role, locale);
    assert.ok(new URL(page.url()).pathname.startsWith('/workspaces/'), `${role}: permitted landing page`);
    const collapsed = page.locator('aside nav button[aria-expanded="false"]');
    while (await collapsed.count()) await collapsed.first().click();
    assert.equal(await page.locator('aside a[href="/settings/staff"]').count(), 0);
    assert.equal(await page.locator('aside a[href="/settings/josh-staff"]').count(), 0);
    assert.equal(await page.locator('aside a[href="/account/password"]').count(), 1);
    assert.ok(!requests.some(r => ['/admin/stats', '/reports/health'].includes(r.path)), `${role}: no admin-only top bar requests`);
    if (role === 'graphic') {
      await page.goto(`${base}/products`);
      await page.locator('main h1').waitFor();
      assert.equal(await page.getByRole('button', { name: locale === 'th' ? 'เพิ่มสินค้า' : 'Add product', exact: true }).count(), 0, 'Graphic cannot create a product');
      assert.equal(await page.getByRole('dialog').count(), 0);
    }
    if (role === 'business_analyst') {
      await page.goto(`${base}/orders`);
      await page.locator('main h1').waitFor();
      assert.equal(await page.getByRole('button', { name: locale === 'th' ? 'สร้างออเดอร์' : 'Create order', exact: true }).count(), 0, 'Analyst cannot create an order');
      await page.goto(`${base}/marketing/growth`);
      await page.locator('main h1').waitFor();
      assert.equal(await page.locator('main a[href="/marketing/growth/plans/new"]').count(), 0, 'Analyst cannot create a growth plan');
      assert.equal(await page.locator('main a[href="/marketing/growth/plans"]').count(), 0);
    }
    checks.push(`${role}: ${locale}`);
    await context.close();
  }
  const { context, page } = await open('admin', 'en');
  await page.goto(`${base}/settings/staff`);
  await page.locator('main h1').waitFor();
  await page.getByRole('button', { name: 'Add account', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const select = dialog.locator('select').filter({ has: page.locator('option[value="sales_manager"]') });
  assert.deepEqual((await select.locator('option').evaluateAll(options => options.map(o => o.value))).sort(), ['admin', ...roles].sort(), 'Admin can assign every current role');
  assert.ok(!/[\u0e00-\u0e7f]/.test(await select.innerText()), 'All role labels are translated in English');
  await select.selectOption('graphic');
  await page.getByRole('combobox', { name: 'Language', exact: true }).last().selectOption('th');
  assert.equal(await select.inputValue(), 'graphic', 'Language switch preserves the API role value');
  assert.ok(/[\u0e00-\u0e7f]/.test(await select.innerText()), 'Thai role labels render after switching');
  await context.close();
  checks.push('Admin: all seven role options translated; selected role retained');
  assert.deepEqual(errors, []);
  mkdirSync('.e2e-out/staff-roles', { recursive: true });
  writeFileSync('.e2e-out/staff-roles/results.json', JSON.stringify({ checks, errors, apiMode: 'mocked', operationalWrites: 0 }, null, 2));
  console.log(`PASS: ${checks.length} staff-role UI checks; no operational writes`);
} finally { await browser.close(); }
