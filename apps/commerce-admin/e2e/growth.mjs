#!/usr/bin/env node
// Deterministic browser check; fixtures stay in this test and never backfill live screens.
// Start the admin app, then ADMIN_URL=http://127.0.0.1:4413 node apps/commerce-admin/e2e/growth.mjs.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:4403';
const OUT = '.e2e-out/growth';
const email = 'growth-admin@example.test';
const now = '2026-10-06T03:00:00.000Z';
const evidence = [{ id: 'evidence-1', source: 'Research fixture', title: 'Verified test evidence', url: 'https://example.test/evidence', collectedAt: now, excerpt: 'Deterministic evidence for this browser check.' }];
const requests = [];
const listRequests = [];
const errors = [];
let plan;
let listPlans = [];
let releaseOldSearch;
let aiReady = true;
let workspaceFails = false;
let queueFails = false;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
  await context.addInitScript((token) => sessionStorage.setItem('cp_admin_token', token), `x.${Buffer.from(JSON.stringify({ email, role: 'admin' })).toString('base64url')}.x`);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const body = request.postDataJSON();
    if (request.method() !== 'GET') requests.push({ path, method: request.method(), body });
    const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/admin/stats') return reply({ webhooksPending: 0, webhooksFailed: 0 });
    if (path.includes('/health')) return reply({ now: { problems: [] } });
    if (path === '/growth/readiness') return reply({ ai: aiReady, workflow: true, replica: false, activationBlockers: ['Runtime stock / margin guards are unavailable.'] });
    if (path === '/growth/workspace') return workspaceFails ? reply({ message: 'Workspace unavailable for retry check' }, 503) : reply({
      generatedAt: now, period: { from: now, to: now }, availability: 'unavailable',
      metrics: [{ key: 'revenue', label: 'ยอดขายที่ตรวจได้', value: null, unit: 'THB', note: 'Replica unavailable in this fixture.' }],
      opportunities: [], evidence: [], limitations: ['ยังไม่เชื่อมข้อมูลร้าน'],
    });
    if (path === '/growth/plans' && request.method() === 'GET') {
      const query = url.searchParams;
      if (query.get('status') === 'review' && queueFails) return reply({ message: 'Review queue unavailable for retry check' }, 503);
      listRequests.push(Object.fromEntries(query));
      const search = query.get('search') ?? '', status = query.get('status'), month = query.get('month');
      const pageNumber = Number(query.get('page') ?? 1), limit = Number(query.get('limit') ?? 20);
      const plans = (listPlans.length ? listPlans : plan ? [plan] : []).filter((item) =>
        (!search || `${item.title} ${item.owner} ${item.goal}`.toLowerCase().includes(search.toLowerCase())) &&
        (!status || item.status === status) &&
        (!month || item.scheduleAt && new Date(item.scheduleAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).startsWith(month)));
      if (search === 'Delayed') await new Promise((resolve) => { releaseOldSearch = resolve; });
      return reply({ items: plans.slice((pageNumber - 1) * limit, pageNumber * limit), totalCount: plans.length, page: pageNumber, limit });
    }
    if (path === '/growth/plans' && request.method() === 'POST') {
      assert.match(body.requestId, /^[0-9a-f-]{36}$/);
      plan = { ...body.plan, id: 'growth-test', version: 1, status: 'draft', createdBy: email, approvedBy: null, approvedVersion: null, workflowId: null, evidence, tasks: [], history: [], createdAt: now, updatedAt: now, canManage: true };
      return reply(plan);
    }
    if (path === '/growth/plans/growth-test' && request.method() === 'GET') return reply(plan);
    if (path.startsWith('/growth/plans/growth-test') && request.method() !== 'GET') {
      assert.equal(body.version, plan.version, 'Every mutation must use the current revision.');
      if (path.endsWith('/ai')) return aiReady ? reply({ variants: [{ label: 'A', title: 'AI title A', body: 'AI draft A', evidenceIds: ['evidence-1'] }, { label: 'B', title: 'AI title B', body: 'AI draft B', evidenceIds: ['evidence-1'] }], rationale: 'Based on verified test evidence.', evidenceIds: ['evidence-1'] }) : reply({ message: 'AI is not configured' }, 503);
      if (path.endsWith('/review')) plan = { ...plan, status: 'review', version: plan.version + 1 };
      else if (path.endsWith('/approve')) plan = { ...plan, status: 'approved', version: plan.version + 1, approvedBy: email, approvedVersion: plan.version + 1 };
      else if (path.endsWith('/export') || path.endsWith('/reconcile')) plan = { ...plan, status: 'ready', workflowId: body.workflowId ?? 'workflow-test' };
      else if (path.endsWith('/tasks')) plan = { ...plan, tasks: body.tasks, version: plan.version + 1 };
      else plan = { ...plan, ...body.plan, version: plan.version + 1, status: 'draft', approvedBy: null, approvedVersion: null };
      return reply(plan);
    }
    if (path.startsWith('/growth/results/')) return reply({ workflowId: 'workflow-test', name: 'Results fixture', generatedAt: now, funnel: [], attributedRevenueThb: null, contributionThb: null, missingCosts: ['ต้นทุนสินค้ายังขาด'], experiment: { sent: { enrolled: 0, converted: 0 }, holdout: { enrolled: 0, converted: 0 }, rateDifferencePoints: null, confidence: 'insufficient', note: 'ยังไม่มีข้อมูลเพียงพอ' }, operations: [], limitations: ['Workflow remains paused.'], suggestions: [] });
    if (path.startsWith('/growth/timeline/')) return reply({ companyId: 'company-test', name: 'Company fixture', generatedAt: now, events: [], limitations: ['ยังไม่มีประวัติติดต่อที่ยืนยันได้'] });
    if (path.includes('/marketing-research/topics') && !path.endsWith('/runs')) return reply({ status: 200, message: '', data: { items: [{ id: 'topic-test', title: 'Research fixture', kind: 'trend', area: 'กรุงเทพ', days: 30, sources: ['tat'], canManage: false }], totalCount: 1 } });
    if (path.endsWith('/sources')) return reply({ status: 200, message: '', data: [] });
    if (path.endsWith('/runs')) return reply({ status: 200, message: '', data: [{ id: 'run-test', status: 'completed', createdAt: now, findingsCount: 1, keptAt: now, report: { summary: 'Research evidence summary', findings: [], evidence, limitations: [] } }] });
    return reply({});
  });
  const noOverflow = async () => {
    const overflow = await page.evaluate(() => ({ pixels: document.documentElement.scrollWidth - document.documentElement.clientWidth, elements: [...document.querySelectorAll('main *, header *')].filter((element) => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 10).map((element) => ({ tag: element.tagName, classes: element.className, text: element.textContent.slice(0, 80), right: element.getBoundingClientRect().right })) }));
    if (overflow.pixels > 1) await page.screenshot({ path: `${OUT}/overflow.png`, fullPage: true });
    assert.ok(overflow.pixels <= 1, `Horizontal overflow on ${page.url()}: ${JSON.stringify(overflow)}`);
  };
  const open = async (path) => { await page.goto(`${ADMIN}${path}`, { waitUntil: 'networkidle' }); await page.locator('main h1').waitFor(); await noOverflow(); };
  listPlans = Array.from({ length: 7 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, title: `Review fixture ${index + 1}`, owner: email, goal: 'Fixture only', status: 'review', scheduleAt: now }));
  await open('/marketing/growth');
  assert.ok(await page.getByText('ยังไม่มีข้อมูล', { exact: true }).count());
  assert.ok(await page.getByText(/ยังไม่มีโอกาสที่มีหลักฐานเพียงพอ/).count());
  await page.getByText('แสดง 5 จาก 7 แผน · เรียงตามการแก้ไขล่าสุด', { exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 5);
  assert.equal(await page.getByRole('link', { name: 'Review fixture 1', exact: true }).getAttribute('href'), '/marketing/growth/plans/00000000-0000-4000-8000-000000000001');
  assert.equal(await page.getByRole('link', { name: 'เปิดแผนรอตรวจทั้งหมด', exact: true }).getAttribute('href'), '/marketing/growth/plans?status=review');
  await page.screenshot({ path: `${OUT}/workspace-desktop.png`, fullPage: true });
  workspaceFails = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Workspace unavailable for retry check', { exact: true }).waitFor();
  assert.ok(await page.getByRole('link', { name: 'Review fixture 1', exact: true }).count(), 'The queue remains usable when metrics fail.');
  workspaceFails = false;
  await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
  await page.getByText('ยังไม่มีข้อมูล', { exact: true }).waitFor();
  queueFails = true;
  await page.getByRole('button', { name: 'Refresh แผนรอตรวจ', exact: true }).click();
  await page.getByText('Review queue unavailable for retry check', { exact: true }).waitFor();
  assert.ok(await page.getByText('ยังไม่มีข้อมูล', { exact: true }).count(), 'Queue failure must not replace unavailable metrics with fallback values.');
  assert.equal(await page.getByText('7 แผน', { exact: true }).count(), 0, 'Hide a stale queue count on failure.');
  queueFails = false;
  await page.getByRole('button', { name: 'ลองใหม่', exact: true }).click();
  await page.getByRole('link', { name: 'Review fixture 1', exact: true }).waitFor();
  listPlans = [];
  await open('/marketing/growth');
  await page.getByText('ยังไม่มีแผนที่รอตรวจ', { exact: true }).waitFor();

  await open('/marketing/growth/plans/new?template=winback');
  await page.getByLabel('ชื่อแผน', { exact: true }).fill('Growth browser fixture');
  await page.getByLabel('เป้าหมายและข้อเสนอที่ต้องตรวจ', { exact: true }).fill('Use confirmed terms only.');
  await page.getByLabel('หัวข้อความ A', { exact: true }).fill('Manual A');
  await page.getByLabel('หัวข้อความ B', { exact: true }).fill('Manual B');
  await page.getByLabel('เนื้อหาข้อความ A', { exact: true }).fill('Manual body A');
  await page.getByLabel('เนื้อหาข้อความ B', { exact: true }).fill('Manual body B');
  await page.locator('summary', { hasText: 'กลุ่มเป้าหมาย สินค้า และการทดลอง' }).click();
  await page.getByLabel('Segment IDs', { exact: false }).first().pressSequentially('00000000-0000-4000-8000-000000000001, 00000000-0000-4000-8000-000000000002');
  await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await page.waitForURL('**/marketing/growth/plans/growth-test');
  await page.getByText('revision 1', { exact: true }).waitFor();
  assert.deepEqual(plan.segmentIds, ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
  assert.equal(plan.template, 'winback');
  assert.equal(plan.notifyTemplateKey, null);

  await page.getByLabel('คำสั่งสำหรับ AI', { exact: true }).fill('Draft using the evidence.');
  const updatesBefore = requests.filter((item) => item.method === 'PUT').length;
  await page.getByRole('button', { name: 'ให้ AI ร่าง 2 เวอร์ชัน', exact: true }).click();
  await page.getByText('AI draft A', { exact: true }).waitFor();
  assert.equal(requests.filter((item) => item.method === 'PUT').length, updatesBefore, 'AI must not auto-save.');
  assert.equal(await page.getByLabel('หัวข้อความ A', { exact: true }).inputValue(), 'Manual A');
  await page.getByRole('button', { name: 'นำมาใส่ในร่างเพื่อแก้และบันทึก', exact: true }).click();
  assert.equal(await page.getByLabel('หัวข้อความ A', { exact: true }).inputValue(), 'AI title A');
  assert.ok(await page.getByRole('button', { name: 'ส่งตรวจ', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await page.getByText('revision 2', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'เพิ่มงาน', exact: true }).click();
  await page.getByLabel('งาน 1', { exact: true }).fill('Verify stock before any activation');
  await page.getByRole('button', { name: 'บันทึกงานของทีม', exact: true }).click();
  await page.getByText('revision 3', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'ส่งตรวจ', exact: true }).click();
  await page.getByRole('button', { name: /^อนุมัติ revision / }).click();
  await page.getByRole('button', { name: 'สร้างร่าง workflow ที่หยุดไว้', exact: true }).click();
  await page.getByRole('link', { name: 'เปิดร่าง workflow', exact: true }).waitFor();
  assert.equal(plan.status, 'ready');
  assert.equal(requests.filter((item) => /activate|publish|send/.test(item.path)).length, 0, 'Planning must never activate or send.');
  await page.screenshot({ path: `${OUT}/plan-desktop.png`, fullPage: true });

  plan = { ...plan, status: 'export_unknown', workflowId: null };
  await open('/marketing/growth/plans/growth-test');
  assert.equal(await page.getByRole('button', { name: 'สร้างร่าง workflow ที่หยุดไว้', exact: true }).count(), 0);
  await page.getByLabel('Workflow UUID ที่ตรวจพบ', { exact: true }).fill('workflow-recovery');
  await page.getByRole('button', { name: 'ตรวจและเชื่อมร่าง', exact: true }).click();
  await page.getByRole('link', { name: 'เปิดร่าง workflow', exact: true }).waitFor();
  assert.equal(plan.workflowId, 'workflow-recovery');

  listPlans = [...Array.from({ length: 240 }, (_, index) => ({ ...plan, id: `scheduled-${index}`, title: `Scheduled ${String(index + 1).padStart(3, '0')}`, scheduleAt: '2026-10-06T03:00:00.000Z' })),
    { ...plan, id: 'older-future', title: 'Older future plan', scheduleAt: '2026-09-30T18:30:00.000Z' }];
  await open('/marketing/growth/plans');
  assert.equal(await page.locator('tbody tr').count(), 20);
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await page.getByRole('link', { name: 'Scheduled 021', exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 20, 'Render the server page without slicing it again.');
  await open('/marketing/growth/plans?page=13');
  await page.getByRole('link', { name: 'Older future plan', exact: true }).waitFor();
  await page.getByLabel('ค้นแผน', { exact: true }).fill('Older future');
  await page.getByLabel('สถานะ', { exact: true }).selectOption('ready');
  await page.getByRole('link', { name: 'Older future plan', exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 1);
  assert.deepEqual(listRequests.at(-1), { page: '1', limit: '20', search: 'Older future', status: 'ready' });

  await open('/marketing/growth/plans?view=calendar&month=2026-10');
  await page.getByText('แสดง 20 จาก 241 แผนในเดือนนี้ · วันที่ตามเวลาไทย · ยังไม่มีการส่งข้อความ', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await page.getByRole('link', { name: 'Scheduled 021', exact: true }).waitFor();
  await open('/marketing/growth/plans?view=calendar&month=2026-10&page=13');
  const midnightPlan = page.getByRole('link', { name: 'Older future plan', exact: true });
  await midnightPlan.waitFor();
  assert.equal(await midnightPlan.locator('xpath=../..').locator('span').first().textContent(), '1', 'UTC September 30 must appear on October 1 in Bangkok.');
  await page.getByText('แสดง 1 จาก 241 แผนในเดือนนี้ · วันที่ตามเวลาไทย · ยังไม่มีการส่งข้อความ', { exact: true }).waitFor();

  const scheduledPlans = listPlans;
  listPlans = [{ ...plan, id: 'delayed', title: 'Delayed result' }, { ...plan, id: 'latest', title: 'Latest result' }];
  await open('/marketing/growth/plans');
  const delayedRequest = page.waitForRequest((request) => new URL(request.url()).searchParams.get('search') === 'Delayed');
  await page.getByLabel('ค้นแผน', { exact: true }).fill('Delayed');
  await delayedRequest;
  await page.getByLabel('ค้นแผน', { exact: true }).fill('Latest');
  await page.getByRole('link', { name: 'Latest result', exact: true }).waitFor();
  const delayedResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get('search') === 'Delayed');
  releaseOldSearch();
  await delayedResponse;
  assert.equal(await page.getByRole('link', { name: 'Delayed result', exact: true }).count(), 0, 'A stale response must never replace the latest search.');
  assert.equal(await page.getByLabel('ค้นแผน', { exact: true }).inputValue(), 'Latest');
  listPlans = scheduledPlans;

  await open('/marketing/growth/results/workflow-test');
  assert.ok(await page.getByText('ยังคำนวณไม่ได้', { exact: true }).count());
  assert.ok(await page.getByText('ข้อมูลยังไม่พอสรุป', { exact: true }).count());
  await page.screenshot({ path: `${OUT}/results-desktop.png`, fullPage: true });
  await open('/marketing/growth/plans?view=calendar&month=2026-10');
  await page.screenshot({ path: `${OUT}/calendar-desktop.png`, fullPage: true });
  await open('/marketing/growth/companies/company-test');
  await open('/marketing/research');
  await page.getByRole('button', { name: 'รายงาน', exact: true }).click();
  const researchLink = page.getByRole('link', { name: 'ร่างแผน Growth จากหลักฐานนี้', exact: true });
  await researchLink.waitFor();
  const researchUrl = new URL(await researchLink.getAttribute('href'), ADMIN);
  assert.equal(researchUrl.searchParams.get('topicId'), 'topic-test');
  assert.equal(researchUrl.searchParams.get('runId'), 'run-test');
  await researchLink.click();
  assert.equal(await page.getByLabel('ชื่อแผน', { exact: true }).inputValue(), 'Research fixture');

  aiReady = false;
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/marketing/growth', '/marketing/growth/plans?view=calendar&month=2026-10', '/marketing/growth/plans/growth-test', '/marketing/growth/results/workflow-test', '/marketing/growth/companies/company-test']) {
    await open(path);
    await page.screenshot({ path: `${OUT}/${path.split('/').at(-1).replace(/\W/g, '-')}-mobile.png`, fullPage: true });
  }
  await open('/marketing/growth/plans/growth-test');
  assert.ok(await page.getByText('ยังไม่เชื่อม AI เขียนข้อความและบันทึกแผนด้วยตัวเองได้', { exact: true }).count());
  assert.ok(await page.getByRole('button', { name: 'ให้ AI ร่าง 2 เวอร์ชัน', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'เมนู', exact: true }).click();
  await page.getByRole('link', { name: 'Growth Workspace', exact: true }).click();
  await page.waitForURL('**/marketing/growth');
  assert.equal(await page.getByRole('button', { name: 'เมนู', exact: true }).getAttribute('aria-expanded'), 'false');
  await noOverflow();
  await open('/marketing/research');
  assert.deepEqual(errors, []);
  console.log('PASS Growth: review queue and independent retry/empty states, API wiring, server pagination/search/calendar, Bangkok dates, stale search responses, explicit AI apply, revisioned approval, paused export/recovery, tasks, unavailable states and responsive routes.');
} finally {
  await browser.close();
}
