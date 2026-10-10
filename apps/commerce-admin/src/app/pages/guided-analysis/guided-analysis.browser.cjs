/* Root runs this serially after the final admin build. No screenshots, database or external requests. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const repo = process.env.GUIDED_ANALYSIS_BROWSER_REPO || process.cwd(), output = process.env.GUIDED_ANALYSIS_BROWSER_OUTPUT;
if (!output || !output.startsWith('/workspace/')) throw Error('Set GUIDED_ANALYSIS_BROWSER_OUTPUT to the owned workspace evidence JSON path.');
const requireRepo = require('node:module').createRequire(repo + '/package.json');
requireRepo('ts-node').register({ transpileOnly: true, project: repo + '/apps/commerce-platform/tsconfig.app.json', compilerOptions: { module: 'CommonJS', moduleResolution: 'Node', target: 'ES2021', experimentalDecorators: true, emitDecoratorMetadata: true } });
requireRepo('reflect-metadata');
const { chromium } = requireRepo('playwright');
const { GuidedAnalysisService } = require(repo + '/apps/commerce-platform/src/modules/integration/guided-analysis/guided-analysis.service.ts');
const { GuidedAnalysisController } = require(repo + '/apps/commerce-platform/src/modules/integration/guided-analysis/guided-analysis.controller.ts');
const controller = new GuidedAnalysisController(new GuidedAnalysisService()), root = repo + '/dist/apps/commerce-admin', home = '/analysis/customer-behavior';
const checks = [], requests = [], unexpected = [], external = [], errors = []; let browser, server, delay = 0, failRead = false, mismatch = false;
const template = home + '/templates/repeat_buyers_inactive?minimumOrders=3&purchaseWindowDays=90&inactiveDays=14';
async function main() {
  assert(fs.existsSync(root + '/index.html'), 'Build commerce-admin before this harness.');
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://fixture'), send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' }); res.end(JSON.stringify(value)); };
    if (!u.pathname.startsWith('/api/')) {
      let file; try { file = path.resolve(root, '.' + decodeURIComponent(u.pathname)); } catch { res.writeHead(400); return res.end(); }
      if (!file.startsWith(root + '/') || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = root + '/index.html';
      res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream'); return res.end(fs.readFileSync(file));
    }
    try {
      const claims = JSON.parse(Buffer.from((req.headers.authorization || '').split('.')[1] || '', 'base64url').toString()), actor = claims.sub, role = claims.role;
      requests.push({ method: req.method, path: u.pathname, search: u.search, actor, role });
      if (!actor) return send({ message: 'Synthetic identity required' }, 401);
      if (req.method === 'GET' && u.pathname === '/api/admin/auth/me') return send({ userId: actor, role, email: 'guided-fixture@example.invalid', mustChangePassword: false });
      if (req.method === 'GET' && u.pathname === '/api/admin/stats') return send({ webhooksFailed: 0 });
      if (req.method === 'GET' && u.pathname === '/api/reports/health') return send({ now: { problems: [] } });
      if (u.pathname.startsWith('/api/reports/guided-analysis/')) {
        if (!['admin', 'business_analyst'].includes(role)) return send({ message: 'Guided scope denied' }, 403);
        if (req.method !== 'GET') return send({ message: 'Read-only handler' }, 405);
        if (delay) await new Promise(ok => setTimeout(ok, delay));
        if (failRead) { failRead = false; return send({ message: 'Synthetic read outage' }, 503); }
        if (u.pathname.endsWith('/templates')) return send(controller.templates());
        if (u.pathname.endsWith('/preview')) {
          const query = Object.fromEntries(u.searchParams), value = await controller.preview(query, { staff: { userId: actor, role, email: 'guided-fixture@example.invalid' } });
          if (mismatch) { mismatch = false; value.counts.matched = 0; }
          return send(value);
        }
      }
      unexpected.push(req.method + ' ' + u.pathname); return send({ message: 'Unexpected fixture request' }, 503);
    } catch (e) { return send({ message: e.getStatus?.() ? e.message : 'Synthetic read unavailable' }, e.getStatus?.() || 500); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok)); const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: process.env.GUIDED_ANALYSIS_CHROMIUM || '/tmp/chromium', args: ['--disable-dev-shm-usage'] });
  async function context(role = 'business_analyst', width = 1920, locale = 'en') {
    const actor = crypto.randomUUID(), c = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1080 }, reducedMotion: 'reduce' });
    const claims = Buffer.from(JSON.stringify({ sub: actor, role, exp: 4102444800 })).toString('base64url');
    await c.addInitScript(({ claims, locale, origin }) => { if (window !== window.top || location.origin !== origin) return; sessionStorage.setItem('cp_admin_token', 'e30.' + claims + '.fixture'); localStorage.setItem('cp_ui_locale', locale); }, { claims, locale, origin: base });
    await c.route('**/*', route => { const u = new URL(route.request().url()); if (['about:', 'data:'].includes(u.protocol) || u.origin === base) return route.continue(); external.push(u.origin + u.pathname); return route.abort(); });
    c.on('page', page => { page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message)); }); return { c, actor };
  }
  async function check(name, run) { await run(); checks.push({ name, passed: true }); console.log('PASS ' + name); }
  async function overflow(page) { await page.evaluate(() => document.fonts.ready); await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1); }
  const { c } = await context(), p = await c.newPage();
  await check('loading, canonical template selection, server validation and distinct preview/evidence URLs', async () => {
    delay = 350; await p.goto(base + home, { waitUntil: 'domcontentloaded' }); await p.locator('main [aria-busy="true"]').first().waitFor();
    await p.getByText('Live source unavailable', { exact: true }).waitFor(); delay = 0;
    await p.locator('main a[href*="/templates/repeat_buyers_inactive"]').click(); await p.locator('input[name="minimumOrders"]').fill('4'); await p.locator('form button[type="submit"]').click();
    await p.getByText('Criteria checked; live source unavailable', { exact: true }).waitFor(); assert(new URL(p.url()).pathname.endsWith('/preview'));
    assert.equal(new URL(p.url()).searchParams.get('minimumOrders'), '4');
    await p.locator('main a[href*="/evidence"]').click(); await p.getByText('Response time does not establish source freshness or completeness.', { exact: true }).waitFor();
    assert.match(await p.locator('main').innerText(), /No member list or zero count can be established/); await p.goBack(); await p.getByText('Journey steps for review', { exact: true }).waitFor(); await p.goForward(); await p.getByText('Branch evidence', { exact: true }).waitFor(); await p.reload(); await p.getByText('Branch evidence', { exact: true }).waitFor();
  });
  await check('failure/retry and malformed zero cannot establish success', async () => {
    failRead = true; await p.goto(base + template.replace('?', '/preview?')); await p.getByText('Analysis could not be read. Retry the same criteria.', { exact: true }).waitFor();
    mismatch = true; await p.getByRole('button', { name: 'Try again', exact: true }).click(); await p.waitForLoadState('networkidle'); assert.equal(await p.getByText('Criteria checked; live source unavailable', { exact: true }).count(), 0);
    await p.getByRole('button', { name: 'Try again', exact: true }).click(); await p.getByText('Criteria checked; live source unavailable', { exact: true }).waitFor();
  });
  await c.close();
  for (const role of ['admin', 'business_analyst', 'marketing', 'merchandising', 'cs', 'sale', 'sales_manager', 'graphic']) {
    const { c, actor } = await context(role, 390), p = await c.newPage();
    await check(role + ' direct read authority', async () => { await p.goto(base + template.replace('?', '/evidence?')); await p.waitForLoadState('networkidle'); if (['admin', 'business_analyst'].includes(role)) await p.getByText('Branch evidence', { exact: true }).waitFor(); else assert.equal(requests.filter(r => r.actor === actor && r.path.includes('/guided-analysis/')).length, 0); await overflow(p); }); await c.close();
  }
  for (const locale of ['en', 'th']) for (const width of [390, 1920, 2560]) {
    const { c } = await context('business_analyst', width, locale), p = await c.newPage();
    await check('fluid labeled keyboard controls ' + locale + ' ' + width, async () => { await p.goto(base + template); await p.locator('input[name="minimumOrders"]').waitFor(); const input = p.locator('input[name="minimumOrders"]'); const id = await input.getAttribute('id'); assert.equal(await p.locator('label[for="' + id + '"]').count(), 1); await input.focus(); await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.type('5'); await p.keyboard.press('Enter'); await p.waitForURL(url => url.pathname.endsWith('/preview')); await p.waitForLoadState('networkidle'); assert.equal(new URL(p.url()).searchParams.get('minimumOrders'), '5'); await overflow(p); }); await c.close();
  }
  assert.deepEqual(unexpected, []); assert.deepEqual(external, []); assert.deepEqual(errors, []); assert(requests.every(r => r.method === 'GET'));
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), passed: checks.length, checks, requests, unexpected, external, pageErrors: errors, screenshotsCaptured: 0, productionAccess: false, databaseAccess: false, actualSourceMode: 'Default unavailable GuidedAnalysisController/Service; no registered source adapter', authMode: 'Synthetic browser identity transport; original StaffAuthGuard tested separately', buildDirectory: root, readOnly: true }, null, 2) + '\n');
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) await new Promise(ok => server.close(ok)); });
