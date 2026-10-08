#!/usr/bin/env node
// UI e2e for the redesigned admin console + developer portal: signs in, opens every page, and fails on
// console errors, 5xx responses, horizontal page overflow, a missing <h1>, or leftover legacy CSS classes.
// Writes a full-page screenshot per page to .e2e-out/screens/ for visual review.
//
// Prereqs: `make dev` (API :3100, admin :4403, portal :4404) and `npm run seed:mock` (creates the
// logins in scripts/.mock-credentials). Run from the repo root:
//   node apps/commerce-admin/e2e/pages.mjs            # all pages
//   node apps/commerce-admin/e2e/pages.mjs /orders    # only routes containing "/orders"
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:4403';
const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:4404';
const OUT = '.e2e-out/screens';
const creds = JSON.parse(readFileSync('scripts/.mock-credentials', 'utf8'));
const only = process.argv[2];

// Known, accepted failures (not UI bugs). Keep this list short and explained.
const ALLOWED_5XX = [];

const ADMIN_ROUTES = [
  '/', '/settings/staff', '/account/password', '/reports/sales', '/reports/products', '/reports/orders', '/reports/customers', '/reports/prices',
  '/reports/price-shadow', '/prices/staff', '/reports/traffic', '/reports/health', '/reports/order-targetgroup',
  '/reports/winback', '/josh/kyc', '/josh/credit_terms', '/josh/admin_access', '/josh/shipments', '/josh/payments',
  '/josh/credit_notes', '/josh/credit_backs', '/josh/invoices', '/josh/coupons', '/josh/campaigns', '/josh/segments',
  '/josh/suppliers', '/josh/internal_docs', '/josh-api-logs', '/marketing/research', '/marketing/restaurants',
  '/marketing/workflows', '/cs', '/livechat', '/ai/connectors', '/erp/inbound-log', '/erp/josh-logs',
  '/erp/webhook-dead-letter', '/erp/webhook-platforms', '/erp/inventory-warehouse', '/erp/simulator',
  '/erp/jagota-shadow', '/integrations', '/webhooks', '/subscriptions', '/sync-jobs', '/erp-stock', '/erp-ingest',
  '/customers', '/products', '/inventory', '/orders', '/reservations',
];
const PORTAL_ROUTES = ['/', '/keys', '/webhooks', '/docs'];
// josh web-admin pages copied as-is (josh's own look, josh API via admin-call): only "renders without a JS error".
const JOSH_ROUTES = ['/marketing/workflows/new', '/j/allproducts', '/j/order', '/j/coupons', '/j/segments', '/j/marketing/push-campaigns', '/j/cs/delivery-schedule', '/j/cs/cart-move-categories', '/j/promotions-mechanic',
  // josh's competitor / scraping pages on commerce's own API (commerce-client), not admin-call.
  '/j/marketing/competitor-prices', '/j/marketing/scraping-sources', '/j/marketing/scraped-catalog'];
// Detail pages: open the list, follow the first row's link, check the page it lands on.
const DETAILS = [
  ['/reports/orders', '/reports/orders/'],
  ['/reports/customers', '/reports/customers/'],
  ['/reports/products', '/reports/products/'],
  ['/orders', '/orders/'],
  ['/customers', '/customers/'],
  ['/products', '/products/'],
];
const LEGACY = '.panel, .btn, .badge, .page-head, .stat, .hint, .err, .empty, .stat-grid, pre.payload';

const failures = [];

/** Text that sits flush against its panel's left/top border (a <Panel> with content but no padding). */
const crampedPanels = (page) => page.evaluate(() => {
  const MIN = 8;
  const out = [];
  for (const panel of document.querySelectorAll('main [data-panel]')) {
    const box = panel.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? 1 : 2) });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left - box.left < MIN || r.top - box.top < MIN) {
        out.push(`"${n.textContent.trim().slice(0, 30)}" ${Math.round(r.left - box.left)}px/${Math.round(r.top - box.top)}px from the panel edge`);
        break;
      }
    }
  }
  return out;
});
const fail = (where, what) => failures.push(`${where}: ${what}`);

