/** Serial, localhost-only validation. Every API request is intercepted; no service writes. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.UI_FORM_BASE_URL || 'http://127.0.0.1:4405';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Only local validation is supported');
const output = path.resolve('docs/reviews/admin-task-navigation/current-form-components');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, headless: true, args: ['--no-sandbox'] });
const results = [];
const errors = [];
let calls = 0;
let outcome = 'success';
let resolvePending;
let pending;
async function check(name, run) { await run(); results.push({ name, passed: true }); }
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1050 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__task_form_validation') {
      calls += 1;
      const body = route.request().postDataJSON();
      assert.equal(body.intent, 'save'); assert.equal(body.warehouse, 'BKK'); assert.equal(body.account, undefined); assert.equal(body.options, undefined);
      if (outcome === 'pending') await pending;
      const response = outcome === 'field' ? { ok: false, fieldErrors: { email: 'Use another email; this one is already registered.' } }
        : outcome === 'network' ? { ok: false, formError: 'Connection unavailable. Try again; your values are still here.' }
        : outcome === 'false' ? { ok: false }
        : { ok: true, contact: { id: 'fixture-persisted-1', ...body } };
      await route.fulfill({ status: outcome === 'network' ? 503 : outcome === 'field' ? 422 : 200, contentType: 'application/json', body: JSON.stringify(response) }); return;
    }
    if (url.origin === new URL(base).origin) return route.continue();
    await route.abort('blockedbyclient');
  });
  const fixture = `${base}/e2e/fixtures/task-form-validation.html`;
  await page.goto(`${fixture}?lang=en`);
  await check('Tab follows native enabled controls, skips disabled/loading, and select supports keyboard values', async () => {
    await page.keyboard.press('Tab'); await assert.doesNotReject(() => page.locator('[name="name"]').waitFor()); assert.equal(await page.locator('[name="name"]').evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Tab'); assert.equal(await page.locator('[name="email"]').evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Tab'); assert.equal(await page.locator('[name="warehouse"]').evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('[name="warehouse"]').inputValue(), 'BKK');
    await page.keyboard.press('Tab'); assert.equal(await page.locator('[name="note"]').evaluate(el => document.activeElement === el), true);
    await page.keyboard.press('Tab'); assert.equal(await page.getByRole('button', { name: 'Save contact' }).evaluate(el => document.activeElement === el), true);
  });
  await check('Enter submits natively and focuses first invalid field with associated inline errors', async () => {
    await page.locator('[name="name"]').focus(); await page.keyboard.press('Enter');
    await page.getByRole('alert').waitFor(); assert.equal(calls, 0); assert.equal(await page.locator('[name="name"]').evaluate(el => document.activeElement === el), true);
    for (const name of ['name', 'email']) assert.equal(await page.locator(`[name="${name}"]`).getAttribute('aria-invalid'), 'true');
    const descriptions = await page.locator('[name="name"]').evaluate(el => el.getAttribute('aria-describedby').split(' ').map(id => document.getElementById(id)?.textContent)); assert(descriptions.some(text => text.includes('Enter your full name.')));
    await page.screenshot({ path: path.join(output, 'form-errors-en.png'), fullPage: true });
  });
  await page.locator('[name="name"]').fill('Validated contact'); await page.locator('[name="email"]').fill('person@example.com');
  outcome = 'pending'; pending = new Promise(resolve => { resolvePending = resolve; });
  await check('Pending submit blocks duplicate clicks and Enter; success waits for receipt', async () => {
    await page.locator('[name="email"]').press('Enter'); await page.getByRole('status').filter({ hasText: 'Saving contact' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Save contact' }).isDisabled(), true);
    await page.evaluate(() => { document.querySelector('form').requestSubmit(); document.querySelector('form').requestSubmit(); });
    assert.equal(calls, 1); assert.equal(await page.getByText('Contact saved.', { exact: true }).count(), 0);
    outcome = 'field'; resolvePending(); await page.getByText('Use another email; this one is already registered.').waitFor(); assert.equal(calls, 1);
    assert.equal(await page.locator('[name="email"]').inputValue(), 'person@example.com'); assert.equal(await page.locator('[name="email"]').evaluate(el => document.activeElement === el), true);
  });
  await page.locator('[name="email"]').fill('another@example.com');
  await check('Business false and network failures preserve controlled/uncontrolled values and never show success', async () => {
    outcome = 'false'; await page.getByRole('button', { name: 'Save contact' }).click(); await page.getByText('Could not save. Try again; your values are still here.').waitFor();
    outcome = 'network'; await page.getByRole('button', { name: 'Save contact' }).click(); await page.getByText('Connection unavailable. Try again; your values are still here.').waitFor();
    assert.equal(await page.locator('[name="name"]').inputValue(), 'Validated contact'); assert.equal(await page.locator('[name="warehouse"]').inputValue(), 'BKK'); assert((await page.locator('[name="note"]').inputValue()).includes('Keep these notes')); assert.equal(await page.getByText('Contact saved.', { exact: true }).count(), 0);
  });
  await check('Retry succeeds after an explicit API receipt and editing removes stale success', async () => {
    outcome = 'success'; await page.getByRole('button', { name: 'Save contact' }).click(); await page.getByText('Contact saved.', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'form-success-en.png'), fullPage: true });
    await page.locator('[name="name"]').fill('Edited contact'); assert.equal(await page.getByText('Contact saved.', { exact: true }).count(), 0);
  });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`${fixture}?lang=th`);
  await check('Long Thai labels wrap on phones, controls retain 44px targets and no horizontal overflow', async () => {
    await page.locator('[name="name"]').waitFor(); await page.getByRole('button', { name: 'บันทึกผู้ติดต่อ' }).click(); await page.getByRole('alert').waitFor();
    const metrics = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth, label: document.querySelector('label').getBoundingClientRect().height, control: document.querySelector('input').getBoundingClientRect().height }));
    assert(metrics.content <= metrics.width); assert(metrics.label > 22); assert(metrics.control >= 44);
    await page.screenshot({ path: path.join(output, 'form-phone-errors-th.png'), fullPage: true });
  });
  assert.equal(errors.length, 0, errors.join('\n'));
  await context.close();
} finally {
  await browser.close();
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ fixtureOnly: true, scope: 'Shared-component fixture; application consumers are verified separately by task-navigation.mjs', interceptedApi: true, actualPersistenceVerified: false, results, apiCalls: calls, pageErrors: errors }, null, 2) + '\n');
}
console.log(JSON.stringify({ scenarios: results.length, screenshots: 3, apiCalls: calls, pageErrors: errors.length }));
