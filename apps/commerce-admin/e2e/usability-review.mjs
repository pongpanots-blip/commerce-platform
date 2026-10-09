#!/usr/bin/env node
// Local builds and synthetic records only. Every API request is intercepted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const out = resolve(process.env.UI_REVIEW_OUT ?? '.e2e-out/usability-review');
const builds = [['after', resolve(process.env.UI_REVIEW_BUILD ?? 'dist/apps/commerce-admin')]];
if (process.env.UI_REVIEW_BEFORE) builds.unshift(['before', resolve(process.env.UI_REVIEW_BEFORE)]);
const dictionary = JSON.parse(readFileSync('libs/ui/src/locales/ui-messages.json', 'utf8'));
const text = (locale, key) => dictionary[key]?.[locale] ?? key;
const customerId = '00000000-0000-4000-8000-000000000001';
const productId = '00000000-0000-4000-8000-000000000002';
const category = { category_id_uuid: '00000000-0000-4000-8000-000000000003', category_name_en: 'Bakery', category_name_th: 'Bakery fixture', category_code: 'BAK', parent_id_uuid: null, category_level: 0 };
const errors = [], checks = [], screenshots = [], blockedExternal = [];
const layoutVisits = [], layoutIssues = [];
const inventory = JSON.parse(readFileSync('docs/design/stitch/full-ui-bilingual/inventory.json', 'utf8')).routes;
const managementRoutes = [...readFileSync('apps/commerce-admin/src/josh-admin/JoshAdminApp.tsx', 'utf8').matchAll(/<Route path="([^"]+)"/g)]
  .filter(match => match[1] !== '*').map(match => ({ app: 'admin', path: '/j/' + match[1] }));
managementRoutes.push(...inventory.filter(route => route.app === 'admin' && route.file.includes('/workflow-editor/')));
const layoutPreviews = new Set(['/j/categories/create', '/j/supplier/create', '/j/order', '/j/shipments', '/j/bot/workflows/create', '/j/marketing-links', '/j/product/create', '/j/product/edit/:id', '/j/bot/workflows/edit/:id', '/j/supplier/edit/:id']);
const servers = [];
let browser;
mkdirSync(out, { recursive: true });

