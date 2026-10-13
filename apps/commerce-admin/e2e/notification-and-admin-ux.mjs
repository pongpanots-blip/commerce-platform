// Browser regression on the real app with isolated API fixtures; never reaches production.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.ADMIN_URL ?? 'http://127.0.0.1:4403';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = process.env.ADMIN_UX_OUT ?? 'docs/reviews/e2e-ux-20261013/workflows';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const checks = [], errors = [];
const messages = JSON.parse(readFileSync('libs/ui/src/locales/ui-messages.json', 'utf8'));
const notification = (title) => ({ id: 'fixture-notification', user_id: 'fixture-user', type: 'order_update', title, body: 'Synthetic notification', data: {}, dedupe_key: null, read_at: null, created_at: '2026-10-13T08:00:00Z' });
try {
  for (const locale of ['th', 'en']) for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const claims = Buffer.from(JSON.stringify({ sub: 'ux-fixture', email: 'ux@example.invalid', role: 'admin', exp: 4102444800 })).toString('base64url');
    await context.addInitScript(({ locale, claims }) => { sessionStorage.setItem('cp_admin_token', `e30.${claims}.fixture`); localStorage.setItem('cp_ui_locale', locale); }, { locale, claims });
    const requests = [], flowWrites = []; let notificationFail = false, jobsFail = false, replayFail = false;
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/api/, '');
      const body = request.postDataJSON();
      const answer = (json, status = 200) => route.fulfill({ status, json });
      if (path === '/admin/auth/me') return answer({ userId: 'ux-fixture', role: 'admin', mustChangePassword: false });
      if (path === '/admin/stats') return answer({ webhooksFailed: 0 });
      if (path === '/marketing/flows' && request.method() === 'POST') { flowWrites.push(body); await new Promise(resolve => setTimeout(resolve, 100)); return answer({ id: '00000000-0000-4000-8000-000000000099', ...body }); }
      if (path === '/reports/health') return answer({ now: { problems: [] } });
      if (path === '/josh/admin-call' && body.method === 'GET' && body.path === '/admin/notifications') {
        requests.push(body.query);
        if (notificationFail) return answer({ message: 'Fixture notification source unavailable' }, 500);
        return answer({ data: { items: [notification(body.query.cursor ? 'Fixture page two' : body.query.userId ? 'Fixture filtered notification' : 'Fixture latest notification')], nextCursor: body.query.cursor ? null : 'fixture-cursor-two' } });
      }
      if (path === '/integrations') return answer([{ id: 'fixture-integration', name: 'Fixture ERP', type: 'erp', status: 'active' }]);
      if (path === '/sync-jobs') {
        if (jobsFail) return answer({ message: 'Fixture jobs source unavailable' }, 500);
        return answer([{ id: 'fixture-job-1', integrationId: 'fixture-integration', operation: 'customers', status: 'completed', result: { count: 3 }, createdAt: '2026-10-13T08:00:00Z' }, { id: 'fixture-job-2', integrationId: 'fixture-integration', operation: 'prices', status: 'failed', result: null, error: 'Fixture sync error', createdAt: '2026-10-13T07:00:00Z' }]);
      }
      if (path.startsWith('/reports/api-logs/stats')) return answer({ from: '2026-10-12T08:00:00Z', to: '2026-10-13T08:00:00Z', buckets: [], topEndpoints: [] });
      if (path.startsWith('/reports/api-logs')) return answer({ items: [], total: 0, page: 1, limit: 20 });
      if (path === '/webhooks') return answer([{ id: 'fixture-event', integrationId: 'fixture-integration', status: 'failed', signatureValid: true, attempts: 1, payload: { fixture: true }, createdAt: '2026-10-13T08:00:00Z' }]);
      if (path === '/webhooks/replay/fixture-event') { replayFail = true; return answer({ message: 'Fixture replay rejected' }, 409); }
      return answer({ message: 'Unconfigured fixture endpoint' }, 503);
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    const main = page.locator('main');
    const submit = () => main.getByRole('button', { name: locale === 'th' ? 'ค้นหา' : 'Search', exact: true });
    const clear = () => main.getByRole('button', { name: locale === 'th' ? 'ล้างตัวกรอง' : 'Clear filters', exact: true });
    await page.goto(base + '/j/cs/notification-log');
    await main.getByText('Fixture latest notification', { exact: true }).waitFor();
    assert.equal(requests.length, 1, 'One initial read, not duplicate effects');
    assert.equal(requests[0].userId, undefined, 'Default feed omits userId');
    await main.getByRole('button', { name: locale === 'th' ? 'ถัดไป' : 'Next', exact: true }).click();
    await main.getByText('Fixture page two', { exact: true }).waitFor();
    await main.getByRole('button', { name: locale === 'th' ? 'ก่อนหน้า' : 'Previous', exact: true }).click();
    await main.getByText('Fixture latest notification', { exact: true }).waitFor();
    const input = main.getByRole('textbox').first();
    await input.fill(' fixture-user '); await input.press('Enter');
    await main.getByText('Fixture filtered notification', { exact: true }).waitFor();
    assert.equal(requests.at(-1).userId, 'fixture-user');
    const before = requests.length; await submit().click();
    await main.getByText('Fixture filtered notification', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'));
    assert.equal(requests.length, before + 1, 'Same-user search refreshes once');
    await clear().click(); await main.getByText('Fixture latest notification', { exact: true }).waitFor();
    assert.equal(requests.at(-1).userId, undefined);
    await input.fill('   '); await submit().click();
    await main.getByText('Fixture latest notification', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/notifications-${locale}-${width}.png`, fullPage: true });
    notificationFail = true;
    await main.getByRole('button', { name: locale === 'th' ? 'รีเฟรช' : 'Refresh', exact: true }).click();
    await main.getByRole('alert').waitFor();
    assert.equal(await main.getByText(locale === 'th' ? 'ยังไม่มีประวัติการแจ้งเตือน' : 'No notification history yet', { exact: true }).count(), 0);
    checks.push(`${locale}/${width}: default recent feed, cursor next/previous, Enter, trimmed/blank filter, clear, single refresh, distinct error`);

    await page.goto(base + '/sync-jobs');
    await main.getByText('Fixture sync error', { exact: true }).waitFor();
    await main.getByRole('combobox', { name: locale === 'th' ? 'สถานะ' : 'Status', exact: true }).selectOption('failed');
    assert.equal(await main.locator('tbody tr').count(), 1);
    await main.getByRole('searchbox').fill('not-a-job');
    await main.getByText(locale === 'th' ? 'ไม่พบงานที่ตรงกับตัวกรอง ลองล้างตัวกรอง' : 'No jobs match these filters. Try clearing the filters.', { exact: true }).waitFor();
    await clear().click(); assert.equal(await main.locator('tbody tr').count(), 2);
    await page.screenshot({ path: `${output}/sync-jobs-${locale}-${width}.png`, fullPage: true });
    jobsFail = true; await page.reload(); await main.getByRole('alert').waitFor();
    assert.equal(await main.getByText(/No sync jobs yet|ยังไม่มีงานซิงก์/).count(), 0, 'Failed reads are not empty history');
    checks.push(`${locale}/${width}: sync search/status/clear, failure reason, visible load errors`);

    await page.goto(base + '/josh-api-logs');
    await main.getByRole('textbox').fill('fixture'); await submit().click();
    await clear().click(); assert.equal(await main.getByRole('textbox').inputValue(), '');
    checks.push(`${locale}/${width}: API log filters recover using clear`);
    await page.goto(base + '/marketing/flows/new'); await main.locator('form').waitFor();
    assert.equal(flowWrites.length, 0, 'Opening creation page must not create drafts');
    await main.locator('input').fill('   ');
    await main.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await main.getByRole('alert').waitFor(); assert.equal(flowWrites.length, 0);
    await main.locator('input').fill(' Fixture named workflow ');
    await main.locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await page.waitForURL(/marketing\/flows\/00000000-0000-4000-8000-000000000099/);
    assert.equal(flowWrites.length, 1); assert.equal(flowWrites[0].name, 'Fixture named workflow');
    checks.push(`${locale}/${width}: workflow creation is explicit, rejects blank name, prevents duplicate writes`);
    await page.goto(base + '/webhooks');
    const button = main.getByRole('button', { name: messages.Replay[locale], exact: true });
    await button.waitFor();
    page.once('dialog', dialog => dialog.dismiss()); await button.click(); assert.equal(replayFail, false);
    page.once('dialog', dialog => dialog.accept()); await button.click(); await main.getByRole('alert').waitFor();
    assert.equal(replayFail, true); assert.equal(await button.isEnabled(), true);
    checks.push(`${locale}/${width}: replay confirmation cancel, rejected replay feedback and recovery`);
    await page.goto(base + '/tasks/advanced'); await main.getByRole('link').first().waitFor();
    if (width === 390) {
      for (const node of await main.locator('section li a').all()) assert.ok((await node.boundingBox()).height >= 44, 'Task links have 44px touch targets');
      for (const node of await page.locator('header button[title]:visible').all()) assert.ok((await node.boundingBox()).height >= 44, 'Header icons have 44px touch targets');
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No document overflow');
    await page.screenshot({ path: `${output}/task-advanced-${locale}-${width}.png`, fullPage: true });
    checks.push(`${locale}/${width}: task links, header icons and document layout`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${checks.length} workflow groups across both languages and screen sizes`);
} finally {
  writeFileSync(`${output}/results.json`, JSON.stringify({ apiMode: 'Local intercepted fixtures', checks, errors }, null, 2));
  await browser.close();
}
