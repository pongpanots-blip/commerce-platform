#!/usr/bin/env node
// Local UI regression: actual authentication/CRUD, navigation, keyboard, and responsive layouts.
// Prereqs: local stack + npm run seed:mock + Playwright Chromium.
// Optional PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH uses a preinstalled Chromium binary.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import ts from 'typescript';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:4403';
const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:4404';
const API = process.env.COMMERCE_TEST_API ?? 'http://localhost:3100/api';
for (const url of [ADMIN, PORTAL, API]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Use an isolated local stack');
const creds = JSON.parse(readFileSync('scripts/.mock-credentials', 'utf8'));
const source = readFileSync('apps/commerce-admin/src/app/navigation.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const navigation = {};
new Function('exports', compiled)(navigation);
const nav = navigation.navFor('admin');
const routes = nav.flatMap(group => group.links.map(link => link.to));
assert.equal(new Set(routes).size, routes.length, 'Every navigation route is unique');
assert.equal(routes.filter(route => !route.startsWith('/workspaces/')).length, 114, 'Retain all original navigation destinations');
for (const role of ['marketing', 'cs', 'merchandising', 'sales_manager', 'business_analyst', 'graphic']) {
  const allowed = navigation.navFor(role).flatMap(group => group.links.map(link => link.to));
  assert.ok(!allowed.includes('/settings/staff') && !allowed.includes('/settings/josh-staff'), 'Staff administration stays admin-only');
  assert.ok(allowed.includes('/account/password'), 'Every staff role can change its password');
}
assert.deepEqual(navigation.navFor(undefined), [], 'Unknown roles receive no navigation destinations');
const roleBoundaries = {
  marketing: { allow: ['/j/coupons', '/marketing/growth'], deny: ['/stock-moves', '/j/order', '/orders'] },
  merchandising: { allow: ['/products', '/stock-moves', '/j/allproducts'], deny: ['/j/coupons', '/j/order', '/orders'] },
  cs: { allow: ['/cs', '/j/order', '/j/shipments'], deny: ['/j/coupons', '/stock-moves', '/orders'] },
  sales_manager: { allow: ['/reports/sales', '/reports/winback'], deny: ['/j/coupons', '/stock-moves', '/orders'] },
  business_analyst: { allow: ['/reports/sales', '/orders', '/marketing/growth', '/erp/inventory-warehouse'], deny: ['/j/coupons', '/stock-moves', '/marketing/growth/plans'] },
  graphic: { allow: ['/products', '/j/allproducts', '/j/product/bulk-image-upload'], deny: ['/stock-moves', '/j/product/create', '/orders'] },
};
for (const [role, boundaries] of Object.entries(roleBoundaries)) {
  const allowed = navigation.navFor(role).flatMap(group => group.links.map(link => link.to));
  for (const path of boundaries.allow) assert.ok(allowed.includes(path), `${role} retains ${path}`);
  for (const path of boundaries.deny) assert.ok(!allowed.includes(path), `${role} does not receive ${path}`);
}
for (const workspace of navigation.WORKSPACES) {
  const links = nav.find(group => group.group === workspace.title).links.filter(link => !link.to.startsWith('/workspaces/'));
  const grouped = navigation.taskSectionsFor(workspace.id, links).flatMap(section => section.links.map(link => link.to));
  assert.deepEqual([...grouped].sort(), links.map(link => link.to).sort(), 'Task sections retain every permitted destination exactly once');
}
assert.ok(nav.find(group => group.group === 'สินค้าและสต็อก').links.some(link => link.to === '/j/price-requests'));
assert.ok(nav.find(group => group.group === 'ระบบเชื่อมต่อ').links.some(link => link.to === '/j/erp/webhook-simulator'));

const OUT = '.e2e-out/redesign';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
let admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
let portal = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures = [], unavailable = new Set(), checked = [];
const fixture = {};
let token;
function watch(page) {
  page.on('dialog', dialog => dialog.accept());
  page.on('pageerror', error => failures.push(`JavaScript (${new URL(page.url()).pathname}): ${error.message}`));
  page.on('response', response => { if (response.status() >= 500) unavailable.add(`${response.status()} ${new URL(response.url()).pathname}`); });
}
for (const page of [admin, portal]) watch(page);
async function open(page, url) {
  // Bound renderer memory during the large route audit while retaining actual authentication.
  if (checked.length && checked.length % 35 === 0) {
    const sessions = await page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
    const origin = new URL(page.url()).origin;
    const replacement = await browser.newPage({ viewport: page.viewportSize(), storageState: await page.context().storageState() });
    await replacement.addInitScript(({ origin, sessions }) => {
      if (window === window.top && location.origin === origin) {
        for (const [key, value] of Object.entries(sessions)) if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value);
      }
    }, { origin, sessions });
    watch(replacement);
    if (page === admin) admin = replacement;
    if (page === portal) portal = replacement;
    await page.close();
    page = replacement;
  }
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try { await page.locator('main').waitFor(); }
  catch (error) {
    const state = await page.evaluate(() => {
      const main = document.querySelector('main');
      return { path: location.pathname, hasSession: !!sessionStorage.getItem('cp_admin_token'), headings: [...document.querySelectorAll('h1')].map(h => h.textContent), mainPresent: !!main, mainDisplay: main ? getComputedStyle(main).display : null, rootChildren: document.getElementById('root')?.children.length };
    });
    throw new Error(`${new URL(url).pathname}: main unavailable ${JSON.stringify(state)}`, { cause: error });
  }
  if (new URL(url).pathname.startsWith('/j/')) {
    await page.waitForFunction(() => {
      const content = document.querySelector('main .josh-tw')?.textContent?.trim();
      return content && !/^Loading(?:…|\.\.\.)$/.test(content);
    }, undefined, { timeout: 6000 });
  } else await page.locator('main h1').first().waitFor({ timeout: 6000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `${new URL(url).pathname}: no horizontal page overflow (${overflow})`);
  checked.push(new URL(url).pathname);
  if (checked.length % 25 === 0) console.log(`Checked ${checked.length} page visits`);
}
async function login(page, base, who) {
  await page.goto(base);
  await page.getByRole('combobox', { name: /^(ภาษา|Language)$/ }).selectOption('en');
  await page.getByLabel('Email', { exact: true }).fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('main h1').waitFor();
  if (base === ADMIN) await page.getByRole('combobox', { name: /^(ภาษา|Language)$/ }).selectOption('th');
}
async function checkPageFilters(page) {
  const rows = page.locator('main tbody tr');
  await rows.first().waitFor();
  const initialCount = await rows.count();
  const identifier = (await rows.first().locator('td').first().innerText()).split('\n')[0].trim();
  await page.getByLabel('ค้นหาในหน้านี้', { exact: true }).fill(identifier);
  await page.waitForFunction(value => [...document.querySelectorAll('main tbody tr')].every(row => row.textContent.toLocaleLowerCase().includes(value.toLocaleLowerCase())), identifier);
  assert.ok(await rows.count() > 0 && await rows.count() <= initialCount, 'Current-page search shows matching loaded rows');
  await page.getByLabel('ค้นหาในหน้านี้', { exact: true }).fill(`absent-${randomUUID()}`);
  await page.getByText('ไม่พบรายการในหน้านี้ ล้างตัวกรองหรือเปิดหน้าถัดไป', { exact: true }).waitFor();
  assert.equal(await rows.count(), 0);
  assert.equal(await page.getByRole('button', { name: 'ถัดไป', exact: true }).isVisible(), true, 'Pagination remains available when the current page has no filter matches');
  await page.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  assert.equal(await rows.count(), initialCount, 'Clearing restores the loaded page');
  const options = await page.getByLabel('สถานะในหน้านี้', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  if (options.length) {
    await page.getByLabel('สถานะในหน้านี้', { exact: true }).selectOption(options[0]);
    const statuses = await rows.locator('[data-status]').evaluateAll((nodes, status) => nodes.filter(node => node.getAttribute('data-status') === status).length, options[0]);
    assert.equal(statuses, await rows.count(), 'Status filtering keeps only the selected status');
    await page.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
  }
}
try {
  await login(admin, ADMIN, creds.admin);
  token = await admin.evaluate(() => sessionStorage.getItem('cp_admin_token'));
  await admin.screenshot({ path: `${OUT}/admin-overview.png`, fullPage: true });

  // Visit every category first, then the original destinations. No network response mocking.
  for (const route of [...routes.filter(route => route.startsWith('/workspaces/')), ...routes.filter(route => !route.startsWith('/workspaces/'))]) {
    try { await open(admin, ADMIN + route); }
    catch (error) { failures.push(`${route}: ${error.message}`); }
  }
  await open(admin, ADMIN + '/workspaces/catalog');
  await admin.getByLabel('ค้นหาในหมวด').fill('คำที่ไม่มีเมนู');
  await admin.getByText('ไม่พบเมนูที่ค้นหา ลองใช้คำอื่น').waitFor();
  await admin.getByLabel('ค้นหาในหมวด').fill('');
  await admin.screenshot({ path: `${OUT}/catalog-workspace.png`, fullPage: true });

  await admin.keyboard.press('Control+k');
  const command = admin.getByRole('dialog', { name: 'ไปยังหน้าที่ต้องการ' });
  await command.getByRole('combobox').fill('แคตตาล็อกแพลตฟอร์ม');
  await admin.keyboard.press('Enter');
  await admin.waitForURL('**/products');
  assert.equal(await command.count() ? await command.isVisible() : false, false, 'Palette closes after navigation');

  // A created item can be opened directly even when the list's default order is unchanged.
  await admin.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).click();
  let modal = admin.getByRole('dialog', { name: 'เพิ่มสินค้า', exact: true });
  await modal.getByLabel('SKU', { exact: true }).fill(`ui-${randomUUID()}`);
  await modal.getByLabel('ชื่อสินค้า', { exact: true }).fill('UI regression product');
  await modal.getByLabel('รายละเอียด', { exact: true }).fill('Isolated local fixture');
  const productResponse = admin.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${API}/products`);
  await modal.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).click();
  fixture.product = await (await productResponse).json();
  await admin.getByRole('link', { name: 'ดูรายการที่เพิ่ม', exact: true }).click();
  await admin.getByRole('heading', { name: 'UI regression product', exact: true }).waitFor();
  await admin.getByRole('button', { name: 'แก้ไขสินค้า', exact: true }).click();
  modal = admin.getByRole('dialog', { name: 'แก้ไขสินค้า', exact: true });
  await modal.getByLabel('รายละเอียด', { exact: true }).fill('Edited through the accessible dialog');
  const productPatch = admin.waitForResponse(response => response.request().method() === 'PATCH' && response.url() === `${API}/products/${fixture.product.id}`);
  await modal.getByRole('button', { name: 'บันทึก', exact: true }).click();
  assert.equal((await productPatch).status(), 200);
  await admin.getByText('บันทึกการแก้ไขสินค้าเรียบร้อยแล้ว', { exact: true }).waitFor();
  await admin.getByText('Edited through the accessible dialog', { exact: true }).waitFor();

  await open(admin, ADMIN + '/customers');
  await admin.getByRole('button', { name: 'เพิ่มลูกค้า', exact: true }).click();
  modal = admin.getByRole('dialog', { name: 'เพิ่มลูกค้า', exact: true });
  await modal.getByLabel('ชื่อลูกค้า').fill('UI regression customer');
  await modal.getByLabel('อีเมล').fill('ui-regression@example.test');
  const customerResponse = admin.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${API}/customers`);
  await modal.getByRole('button', { name: 'เพิ่มลูกค้า', exact: true }).click();
  fixture.customer = await (await customerResponse).json();
  await admin.getByRole('link', { name: 'ดูรายการที่เพิ่ม', exact: true }).click();
  await admin.getByRole('heading', { name: 'UI regression customer', exact: true }).waitFor();
  await admin.getByRole('button', { name: 'แก้ไขลูกค้า', exact: true }).click();
  modal = admin.getByRole('dialog', { name: 'แก้ไขลูกค้า', exact: true });
  await modal.getByLabel('เบอร์โทร', { exact: true }).fill('021234567');
  const customerPatch = admin.waitForResponse(response => response.request().method() === 'PATCH' && response.url() === `${API}/customers/${fixture.customer.id}`);
  await modal.getByRole('button', { name: 'บันทึก', exact: true }).click();
  assert.equal((await customerPatch).status(), 200);
  await admin.getByText('021234567', { exact: true }).waitFor();

  await open(admin, ADMIN + '/orders');
  await admin.getByRole('button', { name: 'สร้างออเดอร์', exact: true }).click();
  modal = admin.getByRole('dialog', { name: 'สร้างออเดอร์', exact: true });
  await modal.getByLabel('ลูกค้า', { exact: true }).selectOption('manual');
  await modal.getByLabel('รหัสลูกค้า', { exact: true }).fill(fixture.customer.id);
  await modal.getByLabel('สินค้า 1', { exact: true }).selectOption('manual');
  await modal.getByLabel('รหัสสินค้า 1', { exact: true }).fill(fixture.product.id);
  await modal.getByLabel('จำนวน 1', { exact: true }).fill('5');
  await modal.getByLabel('ราคาต่อหน่วย 1', { exact: true }).fill('10.50');
  await modal.getByText('฿52.50', { exact: true }).waitFor();
  await modal.getByRole('button', { name: 'เพิ่มรายการสินค้า', exact: true }).click();
  await modal.getByRole('button', { name: 'ลบรายการสินค้า 2' }).click();
  await admin.screenshot({ path: `${OUT}/order-form.png` });
  const orderResponse = admin.waitForResponse(response => response.request().method() === 'POST' && response.url() === `${API}/orders`);
  await modal.getByRole('button', { name: 'สร้างออเดอร์', exact: true }).click();
  fixture.order = await (await orderResponse).json();
  await admin.waitForURL(`**/orders/${fixture.order.id}`);

  await open(admin, ADMIN + '/stock-moves');
  await admin.getByRole('button', { name: /^ตรวจนับ/ }).click();
  assert.equal(await admin.getByLabel('ยอดที่นับได้ทั้งหมด', { exact: true }).getAttribute('min'), '0');
  await admin.getByRole('button', { name: /^ปรับยอด/ }).click();
  await admin.getByLabel('เหตุผล', { exact: true }).selectOption('CORRECTION');
  assert.equal(await admin.getByLabel('จำนวน', { exact: true }).getAttribute('min'), null);
  await admin.getByLabel('เหตุผล', { exact: true }).selectOption('DAMAGE');
  assert.equal(await admin.getByLabel('จำนวน', { exact: true }).getAttribute('min'), '1');
  await admin.getByRole('button', { name: /^โอนย้าย/ }).click();
  const sourceWarehouses = await admin.getByLabel('จากคลัง', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  if (sourceWarehouses.length) {
    await admin.getByLabel('จากคลัง', { exact: true }).selectOption(sourceWarehouses[0]);
    assert.equal(await admin.getByLabel('ไปคลัง', { exact: true }).locator(`option[value="${sourceWarehouses[0]}"]`).count(), 0, 'Transfer destination excludes the selected source');
  }
  await admin.screenshot({ path: `${OUT}/stock-moves.png`, fullPage: true });

  await open(admin, ADMIN + '/integrations');
  await admin.getByRole('button', { name: 'เพิ่มการเชื่อมต่อ', exact: true }).click();
  modal = admin.getByRole('dialog', { name: 'เพิ่มการเชื่อมต่อ', exact: true });
  assert.equal(await modal.getByLabel('Secret สำหรับตรวจลายเซ็น', { exact: true }).getAttribute('type'), 'password');
  await admin.keyboard.press('Escape');
  await open(admin, ADMIN + '/settings/staff');
  await admin.getByRole('button', { name: 'เพิ่มบัญชี', exact: true }).click();
  await admin.getByRole('dialog', { name: 'เพิ่มบัญชีทีมงาน', exact: true }).waitFor();
  await admin.keyboard.press('Escape');

  await open(admin, ADMIN + '/products');
  await admin.getByLabel('จำนวนรายการต่อหน้า').selectOption('50');
  await admin.waitForFunction(() => document.querySelectorAll('main tbody tr').length === 50);
  await checkPageFilters(admin);
  await admin.screenshot({ path: `${OUT}/products-list.png`, fullPage: true });
  await admin.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).click();
  await admin.keyboard.press('Escape');
  assert.equal(await admin.getByRole('dialog', { name: 'เพิ่มสินค้า', exact: true }).isVisible(), false, 'Escape closes the form');
  assert.equal(await admin.getByRole('button', { name: 'เพิ่มสินค้า', exact: true }).evaluate(element => element === document.activeElement), true, 'Closing a creation dialog restores its trigger focus');
  await admin.keyboard.press('Control+k');
  await admin.keyboard.press('Escape');
  assert.equal(await admin.getByLabel('ค้นหาหน้าและเมนู').evaluate(element => element === document.activeElement), true, 'Keyboard focus returns to the palette trigger');
  for (const route of ['/customers', '/orders']) {
    await open(admin, ADMIN + route);
    await checkPageFilters(admin);
  }

  await login(portal, PORTAL, creds.partner);
  for (const route of ['/', '/keys', '/webhooks', '/docs']) await open(portal, PORTAL + route);
  await portal.getByRole('button', { name: 'Create Key', exact: true }).click();
  await portal.getByRole('dialog', { name: 'Create API key', exact: true }).waitFor();
  await portal.keyboard.press('Escape');
  await open(portal, PORTAL + '/webhooks?create=1');
  await portal.getByRole('dialog', { name: 'Create webhook', exact: true }).waitFor();
  await portal.keyboard.press('Escape');
  await open(portal, PORTAL);
  await portal.getByLabel('Delivery status', { exact: true }).selectOption('success');
  assert.equal(await portal.locator('main tbody tr').filter({ hasText: 'pending' }).count(), 0, 'Delivery status filtering hides nonmatching rows');
  await portal.getByLabel('Delivery status', { exact: true }).selectOption('');
  const refreshResponse = portal.waitForResponse(response => response.url().includes('/v1/portal/deliveries'));
  await portal.getByRole('button', { name: 'Refresh logs', exact: true }).click();
  assert.equal((await refreshResponse).status(), 200, 'Refreshing logs fetches live API data');
  await portal.screenshot({ path: `${OUT}/portal-overview.png`, fullPage: true });

  for (const width of [390, 768]) {
    await admin.setViewportSize({ width, height: 844 });
    for (const route of ['/workspaces/catalog', '/products', '/orders', '/workspaces/marketing', '/stock-moves', '/integrations', '/settings/staff', `/products/${fixture.product.id}`, `/customers/${fixture.customer.id}`]) await open(admin, ADMIN + route);
    if (width === 390) {
      await admin.getByRole('button', { name: 'เมนู', exact: true }).click();
      await admin.getByLabel('ค้นหาเมนู', { exact: true }).fill('แคตตาล็อกแพลตฟอร์ม');
      await admin.locator('aside').getByRole('link', { name: 'แคตตาล็อกแพลตฟอร์ม', exact: true }).click();
      await admin.getByRole('heading', { name: 'แคตตาล็อกแพลตฟอร์ม', exact: true }).waitFor();
      assert.equal(await admin.getByLabel('ค้นหาเมนู', { exact: true }).isVisible(), false, 'Mobile menu closes after following a link');
      await admin.screenshot({ path: `${OUT}/mobile-catalog.png`, fullPage: true });
    }
    await portal.setViewportSize({ width, height: 844 });
    for (const route of ['/', '/keys', '/webhooks', '/docs']) await open(portal, PORTAL + route);
  }
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ pagesChecked: checked.length, failures, unavailableEndpoints: [...unavailable], checks: ['114 original destinations', '7 categories and complete task sections', 'role filtering', 'keyboard navigation', 'product/customer create and edit, order creation', 'current-page search/status/empty/clear', 'stock task constraints and distinct warehouses', 'password-masked integration form', 'staff create dialog', 'page size', 'modal Escape/focus', 'portal create links and delivery filters/refresh', 'mobile/tablet overflow'] }, null, 2));
  assert.deepEqual(failures, [], 'All visited screens render without JavaScript failures or horizontal overflow');
  console.log(`PASS: ${checked.length} page visits; navigation, roles, keyboard, actual CRUD, Portal entry points, mobile/tablet layouts.`);
  console.log(`External/backend endpoints returning 5xx: ${unavailable.size} (recorded separately in results.json; live integrations are not validated).`);
} finally {
  writeFileSync(`${OUT}/last-run.json`, JSON.stringify({ pagesChecked: checked.length, failures, unavailableEndpoints: [...unavailable] }, null, 2));
  if (token) for (const [kind, item] of [['orders', fixture.order], ['products', fixture.product], ['customers', fixture.customer]]) {
    if (item?.id) await admin.request.delete(`${API}/${kind}/${item.id}`, { headers: { authorization: `Bearer ${token}` } });
  }
  await browser.close();
}
