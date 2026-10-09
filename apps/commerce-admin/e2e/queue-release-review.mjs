#!/usr/bin/env node
// Local build with synthetic rows; intercept every API request and external URL.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root = resolve('dist/apps/commerce-admin');
const out = resolve(process.env.QUEUE_REVIEW_OUT || '/workspace/reports/commerce-prod-queue-browser');
mkdirSync(out, { recursive: true });
const dictionary = JSON.parse(readFileSync('libs/ui/src/locales/ui-messages.json', 'utf8'));
const text = (locale, key) => (dictionary[key] ?? dictionary[key.trim()])?.[locale] ?? key;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  let file = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file)) file = resolve(root, 'index.html');
  res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, headless: true });
const checks = [], errors = [];
try {
  for (const locale of ['th', 'en']) for (const [viewport, width, height] of [['desktop',1440,1000],['phone',390,844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const claims = Buffer.from(JSON.stringify({ sub: 'local-queue-review', email: 'fixture@example.invalid', role: 'admin', exp: 4102444800 })).toString('base64url');
    await context.addInitScript(({ locale, claims }) => {
      if (window.top !== window) return;
      localStorage.setItem('cp_ui_locale', locale);
      sessionStorage.setItem('cp_admin_token', `e30.${claims}.fixture`);
    }, { locale, claims });
    const requests = [];
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== base) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const path = url.pathname.slice(4);
      requests.push({ path, search: url.search, method: req.method(), body: req.postDataJSON() });
      if (path === '/admin/auth/me') return route.fulfill({ json: { userId: 'local-queue-review', email: 'fixture@example.invalid', role: 'admin', mustChangePassword: false } });
      if (path === '/ownership') return route.fulfill({ json: { prices: true, productMaster: true, ordering: true } });
      if (/\/pending\/(approve|reject)$/.test(path)) return route.fulfill({ status: 400, json: { message: 'Fixture approval rejected' } });
      if (['/product-prices','/product-prices/pending','/product-masters/pending','/order-periods'].includes(path)) {
        const page = Number(url.searchParams.get('page') || 1), limit = Number(url.searchParams.get('limit') || 20);
        const rows = Array.from({ length: 23 }, (_, i) => ({ sku: `FIX-${String(i+1).padStart(3,'0')}`, selling_unit_price: '20', ordering_price: '18', moq: 1, current_selling_unit_price: '19', current_ordering_price: '17', current_moq: 1, changed_at: '2026-10-08T00:00:00Z', received_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z', source: 'fixture', patch: { selling_unit: 'piece' }, current: { selling_unit: 'pack' }, sup_code: 'FIX-SUP', erp_order_period: `FIX-${String(i+1).padStart(3,'0')}`, date_from: '2026-10-10', date_to: '2026-10-11', close_at: null, status: 'O', synced_at: '2026-10-08T00:00:00Z' }));
        const needle = url.searchParams.get('search') || '';
        const filtered = needle ? rows.filter(row => row.sku.includes(needle)) : rows;
        return route.fulfill({ json: { items: filtered.slice((page-1)*limit,page*limit), total: filtered.length, page, limit } });
      }
      return route.fulfill({ status: 503, json: { message: 'Unavailable in synthetic review' } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const path of ['/product-prices','/product-master-queue','/order-periods']) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.locator('main tbody tr').first().waitFor();
      assert.equal(await page.locator('main tbody').first().locator('tr').count(), 20);
      const next = page.getByRole('button', { name: text(locale,'ถัดไป'), exact: true }).first();
      const approval = page.locator('main button').filter({ hasText: new RegExp('^'+text(locale,'อนุมัติ ').trim()) }).first();
      if (path !== '/order-periods') {
        await page.locator('main input[type="checkbox"]').first().check();
        await approval.waitFor(); assert.equal(await approval.isEnabled(), true);
      }
      await next.click();
      await page.locator('main tbody').first().getByText('FIX-021',{exact:true}).waitFor();
      assert.equal(await page.locator('main tbody').first().locator('tr').count(), 3);
      if (path !== '/order-periods') {
        assert.equal(await approval.isDisabled(), true, 'Selection must clear when paging');
        await page.locator('main input[type="checkbox"]').first().check();
        await approval.click();
        const error = page.getByText('Fixture approval rejected',{exact:true});
        await error.waitFor({ state: 'attached' });
        await page.locator('details').filter({ has: error }).locator('summary').click();
        await error.waitFor();
        const last = requests.filter(req => req.method==='POST' && req.path.endsWith('/approve')).at(-1);
        assert.deepEqual(last.body.skus, ['FIX-021'], 'Approve must use only the current page selection');
        assert.equal(await page.locator('main input[type="checkbox"]').first().isChecked(), true, 'Failed approval must retain selection');
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, `${locale}/${viewport} ${path} overflows`);
      await page.screenshot({ path: resolve(out, `${locale}-${viewport}-${path.slice(1)}.png`) });
      checks.push({ locale, viewport, path, pagination: '20 + 3 rows of total 23', selectionScope: path === '/order-periods' ? 'read-only' : 'clears on paging; current-page payload; failed approval preserves selection' });
      console.log(`Checked ${locale}/${viewport} ${path}`);
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(out,'results.json'), JSON.stringify({ checks, errors, apiMode: 'synthetic fixtures', productionRequests: 0 },null,2)+'\n');
  console.log(`PASS: ${checks.length} localized desktop/phone queue workflows`);
} finally { await browser.close(); await new Promise(ok => server.close(ok)); }
