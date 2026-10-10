#!/usr/bin/env node
// Local intercepted fixtures only. No real MCP calls, credentials or production writes.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.ADMIN_URL ?? 'http://127.0.0.1:4415';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = 'docs/reviews/admin-task-navigation/release-2026-10-09/correction/mcp-browser';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/tmp/chromium' });
const checks = [], errors = [];
const deferred = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
const records = [
  { id: 'saved', at: '2026-10-09T10:00:00Z', tool: 'product_content_save', summary: 'Fixture persisted product copy', entityType: 'product', entityId: 'fixture', adminUrl: '/products/fixture', changes: [{ field: 'name', before: 'Old fixture', after: 'Saved fixture' }], error: null, staffUserId: 'fixture-user', staffEmail: 'fixture@example.invalid', clientName: 'Fixture AI' },
  { id: 'failed', at: '2026-10-09T10:00:01Z', tool: 'marketing_save', summary: 'Fixture rejected marketing edit', entityType: 'marketing', entityId: null, adminUrl: null, changes: [], error: 'Fixture validation rejected', staffUserId: 'fixture-user', staffEmail: 'fixture@example.invalid', clientName: 'Fixture AI' },
];
async function open(role = 'admin', viewport = { width: 1280, height: 900 }, options = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const claims = Buffer.from(JSON.stringify({ sub: 'fixture-user', email: 'fixture@example.invalid', role, exp: 4102444800 })).toString('base64url');
  await context.addInitScript(({ claims }) => { sessionStorage.setItem('cp_admin_token', `e30.${claims}.fixture`); localStorage.setItem('cp_ui_locale', 'th'); }, { claims });
  const state = { changes: records, reads: 0, writes: [], ...options };
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/api/, '');
    if (request.method() !== 'GET') { state.writes.push(path); return route.fulfill({ status: 500, json: { message: 'Fixture prohibits writes' } }); }
    const answer = json => route.fulfill({ status: 200, json });
    if (path === '/admin/auth/me') return answer({ userId: 'fixture-user', email: 'fixture@example.invalid', role, mustChangePassword: false });
    if (path === '/reports/health') return answer({ now: { problems: [] } });
    if (path === '/admin/stats') return answer({ webhooksFailed: 0 });
    if (path === '/mcp-connections') return answer({ enabled: true, mcpUrl: 'https://fixture.example.invalid/mcp', role, connections: [] });
    if (path === '/mcp-connections/activity') return answer([]);
    if (path === '/mcp-connections/changes') {
      assert.equal(new URL(request.url()).searchParams.get('limit'), '100'); state.reads++;
      if (state.gate) await state.gate.promise;
      if (state.fail) { state.fail = false; return route.fulfill({ status: 503, json: { message: 'Fixture audit unavailable' } }); }
      return answer(state.changes);
    }
    return answer([]);
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/ai/connectors');
  const panel = page.locator('main section').filter({ has: page.getByText('AI สร้าง / แก้ไขอะไรไปบ้าง', { exact: true }) });
  await panel.waitFor(); return { context, page, panel, state };
}
try {
  {
    const gate = deferred(), { context, page, panel, state } = await open('admin', undefined, { gate });
    await panel.locator('[aria-busy=true]').waitFor();
    assert.equal(await panel.getByText('สำเร็จ', { exact: true }).count(), 0);
    gate.release(); state.gate = null;
    await panel.getByText('Fixture persisted product copy', { exact: true }).waitFor();
    assert.equal(await panel.getByText('สำเร็จ', { exact: true }).count(), 1);
    assert.equal(await panel.getByText('ไม่สำเร็จ', { exact: true }).count(), 1);
    assert.equal(await panel.locator('thead tr tr').count(), 0);
    assert.equal(await panel.getByRole('link').getAttribute('href'), '/products/fixture');
    await page.getByRole('button', { name: 'รีเฟรช', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('main [aria-busy=true]'));
    assert(state.reads >= 2); assert.deepEqual(state.writes, []);
    await panel.screenshot({ path: output + '/authoritative-change-results.png' });
    checks.push('Preserved AI change log uses actual success/failure records, blocks premature success while loading, and refreshes limit100 endpoint without writes');
    await context.close();
  }
  {
    const { context, panel, state } = await open('admin', undefined, { fail: true });
    await panel.getByRole('alert').waitFor();
    assert.equal(await panel.getByText('AI ยังไม่ได้สร้างหรือแก้ไขอะไร', { exact: true }).count(), 0);
    assert.equal(await panel.getByText('สำเร็จ', { exact: true }).count(), 0);
    await panel.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
    await panel.getByText('Fixture persisted product copy', { exact: true }).waitFor();
    assert.equal(state.reads, 2); assert.deepEqual(state.writes, []);
    checks.push('Audit read failure shows retry without false empty/success state and recovers from the next authoritative read');
    await context.close();
  }
  {
    const { context, panel, state } = await open('admin', undefined, { changes: [] });
    await panel.getByText('AI ยังไม่ได้สร้างหรือแก้ไขอะไร', { exact: true }).waitFor();
    assert.equal(await panel.getByText('สำเร็จ', { exact: true }).count(), 0); assert.deepEqual(state.writes, []);
    checks.push('Authoritative empty audit contains no completion badges'); await context.close();
  }
  {
    const { context, page, panel, state } = await open('marketing', { width: 320, height: 740 });
    await panel.getByText('Fixture persisted product copy', { exact: true }).waitFor();
    await page.getByText('AI ที่เชื่อมต่อกับบัญชีของคุณ', { exact: true }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(state.writes, []);
    await page.screenshot({ path: output + '/own-account-phone.png', fullPage: true });
    checks.push('Own-account scope and preserved audit remain usable on320px phone without writes'); await context.close();
  }
  assert.deepEqual(errors, []); console.log(`PASS: ${checks.length} MCP preservation scenarios; local fixtures only`);
} finally {
  writeFileSync(output + '/results.json', JSON.stringify({ checks, errors, productionRequests: 0 }, null, 2)); await browser.close();
}