async function serve(root) {
  assert.ok(existsSync(resolve(root, 'index.html')), `Build missing: ${root}`);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    if (!existsSync(file) || !statSync(file).isFile()) file = resolve(root, 'index.html');
    res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(base, locale, role = 'admin') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const requests = [];
  const claims = Buffer.from(JSON.stringify({ sub: 'local-usability-fixture', email: 'fixture@example.invalid', role, exp: 4102444800 })).toString('base64url');
  await context.addInitScript(({ claims, locale }) => {
    if (window.top !== window) return;
    sessionStorage.setItem('cp_admin_token', `e30.${claims}.fixture`);
    localStorage.setItem('cp_ui_locale', locale);
  }, { claims, locale });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) { blockedExternal.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.slice(4), method = req.method();
    const body = req.postDataJSON();
    requests.push({ path, method, body });
    const json = data => route.fulfill({ json: data });
    if (path === '/admin/auth/me') return json({ userId: 'local-usability-fixture', email: 'fixture@example.invalid', role, mustChangePassword: false });
    if (path === '/ownership') return json({ segments: true, categories: true, promotions: true });
    if (path === '/josh/admin-call' && body?.method === 'GET') {
      if (body.path === '/brands') return json({ data: [{ brand_code: 'FIX', brand_name_en: 'Fixture brand', brand_name_th: 'Fixture brand' }] });
      if (/^\/product-category\/[^/]+$/.test(body.path)) return json({ data: category });
      if (body.path.startsWith('/product-category')) return json({ data: [category] });
      if (/^\/product\/[^/]+\/cuisines$/.test(body.path) || body.path === '/cuisine/catalog') return json({ data: [] });
      if (/^\/product\/[^/]+$/.test(body.path)) return json({ product_inventory_id: productId, product_inventory_sku: 'FIX-001', product_name: 'Fixture product', product_status: 1, product_inventory_quantity: 3, base_selling_price: 25, selling_unit_price: 25, selling_unit: 'piece', brand_code: 'FIX', translations: [{ lang: 'th', product_name: 'Fixture product' }, { lang: 'en', product_name: 'Fixture product' }], media: [], promotion_rules: [] });
      if (/^\/supplier\/[^/]+$/.test(body.path)) return json({ data: { id: customerId, supplier_name: 'Fixture supplier', contact_name: '', phone: '', email: '', address: '' } });
      if (/^\/admin\/bot\/workflows\/[^/]+$/.test(body.path)) return json({ id: customerId, name: 'Fixture workflow', triggerEvent: 'message', active: true, steps: [] });
      if (['/supplier', '/bot/templates', '/bot/workflows', '/user-segments', '/product-inventory'].includes(body.path)) return json({ data: [], total: 0, meta: { page: 1, total: 0, totalPages: 1 } });
      return route.fulfill({ status: 503, json: { message: 'Unavailable in local fixture' } });
    }
    if (method === 'GET' && ['/customers', '/products', '/orders'].includes(path)) {
      const items = path === '/customers' ? [{ id: customerId, name: 'Fixture customer', code: 'C001' }] : path === '/products' ? [{ id: productId, sku: 'FIX-001', name: 'Fixture product' }] : [];
      return json({ items, total: items.length, page: 1, pageSize: 20 });
    }
    if (path === '/stock/warehouses') return json([
      { id: 'w1', code: 'LOCAL-A', name: 'Fixture A', stockSource: 'commerce', sellable: true },
      { id: 'w2', code: 'LOCAL-B', name: 'Fixture B', stockSource: 'commerce', sellable: true },
      { id: 'w3', code: 'ERP-HIDDEN', name: 'ERP fixture', stockSource: 'erp', sellable: true },
    ]);
    if (path === '/marketing-research/sources') return json({ data: [{ id: 'tat', ready: true, reason: '' }, { id: 'osm', ready: true, reason: '' }] });
    if (path === '/marketing-research/topics' && method === 'GET') return json({ data: { items: [], totalCount: 0, page: 1, limit: 20 } });
    if (path === '/product-category' && method === 'POST') return json({ data: { ...category, category_id_uuid: '00000000-0000-4000-8000-000000000004', category_name_en: body.category_name_en, category_name_th: null, category_code: null } });
    if (path === '/marketing-research/topics' && method === 'POST') return route.fulfill({ status: 400, json: { message: 'Fixture save rejected' } });
    if (path === '/orders' && method === 'POST') return route.fulfill({ status: 400, json: { message: 'Fixture order rejected' } });
    return route.fulfill({ status: 503, json: { message: 'Unavailable in local fixture' } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  return { context, page, requests };
}

async function open(page, base, path) {
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.locator('main').waitFor();
  assert.ok((await page.locator('main').innerText()).length > 60, `Blank page: ${path}`);
}

async function shot(page, build, locale, name) {
  await page.evaluate(({ build, locale }) => {
    const badge = document.createElement('div');
    badge.id = 'review-fixture-label';
    badge.textContent = `LOCAL TEST BUILD · ${build} · ${locale} · SYNTHETIC RECORDS`;
    badge.style.cssText = 'position:fixed;right:8px;top:8px;z-index:99999;background:#fff;color:#222;border:1px solid #888;padding:4px 8px;font:12px sans-serif;pointer-events:none';
    document.body.appendChild(badge);
  }, { build, locale });
  const file = `${build}-${locale}-${name}.png`;
  await page.screenshot({ path: resolve(out, file) });
  assert.ok(statSync(resolve(out, file)).size > 10000, `Screenshot appears blank: ${file}`);
  screenshots.push(file);
  await page.locator('#review-fixture-label').evaluate(node => node.remove());
}

async function auditLayouts(base, build, locale) {
  const routes = build === 'before' ? managementRoutes.filter(route => layoutPreviews.has(route.path)) : managementRoutes;
  for (const [viewport, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    const { context, page } = await fixture(base, locale);
    await page.setViewportSize({ width, height });
    for (const route of routes) {
      const path = route.path.replace(/:\w+/g, customerId);
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.locator('main').waitFor();
      const metrics = await page.locator('main').evaluate(main => {
        const frame = main.querySelector('.cp-task-content');
        const root = frame?.firstElementChild;
        const bounds = node => node ? { x: node.getBoundingClientRect().x, width: node.getBoundingClientRect().width, padding: getComputedStyle(node).paddingLeft } : null;
        const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const offenders = overflow ? [...main.querySelectorAll('*')].filter(node => {
          const rect = node.getBoundingClientRect();
          if (!rect.width || rect.right <= innerWidth + 1) return false;
          for (let owner = node.parentElement; owner && owner !== main; owner = owner.parentElement) if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(owner).overflowX)) return false;
          return true;
        }).slice(0, 6).map(node => ({ tag: node.tagName, className: node.className, text: node.textContent?.slice(0, 100) })) : [];
        return { title: main.querySelector('h1')?.textContent ?? null, textLength: main.textContent?.trim().length ?? 0, overflow, frame: bounds(frame), root: bounds(root), offenders };
      });
      const visit = { build, locale, viewport, path: route.path, ...metrics };
      layoutVisits.push(visit);
      if (layoutVisits.length % 50 === 0) console.log(`Checked ${layoutVisits.length} layout visits`);
      if (build === 'after' && (metrics.overflow || !metrics.textLength || new URL(page.url()).pathname !== path || (metrics.frame && metrics.root && Math.abs(metrics.root.x - metrics.frame.x) > 1))) layoutIssues.push(visit);
      if (layoutPreviews.has(route.path) && !(viewport === 'desktop' && route.path === '/j/product/create')) {
        await page.evaluate(() => {
          const main = document.querySelector('main');
          const header = document.querySelector('header');
          window.scrollTo(0, Math.max(0, main.getBoundingClientRect().top + scrollY - (header?.getBoundingClientRect().height ?? 0) - 16));
        });
        await shot(page, build, locale, `layout-${viewport}-${route.path.slice(3).replaceAll('/', '-')}`);
      }
    }
    await context.close();
  }
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const [build, root] of builds) {
    const base = await serve(root);
    for (const locale of ['th', 'en']) {
      const { context, page, requests } = await fixture(base, locale);
      await open(page, base, '/j/product/create');
      await shot(page, build, locale, 'product-create');
      if (build === 'after') {
        const brand = page.getByRole('combobox', { name: text(locale, 'แบรนด์'), exact: true });
        await brand.click();
        await page.getByRole('option', { name: 'Fixture brand (FIX)', exact: true }).click();
        assert.equal(await brand.inputValue(), 'Fixture brand (FIX)');
        await brand.click();
        await page.getByRole('option', { name: text(locale, 'ไม่ระบุแบรนด์'), exact: true }).click();
        assert.equal(await brand.inputValue(), text(locale, 'ไม่ระบุแบรนด์'));
        const categoryPicker = page.locator('main input[role="combobox"]').first();
        await categoryPicker.fill('New fixture category');
        await page.getByRole('option', { name: text(locale, 'สร้าง "{0}"').replace('{0}', 'New fixture category'), exact: true }).click();
        const mini = page.locator('dialog[open]');
        assert.equal(await mini.locator('form').count(), 1);
        await mini.locator('input').first().press('Enter');
        await mini.waitFor({ state: 'hidden' });
        assert.equal(requests.filter(r => r.method === 'POST' && r.path === '/product-category').length, 1);
        assert.equal(requests.filter(r => r.path === '/josh/products').length, 0);
        checks.push(`${locale}: brand clears; inline category Enter saves once without product submit`);
      }
      await open(page, base, '/stock-moves');
      await shot(page, build, locale, 'stock-move');
      if (build === 'after') {
        await page.getByPlaceholder('BREAD-001').fill('FIX-001');
        await page.getByRole('spinbutton').fill('3');
        await page.getByRole('button', { name: text(locale, 'บันทึก{0}').replace('{0}', text(locale, 'รับเข้า')), exact: true }).click();
        assert.equal(requests.filter(r => r.path === '/stock/adjustments').length, 0, 'Required warehouse blocks submit');
        const picker = page.getByRole('combobox').filter({ hasNot: page.locator('option') }).first();
        await picker.fill('Unknown warehouse');
        assert.equal(await picker.evaluate(node => node.checkValidity()), false);
        assert.equal(await page.getByRole('option', { name: /ERP-HIDDEN/ }).count(), 0);
        checks.push(`${locale}: stock requires a selected owned warehouse`);
      }
      await open(page, base, '/orders');
      await page.getByRole('button', { name: text(locale, 'สร้างออเดอร์'), exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await shot(page, build, locale, 'order-create');
      if (build === 'after') {
        await dialog.getByRole('combobox').filter({ has: page.locator('option[value="manual"]') }).nth(0).selectOption('manual');
        await dialog.getByPlaceholder(text(locale, 'รหัส UUID ของลูกค้า')).fill('00000000-0000-4000-8000-000000000099');
        await dialog.getByRole('combobox').filter({ has: page.locator('option[value="manual"]') }).nth(1).selectOption('manual');
        await dialog.getByPlaceholder(text(locale, 'รหัส UUID ของสินค้า')).fill('00000000-0000-4000-8000-000000000098');
        await dialog.getByRole('spinbutton').nth(1).fill('25');
        await dialog.getByRole('button', { name: text(locale, 'ปิด'), exact: true }).click();
        const confirm = page.locator('dialog[open]').last();
        await confirm.getByRole('button').first().click();
        assert.equal(await dialog.getByPlaceholder(text(locale, 'รหัส UUID ของลูกค้า')).inputValue(), '00000000-0000-4000-8000-000000000099');
        await dialog.getByRole('button', { name: text(locale, 'สร้างออเดอร์'), exact: true }).click();
        await page.getByText('Fixture order rejected', { exact: true }).waitFor();
        const submitted = requests.find(r => r.path === '/orders' && r.method === 'POST');
        assert.equal(submitted.body.customerId, '00000000-0000-4000-8000-000000000099');
        assert.equal(submitted.body.lines[0].productId, '00000000-0000-4000-8000-000000000098');
        checks.push(`${locale}: UUID fallback, canceled modal close, failed order keeps values`);
      }
      await context.close();
      const next = await fixture(base, locale);
      await open(next.page, base, '/orders');
      if (build === 'after') {
        const help = next.page.getByRole('button', { name: text(locale, 'ช่วยเหลือ'), exact: true });
        assert.equal(await help.getAttribute('aria-expanded'), 'false');
        await help.click();
        assert.equal(await help.getAttribute('aria-expanded'), 'true');
      }
      await shot(next.page, build, locale, 'help');
      if (build === 'after') {
        await open(next.page, base, '/marketing/research');
        const title = next.page.locator('main input[maxlength="400"]');
        await title.fill('Local research fixture');
        await next.page.getByRole('button', { name: text(locale, 'บันทึกโจทย์'), exact: true }).click();
        await next.page.getByText('Fixture save rejected', { exact: true }).waitFor();
        assert.equal(await title.inputValue(), 'Local research fixture');
        assert.equal(await next.page.getByText(text(locale, 'บันทึกโจทย์แล้ว'), { exact: true }).count(), 0);
        const nativeDialogs = [];
        next.page.on('dialog', async dialog => { nativeDialogs.push(dialog.type()); await dialog.accept(); });
        const collapsed = next.page.locator('aside nav button[aria-expanded="false"]');
        while (await collapsed.count()) await collapsed.first().click();
        await next.page.locator('aside a[href="/orders"]').first().click();
        const leave = next.page.locator('dialog[open]');
        await leave.waitFor();
        await leave.getByRole('button').last().click();
        await next.page.waitForURL(base + '/orders');
        assert.deepEqual(nativeDialogs, [], 'One custom confirmation must not trigger a second browser prompt');
        checks.push(`${locale}: failed research keeps text and guard; confirmed navigation asks once`);
        await open(next.page, base, '/j/supplier/create');
        const supplier = next.page.getByLabel(text(locale, 'ชื่อผู้จัดจำหน่าย'), { exact: false });
        await supplier.fill('Unsaved supplier fixture');
        const failedSave = next.page.waitForResponse(response => response.url().endsWith('/api/josh/admin-call') && response.request().postDataJSON()?.method === 'POST');
        await next.page.getByRole('button', { name: text(locale, 'บันทึกผู้จัดจำหน่าย'), exact: true }).click();
        await failedSave;
        const menu = next.page.locator('aside nav button[aria-expanded="false"]');
        while (await menu.count()) await menu.first().click();
        await next.page.locator('aside a[href="/orders"]').first().click();
        const keep = next.page.locator('dialog[open]');
        await keep.waitFor();
        await keep.getByRole('button').first().click();
        assert.equal(await supplier.inputValue(), 'Unsaved supplier fixture');
        assert.equal(new URL(next.page.url()).pathname, '/j/supplier/create');
        checks.push(`${locale}: failed legacy editor save preserves values and leave protection`);
      }
      await next.context.close();
      if (!process.env.UI_REVIEW_SKIP_ROUTE_AUDIT) await auditLayouts(base, build, locale);
    }
  }
  writeFileSync(resolve(out, 'layout-results.json'), JSON.stringify({ routes: managementRoutes.length, visits: layoutVisits, issues: layoutIssues, apiMode: 'synthetic fixtures; unavailable reads show error states' }, null, 2) + '\n');
  assert.deepEqual(errors, []);
  assert.equal(layoutIssues.length, 0, 'Management layout failures: ' + layoutIssues.map(item => `${item.locale}/${item.viewport} ${item.path}`).join(', '));
  writeFileSync(resolve(out, 'results.json'), JSON.stringify({ checks, screenshots, errors, blockedExternal: [...new Set(blockedExternal)], apiMode: 'synthetic fixtures', productionRequests: 0 }, null, 2) + '\n');
  console.log(`PASS: ${checks.length} workflow checks; ${screenshots.length} before/after screenshots`);
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => new Promise(ok => server.close(ok))));
}
