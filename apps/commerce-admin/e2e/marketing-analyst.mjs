#!/usr/bin/env node
// Browser fixtures only. Start admin, then ADMIN_URL=http://127.0.0.1:4415 node apps/commerce-admin/e2e/marketing-analyst.mjs.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:4403';
const OUT = '.e2e-out/marketing-analyst';
const email = 'analyst@example.test';
const now = '2026-10-06T03:00:00.000Z';
const reportId = '00000000-0000-4000-8000-000000000001';
const olderId = '00000000-0000-4000-8000-000000000002';
const evidence = [
  { id: 'web-1', source: 'Public web fixture', title: 'หลักฐานตลาดสำหรับทดสอบ', url: 'https://example.test/market', collectedAt: now, excerpt: '<img src=x onerror="window.injected=true"> คำอ้างอิงที่ต้องแสดงเป็นข้อความ' },
  { id: 'shop-1', source: 'shop_traffic fixture', title: 'GTM funnel และคำค้นที่ไม่พบสินค้า', url: 'javascript:alert(1)', collectedAt: now, excerpt: 'ค้นหาไม่พบสินค้า 12 ครั้ง ข้อมูล fixture เท่านั้น' },
];
const report = {
  id: reportId, createdBy: email, createdAt: now, question: 'หาเทรนด์ช่วงนี้', area: 'กรุงเทพฯ', days: 14,
  summary: 'หลักฐานตลาดและคำค้นชี้ว่าควรตรวจรายการสินค้า ก่อนทดลองแผนเฉพาะกลุ่ม',
  findings: [
    { title: 'ค้นหาไม่พบสินค้าที่เกี่ยวกับเทรนด์', detail: 'ข้อมูล GTM fixture มีคำค้นที่ไม่พบสินค้า', kind: 'fact', evidenceIds: ['shop-1'] },
    { title: 'กลุ่มร้านอาจสนใจสินค้าทดแทน', detail: 'ยังต้องตรวจกลุ่มเป้าหมายและสินค้า', kind: 'hypothesis', evidenceIds: ['web-1', 'shop-1'] },
  ],
  recommendations: [{ id: 'recommendation-1', title: 'ทดลองรายการสินค้าสำหรับคำค้นที่ไม่พบ', why: 'อิงคำค้นในร้านและหลักฐานตลาด', nextStep: 'ตรวจ SKU และสต็อกกับทีมก่อนร่างข้อความ', successMetric: 'อัตราค้นหาแล้วพบสินค้า', productSkus: ['TEST-SKU-001'], evidenceIds: ['web-1', 'shop-1'] }],
  evidence, trace: [{ tool: 'shop_traffic', status: 'read', detail: 'อ่าน funnel และคำค้นที่ไม่พบแล้ว' }, { tool: 'shop_sales', status: 'unavailable', detail: 'Replica ไม่พร้อม จึงยังสรุปยอดขายไม่ได้' }], limitations: ['ยังไม่ทราบอัตราซื้อจริงของกลุ่มนี้'],
};
const older = { ...report, id: olderId, question: 'รายงานก่อนหน้า', summary: 'สรุปรายงานก่อนหน้า', createdAt: '2026-10-05T03:00:00.000Z' };
const plan = {
  id: 'analyst-plan', title: report.recommendations[0].title, goal: 'ตรวจสินค้าและวัดอัตราค้นหา', template: 'market', owner: email,
  segmentIds: [], excludeSegmentIds: [], productSkus: ['TEST-SKU-001'], notifyTemplateKey: null, scheduleAt: null, budgetThb: 0,
  minimumMarginPercent: 0, holdoutPercent: 10, cooldownDays: 7, conversionWindowDays: 7, variants: [], selectedVariant: 0,
  researchTopicId: null, researchRunId: null, version: 1, status: 'draft', createdBy: email, approvedBy: null, approvedVersion: null,
  workflowId: null, evidence, tasks: [], history: [], createdAt: now, updatedAt: now, canManage: true,
};
const mutations = [], reads = [], errors = [];
let configured = true, analysisFails = true, draftFails = true, historyFails = false, reportFails = false;
let releaseAnalysis;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((token) => sessionStorage.setItem('cp_admin_token', token), `x.${Buffer.from(JSON.stringify({ email, role: 'admin' })).toString('base64url')}.x`);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const body = request.postDataJSON();
    const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (request.method() !== 'GET') mutations.push({ path, body, method: request.method() }); else reads.push(path);
    if (path === '/admin/stats') return reply({ webhooksPending: 0, webhooksFailed: 0 });
    if (path.includes('/health')) return reply({ now: { problems: [] } });
    if (path === '/marketing-analyst/readiness') return reply({ configured, modelConfigured: configured, limitations: ['ข้อมูล GTM อาจขาดบางเหตุการณ์ ต้องตรวจข้อจำกัดของรายงาน'] });
    if (path === '/marketing-analyst/reports' && request.method() === 'GET') return historyFails ? reply({ message: 'History fixture unavailable' }, 503) : reply({ items: [report, older] });
    if (path === '/marketing-analyst/reports' && request.method() === 'POST') {
      assert.match(body.requestId, /^[0-9a-f-]{36}$/);
      if (analysisFails) return reply({ message: 'Analysis fixture unavailable' }, 503);
      await new Promise((resolve) => { releaseAnalysis = resolve; });
      return reply({ ...report, question: body.question, area: body.area, days: body.days });
    }
    if (path.endsWith('/plan')) {
      assert.equal(body.recommendationId, 'recommendation-1');
      return draftFails ? reply({ message: 'Draft fixture unavailable' }, 503) : reply(plan);
    }
    if (path === `/marketing-analyst/reports/${reportId}` || path === `/marketing-analyst/reports/${olderId}`) return reportFails ? reply({ message: 'Report fixture unavailable' }, 503) : reply(path.endsWith(olderId) ? older : report);
    if (path === '/growth/plans/analyst-plan') return reply(plan);
    if (path === '/growth/plans') return reply({ items: [], totalCount: 0, page: 1, limit: 20 });
    if (path === '/growth/readiness') return reply({ ai: false, workflow: false, replica: false, activationBlockers: [] });
    return reply({});
  });
  const noOverflow = async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) await page.screenshot({ path: `${OUT}/overflow.png`, fullPage: true });
    assert.ok(overflow <= 1, `Horizontal overflow (${overflow}px) on ${page.url()}`);
  };
  const open = async (path = '/marketing/analyst') => { await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle' }); await page.locator('main h1').waitFor(); await noOverflow(); };
  const screenshot = async (name) => { await page.evaluate(() => { window.scrollTo(0, 0); }); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
  const analyze = () => page.getByRole('button', { name: 'วิเคราะห์', exact: true });
  const draft = () => page.getByRole('button', { name: 'สร้างแผนร่าง', exact: true });
  await open();
  assert.equal(mutations.length, 0, 'Opening the analyst never runs paid analysis.');
  await page.getByRole('button', { name: 'GTM / ค้นหาไม่เจอ', exact: true }).focus();
  await page.keyboard.press('Enter');
  const question = await page.getByLabel('คำถาม', { exact: true }).inputValue();
  assert.match(question, /GTM funnel/);
  assert.equal(mutations.length, 0, 'A suggested question only fills the form.');
  await page.getByLabel('ช่วงข้อมูล', { exact: true }).selectOption('7');
  await analyze().click();
  await page.getByText(/Analysis fixture unavailable/).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByLabel('คำถาม', { exact: true }).fill(question);
  await page.getByLabel('ช่วงข้อมูล', { exact: true }).selectOption('7');
  analysisFails = false;
  const pending = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/marketing-analyst/reports'));
  await analyze().click(); await pending;
  await page.getByRole('status').filter({ hasText: 'อาจใช้เวลาถึง 3 นาที' }).waitFor();
  assert.ok(await page.getByLabel('คำถาม', { exact: true }).isDisabled());
  assert.ok(await page.getByLabel('เปิดรายงาน', { exact: true }).isDisabled());
  assert.equal(await page.getByRole('progressbar').count(), 0, 'No invented percentage progress.');
  await page.locator('form[data-panel]').evaluate((form) => form.requestSubmit());
  assert.equal(mutations.length, 2, 'The in-flight request cannot be submitted twice.');
  assert.equal(mutations[0].body.requestId, mutations[1].body.requestId, 'Retry after reload retains the paid-analysis request ID.');
  releaseAnalysis();
  await page.getByText(report.summary, { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('report'), reportId);
  assert.equal(mutations[1].body.days, 7);
  assert.equal(mutations.filter((request) => request.path.endsWith('/plan')).length, 0, 'Recommendations never create plans automatically.');
  await page.locator('summary', { hasText: 'ข้อเท็จจริงและสมมติฐาน' }).click();
  await page.getByText('ข้อเท็จจริง', { exact: true }).waitFor();
  await page.getByText('สมมติฐาน · ต้องตรวจเพิ่ม', { exact: true }).waitFor();
  await page.locator('summary', { hasText: 'หลักฐาน 2 รายการ' }).click();
  assert.equal(await page.getByRole('link', { name: evidence[0].title, exact: true }).getAttribute('href'), evidence[0].url);
  assert.equal(await page.getByRole('link', { name: evidence[1].title, exact: true }).count(), 0, 'Non-HTTP URLs stay plain text.');
  assert.ok(await page.getByText(evidence[0].excerpt, { exact: true }).count());
  assert.equal(await page.locator('main img').count(), 0, 'Source HTML is rendered as text.');
  await page.locator('summary', { hasText: 'ข้อมูลที่ AI อ่าน 2 รายการ' }).click();
  await page.getByText('อ่านแล้ว', { exact: true }).waitFor();
  await page.getByText('อ่านไม่ได้', { exact: true }).waitFor();
  await page.getByText('หลักฐาน: web-1, shop-1', { exact: true }).first().waitFor();
  await screenshot('report-desktop');
  await page.getByLabel('เปิดรายงาน', { exact: true }).selectOption(olderId);
  await page.getByText(older.summary, { exact: true }).waitFor();
  assert.equal(await page.getByLabel('คำถาม', { exact: true }).inputValue(), question, 'History selection preserves the next question.');
  assert.equal(mutations.length, 2, 'Reading history never analyses again.');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(older.summary, { exact: true }).waitFor();
  assert.ok(reads.includes(`/marketing-analyst/reports/${olderId}`), 'The URL report reloads from its read endpoint.');
  historyFails = true;
  await page.getByRole('button', { name: 'โหลดรายงานล่าสุด', exact: true }).click();
  await page.getByText('History fixture unavailable', { exact: true }).waitFor();
  assert.ok(await page.getByText(older.summary, { exact: true }).count(), 'History failure does not hide the selected report.');
  historyFails = false;
  await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
  await page.getByLabel('เปิดรายงาน', { exact: true }).waitFor();
  reportFails = true;
  await page.getByLabel('เปิดรายงาน', { exact: true }).selectOption(reportId);
  await page.getByText('Report fixture unavailable', { exact: true }).waitFor();
  reportFails = false;
  await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
  await page.getByText(report.summary, { exact: true }).waitFor();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow();
    if (width === 320) await screenshot('report-mobile');
  }
  await draft().click();
  await page.getByText(/Draft fixture unavailable/).waitFor();
  draftFails = false;
  await draft().click();
  await page.waitForURL('**/marketing/growth/plans/analyst-plan');
  await page.getByText('revision 1', { exact: true }).waitFor();
  const drafts = mutations.filter((request) => request.path.endsWith('/plan'));
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].body.requestId, drafts[1].body.requestId, 'Draft retry is idempotent.');
  assert.equal(plan.status, 'draft');
  assert.equal(mutations.filter((request) => /activate|publish|send|workflow/.test(request.path)).length, 0);
  configured = false;
  await open();
  assert.ok(await analyze().isDisabled());
  await page.getByText('ยังไม่พร้อมวิเคราะห์', { exact: true }).waitFor();
  await screenshot('unconfigured-desktop');
  await page.setViewportSize({ width: 320, height: 900 }); await noOverflow();
  await screenshot('unconfigured-mobile');
  configured = true;
  await page.getByRole('button', { name: 'ตรวจความพร้อม', exact: true }).click();
  await analyze().waitFor({ state: 'visible' });
  const leavingRequest = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/marketing-analyst/reports'));
  await analyze().click(); await leavingRequest;
  await page.getByRole('link', { name: 'แผน Growth', exact: true }).click();
  await page.waitForURL('**/marketing/growth/plans');
  const leavingResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/marketing-analyst/reports'));
  releaseAnalysis(); await leavingResponse;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(new URL(page.url()).pathname, '/marketing/growth/plans', 'A late analysis response never redirects after leaving the page.');
  assert.deepEqual(errors, []);
  console.log('PASS Marketing Analyst: explicit analysis/draft, same-ID retries, single flight, source safety, MCP availability, saved reports and mobile overflow.');
} finally { await browser.close(); }
