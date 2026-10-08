#!/usr/bin/env node
// Read-only coverage of every inventoried route in both languages on an isolated stack.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:4403';
const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:4404';
const API = process.env.COMMERCE_TEST_API ?? 'http://localhost:3100/api';
for (const url of [ADMIN, PORTAL, API]) assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const credentials = JSON.parse(readFileSync('scripts/.mock-credentials', 'utf8'));
const inventory = JSON.parse(readFileSync('docs/design/stitch/full-ui-bilingual/inventory.json', 'utf8'));
const requestedPaths = process.env.UI_AUDIT_PATHS?.split(',');
if (requestedPaths) {
  assert.ok(requestedPaths.every(path => inventory.routes.some(route => route.path === path)), 'Every requested path must be inventoried');
  inventory.routes = inventory.routes.filter(route => ['/login', '/register'].includes(route.path) || requestedPaths.includes(route.path));
}
const locales = process.env.UI_AUDIT_LOCALES?.split(',') ?? ['th', 'en'];
assert.ok(locales.length > 0 && locales.every(locale => ['th', 'en'].includes(locale)) && new Set(locales).size === locales.length);
const resultName = requestedPaths ? 'focused-results' : locales.length === 2 ? 'results' : `${locales[0]}-results`;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const visits = [], errors = [], unavailable = new Set(), blockedMutations = new Set(), copy = new Map();
const pages = { admin: await browser.newPage({ viewport: { width: 1440, height: 1000 } }), portal: await browser.newPage({ viewport: { width: 1440, height: 1000 } }) };
function observe(app, page) {
  page.on('pageerror', error => errors.push({ app, path: new URL(page.url()).pathname, message: error.message }));
  page.on('response', response => { if (response.status() >= 500) unavailable.add(`${response.status()} ${new URL(response.url()).pathname}`); });
  // Dismiss confirms so a route audit cannot execute a mutation through navigation guards.
  page.on('dialog', dialog => dialog.dismiss());
}
for (const [app, page] of Object.entries(pages)) observe(app, page);
async function restrictMutations(page) {
  await page.route(`${API}/**`, route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
    blockedMutations.add(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  });
}
async function freshPage(app, page) {
  const storage = await page.evaluate(() => ({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
  await page.close();
  const next = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  observe(app, next);
  await next.addInitScript(storage => {
    if (window.top !== window) return;
    for (const [key, value] of Object.entries(storage.local)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    for (const [key, value] of Object.entries(storage.session)) if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value);
  }, storage);
  await restrictMutations(next);
  return next;
}
const language = (page, locale) => page.getByRole('combobox', { name: /^(ภาษา|Language)$/ }).first().selectOption(locale);
async function capture(page, app, path, locale, authPage = false) {
  assert.equal(await page.locator('html').getAttribute('lang'), locale);
  const root = authPage ? page.locator('body') : page.locator('main');
  await root.waitFor();
  await page.waitForTimeout(350);
  let text = await root.innerText();
  if (/^(?:Loading|กำลังโหลด)(?:\.{3}|…)?\s*$/.test(text.trim())) {
    await page.waitForFunction(() => !/^(?:Loading|กำลังโหลด)(?:\.{3}|…)?\s*$/.test(document.querySelector('main')?.textContent?.trim() ?? ''), null, { timeout: 8000 }).catch(() => {});
    text = await root.innerText();
  }
  assert.ok(text.trim().length > 0, `${app} ${path}: visible content`);
  assert.ok(!/^(?:Loading|กำลังโหลด)(?:\.{3}|…)?\s*$/.test(text.trim()), `${app} ${path}: does not remain in a loading state`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${app} ${path}: page fits desktop`);
  const heading = root.locator('h1').first();
  const title = await heading.count() ? await heading.textContent() : null;
  visits.push({ app, path, locale, title, contentVisible: true });
  if (locale === 'en') {
    // Report Thai text for review; records, preview content and server messages may
    // legitimately be Thai, so this is not a blanket assertion against record data.
    const remaining = await root.evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), texts = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const owner = node.parentElement, value = node.textContent?.replace(/\s+/g, ' ').trim();
        if (!owner || !value || !/[\u0E01-\u0E2E\u0E30-\u0E3A\u0E40-\u0E4E]/.test(value) || owner.closest('pre,code,input,textarea,option,script,style,[contenteditable],iframe')) continue;
        if (owner.closest('details:not([open])') && !owner.closest('summary')) continue;
        if (!owner.getClientRects().length || getComputedStyle(owner).visibility === 'hidden') continue;
        texts.push(value);
      }
      return [...new Set(texts)];
    });
    for (const text of remaining) { const item = copy.get(text) ?? { text, routes: [] }; item.routes.push(`${app}:${path}`); copy.set(text, item); }
  }
  if (visits.length % 50 === 0) console.log(`Checked ${visits.length} route/language visits`);
}
async function auth(app) {
  const page = pages[app], base = app === 'admin' ? ADMIN : PORTAL;
  if (app === 'portal') {
    await page.goto(`${base}/register`);
    for (const locale of ['th', 'en']) { await language(page, locale); await capture(page, app, '/register', locale, true); }
  }
  await page.goto(app === 'admin' ? base : `${base}/login`);
  for (const locale of ['th', 'en']) { await language(page, locale); await capture(page, app, '/login', locale, true); }
  const account = app === 'admin' ? credentials.admin : credentials.partner;
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('main').waitFor();
}
try {
  await auth('admin'); await auth('portal');
  await restrictMutations(pages.admin); await restrictMutations(pages.portal);
  const token = await pages.admin.evaluate(() => sessionStorage.getItem('cp_admin_token'));
  const seededIds = {};
  for (const resource of ['products', 'customers', 'orders']) {
    const response = await pages.admin.request.get(`${API}/${resource}?page=1&pageSize=1`, { headers: { Authorization: `Bearer ${token}` } });
    assert.ok(response.ok(), `Read local ${resource} fixtures`);
    const body = await response.json(); const items = body.items ?? body.data?.items ?? body.data ?? body;
    assert.ok(Array.isArray(items) && items[0]?.id, `Seeded ${resource} are required`); seededIds[resource] = items[0].id;
  }
  for (const app of ['admin', 'portal']) {
    let page = pages[app]; const base = app === 'admin' ? ADMIN : PORTAL;
    let batch = 0;
    for (const locale of locales) {
      await language(page, locale);
      for (const route of inventory.routes.filter(route => route.app === app && !['/login', '/register'].includes(route.path))) {
        // Real local IDs cover native details. Josh details use a valid UUID but
        // their live upstream remains unconfigured and is reported separately.
        const id = /^\/products\//.test(route.path) ? seededIds.products : /^\/customers\//.test(route.path) ? seededIds.customers : seededIds.orders;
        const path = route.path.replace(/:\w+/g, id);
        // Bound renderer memory while deliberately testing full document navigation.
        if (batch >= 35) { page = await freshPage(app, page); pages[app] = page; batch = 0; }
        await page.goto(base + path, { waitUntil: 'domcontentloaded' });
        await capture(page, app, route.path, locale);
        batch++;
      }
    }
  }
  assert.deepEqual(errors, [], 'Every route renders without JavaScript failures');
  const authenticationRoutes = inventory.routes.filter(route => ['/login', '/register'].includes(route.path)).length;
  assert.equal(visits.length, (inventory.routes.length - authenticationRoutes) * locales.length + authenticationRoutes * 2, 'Visit every inventoried route in each requested language, with authentication checked in both');
  mkdirSync('.e2e-out/full-ui', { recursive: true });
  writeFileSync(`.e2e-out/full-ui/${resultName}.json`, JSON.stringify({ visits, locales, unavailableEndpoints: [...unavailable], blockedMutationRequests: [...blockedMutations], thaiTextReview: [...copy.values()], liveJoshValidated: false }, null, 2));
  console.log(`PASS: ${visits.length} route/language visits; ${inventory.routes.length} routes in ${locales.join(', ')}. Live Josh workflows remain unverified.`);
} catch (error) {
  mkdirSync('.e2e-out/full-ui', { recursive: true });
  writeFileSync('.e2e-out/full-ui/failure.json', JSON.stringify({ completedVisits: visits, errors, message: error.message }, null, 2));
  throw error;
} finally { await browser.close(); }
