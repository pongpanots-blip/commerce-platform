#!/usr/bin/env node
// Sidebar + shell screenshots of a LOCAL build with FAKE data (before/after the nav redesign).
// Nothing reaches prod: the tutorial fixture aborts every prod host and answers every /api call in-process.
// Usage: node docs/admin-redesign/shots.mjs <before|after> <http://127.0.0.1:port> [roles] [langs]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TUTORIAL = '/workspace/docs/commerce-tutorial';
const require = createRequire(`${TUTORIAL}/package.json`);
const { chromium } = require('playwright');
const { installFixture, labelInPage, TEST_BUILD_LABEL } = await import(`${TUTORIAL}/capture/fixture.mjs`);

const [phase, base, rolesArg = 'admin,merchandising,marketing,cs,sale,sales_manager', langsArg = 'en'] = process.argv.slice(2);
if (!['before', 'after'].includes(phase)) throw new Error('phase: before | after');
const url = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('local builds only');

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const out = join(here, 'screenshots', phase);
mkdirSync(out, { recursive: true });

// The inventory predates #83: give the fake API the sale role's backend access (shop-reports, products, inventory, own win-back).
const inv = JSON.parse(readFileSync(`${TUTORIAL}/inventory.json`, 'utf8'));
for (const r of inv.backendRoutes) {
  if (r.method === 'GET' && /^\/(reports\/(sales|orders|customers|prices)|products|inventory)/.test(r.path) && !r.path.includes('by-rep') && !r.path.includes('parity')) r.roles = [...new Set([...r.roles, 'sale'])];
}
inv.backendRoutes.push({ method: 'GET', path: '/reports/winback/my/opportunities', rx: '^/reports/winback/my/(opportunities|pool)$', roles: ['sale'] });

const fakeToken = (role) => `e30.${Buffer.from(JSON.stringify({ sub: 'fixture', email: `${role}@example.invalid`, role, exp: 4102444800 })).toString('base64url')}.fixture`;

const browser = await chromium.launch({ headless: true });
for (const lang of langsArg.split(',')) for (const role of rolesArg.split(',')) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const state = { role, mode: 'rows' };
  await installFixture(context, inv, state, { srcRoots: [join(repo, 'apps/commerce-admin/src')] });
  // the admin top bar reads /reports/health → { now: { problems } }; the generic fake record has no `now`
  await context.route(/\/api\/reports\/health/, (route) => route.fulfill({ json: { now: { problems: [] }, today: {}, items: [] } }));
  await context.addInitScript(([token, l]) => { sessionStorage.setItem('cp_admin_token', token); localStorage.setItem('cp_ui_locale', l); }, [fakeToken(role), lang]);
  const page = await context.newPage();
  // /login while signed in = where sign-in sends this role (its landing)
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1200);
  const landing = new URL(page.url()).pathname;
  let shown = landing;
  // a landing page body that crashes on the generic fake data blanks the whole app: show the shell on a page that always renders
  if (!(await page.$('aside'))) {
    shown = '/account/password';
    await page.goto(`${base}${shown}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  const label = TEST_BUILD_LABEL[lang] ?? TEST_BUILD_LABEL.en;
  await page.evaluate(labelInPage, label);
  await page.screenshot({ path: join(out, `${role}-${lang}-landing.png`), type: 'png' });
  // the whole sidebar structure: every group opened (Stitch collapsible groups), clipped to the sidebar
  await page.evaluate(() => { for (const b of document.querySelectorAll('aside nav button[aria-expanded="false"]')) (b).click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { for (const b of document.querySelectorAll('aside nav button[aria-expanded="false"]')) (b).click(); }); // "show more" rows appear after their group opens
  const height = await page.evaluate(() => (document.querySelector('aside > div')?.scrollHeight ?? 900) + 120);
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(height, 900), 7000) });
  await page.waitForTimeout(300);
  await page.evaluate(labelInPage, label);
  await page.screenshot({ path: join(out, `${role}-${lang}-sidebar-all.png`), type: 'png', clip: { x: 0, y: 0, width: 300, height: Math.min(Math.max(height, 900), 7000) } });
  console.log(JSON.stringify({ phase, role, lang, landing, shown }));
  await context.close();
}
await browser.close();
