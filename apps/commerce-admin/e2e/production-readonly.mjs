// Production QA using an existing staff credential supplied by CI. Never stores credentials or business records.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = 'https://commerce.joshapp.io';
const output = '.e2e-out/production-readonly';
mkdirSync(output, { recursive: true });
const inventory = JSON.parse(readFileSync('docs/reviews/e2e-ux-20261013/every-page-inventory.json', 'utf8'));
const routes = new Set(inventory.routes.filter(r => r.app === 'admin' && !r.path.includes(':')).map(r => r.path));
for (const name of ['catalog', 'orders', 'customers', 'marketing', 'reports', 'settings', 'advanced']) routes.add(`/tasks/${name}`);
for (const r of inventory.records) if (r.app === 'admin' && r.boundary && !r.path.includes(':') && r.path !== '/j/*') routes.add(r.path.replace(/\/\*$/, ''));
const result = { startedAt: new Date().toISOString(), base, sourceCommit: process.env.GITHUB_SHA, mode: 'Authenticated production, read-only', visits: [], errors: [], blockedWrites: [], notificationContract: null, unvisited: [] };
const browser = await chromium.launch({ headless: true });
try {
  assert.ok(process.env.PROD_E2E_EMAIL && process.env.PROD_E2E_PASSWORD, 'Production E2E staff secret is not configured');
  for (const locale of ['th', 'en']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(({ locale }) => {
      if (window !== window.top) return;
      localStorage.setItem('cp_ui_locale', locale);
    }, { locale });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const loginPage = await page.goto(base + '/login', { waitUntil: 'domcontentloaded' });
    result.loginPage = { status: loginPage?.status(), title: await page.title() };
    await page.locator('input[type="email"]').fill(process.env.PROD_E2E_EMAIL);
    await page.locator('input[type="password"]').fill(process.env.PROD_E2E_PASSWORD);
    await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/, exact: true }).click();
    await page.locator('main').waitFor({ timeout: 30000 });
    const accessToken = await page.evaluate(() => sessionStorage.getItem('cp_admin_token'));
    assert.ok(accessToken, 'No authenticated staff session after browser sign-in');
    page.on('pageerror', error => result.errors.push({ locale, width, route: new URL(page.url()).pathname, message: error.message.slice(0, 250) }));
    // A relay POST carrying GET is a read. Every business write is stopped before reaching the server.
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || ['/api/admin/auth/refresh', '/api/admin/auth/logout'].includes(path)) return route.continue();
      let body; try { body = request.postDataJSON(); } catch {}
      if (path === '/api/josh/admin-call' && body?.method === 'GET') return route.continue();
      result.blockedWrites.push({ locale, width, method: request.method(), path });
      return route.abort('blockedbyclient');
    });
    if (!result.notificationContract) {
      const response = await context.request.post(`${base}/api/josh/admin-call`, { headers: { authorization: `Bearer ${accessToken}` }, data: { method: 'GET', path: '/admin/notifications', query: { limit: '20' } } });
      const body = await response.json().catch(() => ({ message: `Non-JSON notification response: HTTP ${response.status()}` }));
      result.notificationContract = { status: response.status(), keys: Object.keys(body ?? {}), itemCount: Array.isArray(body?.data?.items) ? body.data.items.length : null, hasNextCursor: !!body?.data?.nextCursor, error: response.ok() ? null : String(body?.error?.message ?? body?.message ?? 'Read failed').slice(0, 300) };
    }
    const discoveries = new Set();
    // Every fixed page, followed by real record links discovered on those pages; no fabricated record IDs.
    const queue = [...routes];
    for (let index = 0; index < queue.length; index++) {
      const path = queue[index];
      try {
        await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.locator('main').waitFor({ timeout: 20000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        if (new URL(page.url()).pathname === '/login') throw new Error('Session expired');
        const metrics = await page.locator('main').evaluate(main => {
          const visible = node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const controls = [...main.querySelectorAll('button,a,input,select,textarea')].filter(visible);
          return { title: main.querySelector('h1')?.textContent?.slice(0, 150), overflow: document.documentElement.scrollWidth > innerWidth + 1, tables: main.querySelectorAll('table').length, alerts: [...main.querySelectorAll('[role="alert"]')].filter(visible).length, smallTargets: controls.filter(n => n.matches('button,input,select') && n.getBoundingClientRect().height < 44).length, unlabelledInputs: controls.filter(n => n.matches('input:not([type="hidden"]),select,textarea') && !n.labels?.length && !n.getAttribute('aria-label') && !n.getAttribute('aria-labelledby')).length, hrefs: [...main.querySelectorAll('a[href]')].map(n => n.getAttribute('href')) };
        });
        const hrefs = metrics.hrefs; delete metrics.hrefs;
        result.visits.push({ locale, width, path, actualPath: new URL(page.url()).pathname, ...metrics });
        for (const href of hrefs) {
          if (!href?.startsWith('/') || href.startsWith('//') || href.includes('?') || routes.has(href) || discoveries.has(href)) continue;
          // Only actual links matching an inventoried record route; limit to one real record per route family.
          const family = inventory.routes.find(r => r.app === 'admin' && r.path.includes(':') && new RegExp('^' + r.path.replace(/:[\w]+/g, '[^/]+') + '$').test(href));
          if (!family || discoveries.has(family.path)) continue;
          discoveries.add(family.path); discoveries.add(href); queue.push(href);
        }
      } catch (error) {
        result.visits.push({ locale, width, path, outcome: 'blocked', reason: error.message.split('\n')[0].slice(0, 200) });
        if (/Session expired/.test(error.message)) break;
      }
    }
    for (const r of inventory.routes.filter(r => r.app === 'admin' && r.path.includes(':'))) if (!discoveries.has(r.path)) result.unvisited.push({ locale, width, routeFamily: r.path, reason: 'No real record link available in visited pages' });
    await context.close();
  }
} catch (error) {
  result.failure = error.message.split('\n')[0]; process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  writeFileSync(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ visits: result.visits.length, browserErrors: result.errors.length, blockedWrites: result.blockedWrites.length, loginPage: result.loginPage, notificationContract: result.notificationContract, failure: result.failure }));
  await browser.close();
}