async function check(page, app, route, label) {
  const name = label ?? `${app}${route === '/' ? '-home' : route.replace(/[/:]/g, '-')}`;
  const consoleErrors = [];
  const serverErrors = [];
  const onConsole = (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); };
  const onResponse = (r) => { if (r.status() >= 500 && !ALLOWED_5XX.some((re) => re.test(r.url()))) serverErrors.push(`${r.status()} ${r.url()}`); };
  page.on('console', onConsole);
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('response', onResponse);
  if (route) await page.goto((app === 'admin' ? ADMIN : PORTAL) + route, { waitUntil: 'networkidle' }).catch((e) => fail(name, `navigation: ${e.message}`));
  else await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  const h1 = await page.locator('main h1').first().textContent({ timeout: 4000 }).catch(() => null);
  if (!h1) fail(name, 'no <h1> in main');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) fail(name, `page scrolls horizontally by ${overflow}px`);
  const legacy = await page.locator(`main :is(${LEGACY})`).count();
  if (legacy) fail(name, `${legacy} element(s) with legacy CSS classes`);
  for (const e of consoleErrors) fail(name, `console: ${e.slice(0, 160)}`);
  for (const e of serverErrors) fail(name, `server: ${e}`);
  for (const e of await crampedPanels(page)) fail(name, `no padding: ${e}`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  page.off('console', onConsole);
  page.off('response', onResponse);
  console.log(`${failures.some((f) => f.startsWith(name + ':')) ? 'FAIL' : 'PASS'}  ${name}  ${h1 ? `"${h1.trim()}"` : ''}`);
}

mkdirSync(OUT, { recursive: true });
// Uses the installed Chrome (no browser download); set PW_CHANNEL=chromium after `npx playwright install` to use Playwright's own.
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(ADMIN + '/');
  await page.getByRole('combobox', { name: /^(ภาษา|Language)$/ }).selectOption('en');
  await page.getByLabel(/email/i).fill(creds.admin.email);
  await page.getByLabel(/password/i).fill(creds.admin.password);
  await page.getByRole('button', { name: /sign in|เข้าสู่ระบบ/i }).click();
  await page.locator('aside').waitFor({ timeout: 10_000 });
  for (const r of ADMIN_ROUTES) if (!only || r.includes(only)) await check(page, 'admin', r);
  for (const r of JOSH_ROUTES) {
    if (only && !r.includes(only)) continue;
    const name = `josh${r.replace(/[/:]/g, '-')}`;
    const errors = [];
    const onErr = (e) => errors.push(String(e));
    // Any API error fails: 503 = commerce cannot reach josh (JOSH_API_URL / JOSH_EVENTS_SECRET), 403/404 = josh
    // refused the relayed call (staff email not a josh staff user, or josh lacks the endpoint) — the page would show no data.
    const onRes = (r) => { if (r.status() >= 400 && r.url().includes('/api/')) errors.push(`api ${r.status()} ${r.url()}`); };
    page.on('pageerror', onErr);
    page.on('response', onRes);
    await page.goto(ADMIN + r, { waitUntil: 'networkidle' }).catch((e) => errors.push(e.message));
    await page.waitForTimeout(500);
    const text = (await page.locator('main').innerText().catch(() => '')).trim();
    if (!text) fail(name, 'renders nothing');
    for (const e of errors) fail(name, `page error: ${e.slice(0, 160)}`);
    for (const e of await crampedPanels(page)) fail(name, `no padding: ${e}`);
    page.off('pageerror', onErr);
    page.off('response', onRes);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    console.log(`${failures.some((f) => f.startsWith(name + ':')) ? 'FAIL' : 'PASS'}  ${name}`);
  }
  for (const [list, prefix] of DETAILS) {
    if (only && !list.includes(only)) continue;
    const name = `admin-detail${list.replace(/\//g, '-')}`;
    await page.goto(ADMIN + list, { waitUntil: 'networkidle' });
    const link = page.locator(`main a[href^="${prefix}"]`).first();
    if (!(await link.count())) { fail(name, `no row link to ${prefix}… on ${list}`); console.log(`FAIL  ${name}`); continue; }
    await link.click();
    await page.waitForURL((u) => u.pathname.startsWith(prefix) && u.pathname.length > prefix.length, { timeout: 10_000 }).catch(() => fail(name, 'row link did not open a detail URL'));
    await check(page, 'admin', null, name);
    const back = page.locator(`main a[href="${list}"]`, { hasText: /./ }).first();
    if (!(await back.count())) fail(name, 'no back link to the list');
  }

  await page.goto(PORTAL + '/login');
  await page.getByRole('combobox', { name: /^(ภาษา|Language)$/ }).selectOption('en');
  await page.getByLabel(/email/i).fill(creds.partner.email);
  await page.getByLabel(/password/i).fill(creds.partner.password);
  await page.getByRole('button', { name: /sign in|log in|เข้าสู่ระบบ/i }).click();
  await page.locator('aside').waitFor({ timeout: 10_000 });
  for (const r of PORTAL_ROUTES) if (!only || r.includes(only)) await check(page, 'portal', r);
} finally {
  await browser.close();
}

console.log(`\n${failures.length ? `${failures.length} problem(s):\n  ${failures.join('\n  ')}` : 'all pages OK'}`);
process.exit(failures.length ? 1 : 0);
