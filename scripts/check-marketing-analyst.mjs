#!/usr/bin/env node
// Local isolated database/API proof; stored report is an explicitly synthetic fixture, never an AI result.
// ANALYST_CHECK_PASSWORD=local-growth-check-only ANALYST_CHECK_DB=commerce_growth_test_20261006 node scripts/check-marketing-analyst.mjs
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
const base = process.env.ANALYST_CHECK_API ?? 'http://127.0.0.1:3113/api';
const database = process.env.ANALYST_CHECK_DB;
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
assert.ok(database?.startsWith('commerce_growth_test_'), 'Only an isolated test DB');
assert.ok(process.env.ANALYST_CHECK_PASSWORD);
async function call(path, token, method = 'GET', body, status) {
  const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (status) assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`);
  else assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
const login = async email => (await call('/admin/auth/login', null, 'POST', { email, password: process.env.ANALYST_CHECK_PASSWORD })).accessToken;
const admin = await login('growth-admin@example.test'), marketing = await login('growth-marketing@example.test');
const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const owner = claims(marketing).sub;
assert.ok(owner);
const id = randomUUID(), evidenceId = `analysis:${id}:mcp:0`;
const input = { question: 'Synthetic local report fixture', area: 'กรุงเทพฯ', days: 14 };
const report = { ...input, id, createdBy: owner, createdAt: new Date().toISOString(), summary: 'ทดสอบ local เท่านั้น',
  findings: [], recommendations: [{ id: 'check', title: 'ตรวจพฤติกรรม', why: 'สมมติฐาน fixture', nextStep: 'ตรวจ event', successMetric: 'ยืนยัน coverage', productSkus: [], evidenceIds: [evidenceId] }],
  evidence: [{ id: evidenceId, source: 'Synthetic local fixture', title: 'fixture', url: null, collectedAt: new Date().toISOString(), excerpt: 'Not a live GTM or AI result' }], trace: [], limitations: ['test fixture'] };
const db = new pg.Client({ host: 'localhost', user: process.env.ANALYST_CHECK_DB_USER ?? process.env.USER, database });
await db.connect();
try {
  await db.query('INSERT INTO market_analysis_reports (id, "createdBy", "requestHash", report) VALUES ($1,$2,$3,$4)', [id, owner, createHash('sha256').update(JSON.stringify(input)).digest('hex'), report]);
  await call('/marketing-analyst/reports', null, 'GET', undefined, 401);
  assert.equal((await call('/marketing-analyst/readiness', marketing)).configured, false);
  await call('/marketing-analyst/reports', marketing, 'POST', { requestId: randomUUID(), ...input }, 503);
  assert.equal((await call('/marketing-analyst/reports', marketing, 'POST', { requestId: id, ...input })).id, id);
  await call('/marketing-analyst/reports', marketing, 'POST', { requestId: id, ...input, days: 15 }, 409);
  assert.ok((await call('/marketing-analyst/reports', marketing)).items.some(r => r.id === id));
  assert.equal((await call(`/marketing-analyst/reports/${id}`, admin)).id, id);
  const privateId = randomUUID();
  await db.query('INSERT INTO market_analysis_reports (id, "createdBy", "requestHash", report) VALUES ($1,$2,$3,$4)', [privateId, claims(admin).sub, 'fixture', { ...report, id: privateId, createdBy: claims(admin).sub }]);
  await call(`/marketing-analyst/reports/${privateId}`, marketing, 'GET', undefined, 403);
  const requestId = randomUUID(), action = { requestId, recommendationId: 'check' };
  const plan = await call(`/marketing-analyst/reports/${id}/plan`, marketing, 'POST', action);
  assert.equal(plan.analysisId, id); assert.equal(plan.status, 'draft'); assert.equal(plan.workflowId, null);
  assert.deepEqual(plan.segmentIds, []); assert.equal(plan.scheduleAt, null);
  assert.ok(plan.evidence.some(e => e.id === evidenceId));
  assert.equal((await call(`/marketing-analyst/reports/${id}/plan`, marketing, 'POST', action)).id, requestId);
  await call(`/marketing-analyst/reports/${id}/plan`, marketing, 'POST', { requestId: randomUUID(), recommendationId: 'unknown' }, 400);
  const fields = Object.fromEntries(['title','goal','template','owner','segmentIds','excludeSegmentIds','productSkus','notifyTemplateKey','scheduleAt','budgetThb','minimumMarginPercent','holdoutPercent','cooldownDays','conversionWindowDays','variants','selectedVariant','researchTopicId','researchRunId','analysisId'].map(k => [k, plan[k]]));
  await call('/growth/plans', marketing, 'POST', { requestId: randomUUID(), plan: { ...fields, analysisId: privateId } }, 403);
  const revised = await call(`/growth/plans/${plan.id}`, marketing, 'PUT', { version: plan.version, plan: { ...fields, title: 'revised fixture' } });
  assert.equal(revised.analysisId, id); assert.ok(revised.evidence.some(e => e.id === evidenceId));
  console.log('PASS real isolated API/DB: provider unavailable, persisted replay, ownership/admin read, report-to-draft citations/idempotency, linked edit, no workflow');
} finally { await db.end(); }
