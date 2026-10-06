#!/usr/bin/env node
// Against the isolated local test API after migrations + create-staff, never a live integration.
// GROWTH_CHECK_PASSWORD=local-growth-check-only node scripts/check-growth.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const base = process.env.GROWTH_CHECK_API ?? 'http://127.0.0.1:3113/api';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local isolated API');
assert.ok(process.env.GROWTH_CHECK_PASSWORD, 'Set the password used to create the test staff accounts');
async function call(path, token, method = 'GET', body, status) {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (status) assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`);
  else assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
const login = async email => (await call('/admin/auth/login', null, 'POST', { email, password: process.env.GROWTH_CHECK_PASSWORD })).accessToken;
const admin = await login('growth-admin@example.test');
const marketing = await login('growth-marketing@example.test');
const requestId = randomUUID();
const fields = {
  title: `Local growth check ${requestId}`, goal: 'ตรวจ flow ในฐานทดสอบ', template: 'winback', owner: 'ทีมทดสอบ',
  segmentIds: [randomUUID()], excludeSegmentIds: [], productSkus: [], notifyTemplateKey: null,
  scheduleAt: '2026-10-31T18:30:00.000Z', budgetThb: 2000, minimumMarginPercent: 20, holdoutPercent: 10,
  cooldownDays: 7, conversionWindowDays: 14, variants: [{ label: 'A', title: 'ร่างทดสอบ', body: 'ยังไม่ส่ง', evidenceIds: [] }],
  selectedVariant: 0, researchTopicId: null, researchRunId: null,
};
const workspace = await call('/growth/workspace', admin);
assert.equal(workspace.availability, 'unavailable');
assert.ok(workspace.metrics.every(m => m.value === null));
await call('/growth/plans', null, 'GET', undefined, 401);
const created = await call('/growth/plans', admin, 'POST', { requestId, plan: fields });
assert.equal(created.version, 1);
assert.equal((await call('/growth/plans', admin, 'POST', { requestId, plan: fields })).id, requestId);
await call(`/growth/plans/${requestId}`, marketing, 'PUT', { version: 1, plan: fields }, 403);
const revisions = await Promise.all([2001, 2002].map(budgetThb => fetch(`${base}/growth/plans/${requestId}`, {
  method: 'PUT', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, plan: { ...fields, budgetThb } }),
})));
assert.deepEqual(revisions.map(r => r.status).sort(), [200, 409], 'DB row lock allows exactly one same-version edit');
let plan = await call(`/growth/plans/${requestId}`, admin);
plan = await call(`/growth/plans/${requestId}/review`, admin, 'POST', { version: plan.version });
await call(`/growth/plans/${requestId}/approve`, marketing, 'POST', { version: plan.version }, 403);
plan = await call(`/growth/plans/${requestId}/approve`, admin, 'POST', { version: plan.version });
assert.equal(plan.approvedVersion, plan.version);
await call(`/growth/plans/${requestId}/ai`, admin, 'POST', { version: plan.version, instruction: 'ร่างข้อความ' }, 503);
await call(`/growth/plans/${requestId}/export`, admin, 'POST', { version: plan.version }, 503);
const calendar = await call(`/growth/plans?month=2026-11&search=${requestId}&page=1&limit=1`, admin);
assert.equal(calendar.totalCount, 1); assert.equal(calendar.items[0].id, requestId);
assert.equal((await call(`/growth/plans?month=2026-10&search=${requestId}`, admin)).totalCount, 0);
await call('/growth/plans?limit=201', admin, 'GET', undefined, 400);
const revised = await call(`/growth/plans/${requestId}`, admin, 'PUT', { version: plan.version, plan: fields });
assert.equal(revised.status, 'draft'); assert.equal(revised.approvedBy, null);
assert.equal((await call('/growth/plans', admin, 'POST', { requestId, plan: fields })).version, revised.version);
console.log('PASS real local API: persistence, idempotency, auth/ownership, concurrent revision, approval invalidation, missing-provider states, server pagination/Bangkok month');
