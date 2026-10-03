#!/usr/bin/env node
// End-to-end proof of the MCP server + its OAuth flow, driven the way an AI
// connector (Claude / ChatGPT) does it: discovery → dynamic client
// registration → PKCE authorize → staff sign-in → token → MCP tools →
// refresh rotation → revoke.
//
// Prereqs: platform running with MCP_PUBLIC_URL=$MCP_BASE (default
// http://localhost:3100), and two staff accounts:
//   STAFF_PASSWORD=… npm run create-staff -- <admin email> admin
//   STAFF_PASSWORD=… npm run create-staff -- <marketing email> marketing
// Run (from repo root):
//   MCP_BASE=http://localhost:3100 CP_ADMIN_EMAIL=… CP_ADMIN_PASSWORD=… \
//   CP_MKT_EMAIL=… CP_MKT_PASSWORD=… node apps/commerce-platform/e2e/mcp-scenarios.mjs
// Optional, for the write tools: MCP_SKU (a SKU in the Josh catalog copy, used to create a test
// competitor pair), MCP_FAILED_DELIVERY / MCP_FAILED_INGEST (ids of a failed webhook delivery /
// ERP record to retry).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = (process.env.MCP_BASE ?? 'http://localhost:3100').replace(/\/$/, '');
const need = (k) => process.env[k] ?? (console.error(`set ${k}`), process.exit(2));
const ADMIN = { email: need('CP_ADMIN_EMAIL'), password: need('CP_ADMIN_PASSWORD') };
const MKT = { email: need('CP_MKT_EMAIL'), password: need('CP_MKT_PASSWORD') };
const REDIRECT = 'http://localhost:9/callback';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const form = (o) => new URLSearchParams(o);

async function register() {
  const res = await fetch(`${BASE}/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'e2e connector', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: 'commerce.read' }) });
  return { status: res.status, client: await res.json() };
}

/** Authorize + sign in. Returns { code, location, page } — code null when the sign-in failed. */
async function authorize(clientId, verifier, who, allowWrite = false) {
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = `${BASE}/authorize?${form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: 'S256', state: 'st-123', scope: allowWrite ? 'commerce.read commerce.write' : 'commerce.read', resource: `${BASE}/mcp` })}`;
  const page = await (await fetch(url)).text();
  const requestId = page.match(/name="request_id" value="([^"]+)"/)?.[1];
  const res = await fetch(`${BASE}/mcp/oauth/login`, { method: 'POST', redirect: 'manual',
    body: form({ request_id: requestId ?? '', email: who.email, password: who.password, ...(allowWrite ? { allow_write: '1' } : {}) }) });
  const location = res.headers.get('location');
  return { requestId, page, status: res.status, location, code: location ? new URL(location).searchParams.get('code') : null, body: location ? '' : await res.text() };
}

const token = async (params) => {
  const res = await fetch(`${BASE}/token`, { method: 'POST', body: form(params) });
  return { status: res.status, json: await res.json() };
};

async function mcp(accessToken) {
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
  return client;
}
const callJson = async (client, name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

async function signIn(clientId, who, allowWrite = false) {
  const verifier = randomBytes(32).toString('base64url');
  const auth = await authorize(clientId, verifier, who, allowWrite);
  return token({ grant_type: 'authorization_code', client_id: clientId, code: auth.code ?? '', code_verifier: verifier, redirect_uri: REDIRECT });
}

// 1. discovery, exactly what a connector reads first
const unauth = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
check('no token → 401 pointing at the resource metadata', unauth.status === 401 && /resource_metadata=/.test(unauth.headers.get('www-authenticate') ?? ''), unauth.headers.get('www-authenticate'));
const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
check('protected-resource metadata names our authorization server', prm.authorization_servers?.[0]?.startsWith(BASE), JSON.stringify(prm.authorization_servers));
const asm = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
check('authorization-server metadata: PKCE S256 + dynamic registration', asm.code_challenge_methods_supported?.includes('S256') && !!asm.registration_endpoint);

// 2. dynamic client registration
const { status: regStatus, client } = await register();
check('dynamic client registration → 201 + client_id', regStatus === 201 && !!client.client_id, `${regStatus}`);

// 3. sign-in page + wrong password
const bad = await authorize(client.client_id, randomBytes(32).toString('base64url'), { email: MKT.email, password: 'wrong-password' });
check('authorize shows our staff sign-in page; a read-only request has no "allow changes" box', !!bad.requestId && !bad.page.includes('name="allow_write"'));
check('wrong password → stays on the page with an error, no code', bad.status === 400 && !bad.code && bad.body.includes('role="alert"'));

// 4. marketing staff: PKCE code → tokens
const verifier = randomBytes(32).toString('base64url');
const ok = await authorize(client.client_id, verifier, MKT);
check('correct password → redirect with code + original state', !!ok.code && new URL(ok.location).searchParams.get('state') === 'st-123', ok.location);
const wrongVerifier = await token({ grant_type: 'authorization_code', client_id: client.client_id, code: ok.code, code_verifier: randomBytes(32).toString('base64url'), redirect_uri: REDIRECT });
check('token with a wrong PKCE verifier → rejected', wrongVerifier.status === 400, JSON.stringify(wrongVerifier.json));
const t1 = await token({ grant_type: 'authorization_code', client_id: client.client_id, code: ok.code, code_verifier: verifier, redirect_uri: REDIRECT });
check('code + verifier → access + refresh token, scope commerce.read', t1.status === 200 && !!t1.json.access_token && !!t1.json.refresh_token && t1.json.scope === 'commerce.read', JSON.stringify(t1.json).slice(0, 80));
const reuse = await token({ grant_type: 'authorization_code', client_id: client.client_id, code: ok.code, code_verifier: verifier, redirect_uri: REDIRECT });
check('authorization code is single use', reuse.status === 400);

// 5. MCP as marketing
const mkt = await mcp(t1.json.access_token);
const mktTools = (await mkt.listTools()).tools;
const names = mktTools.map((t) => t.name).sort();
check('marketing sees the 6 marketing tools only', names.join() === 'catalog_products,competitor_prices,research_report,research_topics,scraped_catalog_search,scraping_sources', names.join());
check('every tool is marked read-only', mktTools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false));
const cp = await callJson(mkt, 'competitor_prices', { filter: 'all', limit: 5 });
check('competitor_prices answers', typeof cp.total === 'number', JSON.stringify(cp).slice(0, 160));
const cat = await callJson(mkt, 'catalog_products', { query: process.env.MCP_SKU ?? 'A', limit: 3 });
check('catalog_products answers', Array.isArray(cat), JSON.stringify(cat).slice(0, 160));
const topics = await callJson(mkt, 'research_topics', {});
check('research_topics answers', typeof topics.total === 'number', JSON.stringify(topics).slice(0, 120));
const src = await callJson(mkt, 'scraping_sources');
check('scraping_sources answers', Array.isArray(src));
const forbidden = await mkt.callTool({ name: 'erp_intake_summary', arguments: {} }).then((r) => r.isError === true, () => true);
check('marketing cannot call an admin tool', forbidden);
await mkt.close();

// 6. admin
const t2 = await signIn(client.client_id, ADMIN);
const admin = await mcp(t2.json.access_token);
const adminNames = (await admin.listTools()).tools.map((t) => t.name);
check('admin also gets erp_intake_summary, webhook_failures, stock_levels', ['erp_intake_summary', 'webhook_failures', 'stock_levels'].every((n) => adminNames.includes(n)), adminNames.join());
const erp = await callJson(admin, 'erp_intake_summary', { hours: 24 * 30 });
check('erp_intake_summary answers', Array.isArray(erp.counts), JSON.stringify(erp).slice(0, 160));
check('webhook_failures answers', Array.isArray(await callJson(admin, 'webhook_failures', { limit: 5 })));
check('stock_levels answers', Array.isArray(await callJson(admin, 'stock_levels', { sku: process.env.MCP_SKU ?? 'NONE' })));
await admin.close();

// 7. refresh rotation + revoke
const r1 = await token({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: t1.json.refresh_token });
check('refresh → new token pair', r1.status === 200 && r1.json.access_token !== t1.json.access_token);
const rOld = await token({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: t1.json.refresh_token });
check('old refresh token cannot be reused (rotation)', rOld.status === 400);
const rev = await fetch(`${BASE}/revoke`, { method: 'POST', body: form({ client_id: client.client_id, token: r1.json.access_token }) });
const afterRevoke = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${r1.json.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
check('revoked access token → 401', rev.status === 200 && afterRevoke.status === 401, `${rev.status}/${afterRevoke.status}`);

// 8. write tools: opt-in at sign-in, then preview → confirm
const text = async (client, name, args) => { const r = await client.callTool({ name, arguments: args }); return { ...JSON.parse(r.content[0].text || '{}'), isError: r.isError === true }; };
const wPage = await authorize(client.client_id, randomBytes(32).toString('base64url'), { email: MKT.email, password: 'wrong' }, true);
check('a client asking for commerce.write gets the opt-in box on the sign-in page', wPage.page.includes('name="allow_write"'));
const notTicked = await (async () => {
  const v = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(v).digest('base64url');
  const page = await (await fetch(`${BASE}/authorize?${form({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope: 'commerce.read commerce.write', resource: `${BASE}/mcp` })}`)).text();
  const res = await fetch(`${BASE}/mcp/oauth/login`, { method: 'POST', redirect: 'manual', body: form({ request_id: page.match(/name="request_id" value="([^"]+)"/)[1], email: MKT.email, password: MKT.password }) });
  return token({ grant_type: 'authorization_code', client_id: client.client_id, code: new URL(res.headers.get('location')).searchParams.get('code'), code_verifier: v, redirect_uri: REDIRECT });
})();
check('asked for write but the box was not ticked → read only', notTicked.json.scope === 'commerce.read', notTicked.json.scope);
const tw = await signIn(client.client_id, MKT, true);
check('ticking "allow changes" → scope commerce.read commerce.write', tw.json.scope === 'commerce.read commerce.write', tw.json.scope);
const w = await mcp(tw.json.access_token);
const wNames = (await w.listTools()).tools;
check('write sign-in adds research + price tools, not admin write tools', ['research_create_topic', 'research_request_run', 'competitor_record_price'].every((n) => wNames.some((t) => t.name === n))
  && !wNames.some((t) => ['webhook_retry_delivery', 'erp_replay_ingest'].includes(t.name)), wNames.map((t) => t.name).join());
check('write tools are not marked read-only', wNames.filter((t) => t.name.startsWith('research_create') || t.name.startsWith('competitor_record')).every((t) => t.annotations?.readOnlyHint === false));
const before = (await callJson(w, 'research_topics', {})).total;
const topicArgs = { title: `e2e ร้านกาแฟ ${Date.now()}`, kind: 'sales', sources: ['tat', 'osm'] };
const p1 = await text(w, 'research_create_topic', topicArgs);
check('first call only previews + returns a confirmCode', p1.status === 'needs_confirmation' && !!p1.confirmCode && p1.willDo?.title === topicArgs.title);
check('preview changed nothing', (await callJson(w, 'research_topics', {})).total === before);
check('wrong confirmCode → rejected', (await text(w, 'research_create_topic', { ...topicArgs, confirmCode: 'nope' })).status === 'rejected');
check('same code but changed arguments → rejected', (await text(w, 'research_create_topic', { ...topicArgs, title: 'something else', confirmCode: p1.confirmCode })).status === 'rejected');
const p2 = await text(w, 'research_create_topic', topicArgs);
const done = await text(w, 'research_create_topic', { ...topicArgs, confirmCode: p2.confirmCode });
check('confirmCode + same arguments → topic created', done.status === 'done' && !!done.result?.topicId, JSON.stringify(done).slice(0, 140));
check('a confirmCode works only once', (await text(w, 'research_create_topic', { ...topicArgs, confirmCode: p2.confirmCode })).status === 'rejected');
check('topic count +1', (await callJson(w, 'research_topics', {})).total === before + 1);
const runP = await text(w, 'research_request_run', { topicId: done.result.topicId });
const runD = await text(w, 'research_request_run', { topicId: done.result.topicId, confirmCode: runP.confirmCode });
check('research_request_run: preview names the topic, confirm queues a run', runP.willDo?.topic === topicArgs.title && runD.status === 'done' && !!runD.result?.runId, JSON.stringify(runD).slice(0, 120));
if (process.env.MCP_SKU) {
  const staffToken = (await (await fetch(`${BASE}/api/admin/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(MKT) })).json()).accessToken;
  const created = await (await fetch(`${BASE}/api/competitor-prices`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${staffToken}` },
    body: JSON.stringify({ sku: process.env.MCP_SKU, ourWeightKg: 1, sourceUrl: `https://www.makro.pro/p/e2e-${Date.now()}`, competitorName: 'e2e item', competitorSku: '',
      competitorWeightKg: 2, sourceContext: 'ราคาปกติ', vatIncluded: true, collectionAllowed: false, autoRefresh: false }) })).json();
  const pairId = created.data?.id;
  const pp = await text(w, 'competitor_record_price', { pairId, priceIncVat: 500 });
  check('competitor_record_price preview shows per-kg of the new price', pp.status === 'needs_confirmation' && pp.willDo?.newPerKg === 250, JSON.stringify(pp.willDo ?? pp).slice(0, 140));
  const pd = await text(w, 'competitor_record_price', { pairId, priceIncVat: 500, confirmCode: pp.confirmCode });
  check('competitor_record_price confirm saves it (250/kg)', pd.status === 'done' && pd.result?.competitorPerKg === 250, JSON.stringify(pd).slice(0, 140));
}
await w.close();
const ta = await signIn(client.client_id, ADMIN, true);
const aw = await mcp(ta.json.access_token);
const awNames = (await aw.listTools()).tools.map((t) => t.name);
check('admin write sign-in also gets webhook_retry_delivery + erp_replay_ingest', ['webhook_retry_delivery', 'erp_replay_ingest'].every((n) => awNames.includes(n)));
const missing = await aw.callTool({ name: 'webhook_retry_delivery', arguments: { deliveryId: randomUUID() } });
check('retry of an unknown delivery → tool error, nothing done', missing.isError === true);
if (process.env.MCP_FAILED_DELIVERY) {
  const dp = await text(aw, 'webhook_retry_delivery', { deliveryId: process.env.MCP_FAILED_DELIVERY });
  const dd = await text(aw, 'webhook_retry_delivery', { deliveryId: process.env.MCP_FAILED_DELIVERY, confirmCode: dp.confirmCode });
  check('webhook_retry_delivery: preview shows the failure, confirm re-queues (pending)', dp.willDo?.status === 'failed' && dd.result?.status === 'pending', JSON.stringify(dd).slice(0, 120));
}
if (process.env.MCP_FAILED_INGEST) {
  const ip = await text(aw, 'erp_replay_ingest', { recordId: process.env.MCP_FAILED_INGEST });
  const id = await text(aw, 'erp_replay_ingest', { recordId: process.env.MCP_FAILED_INGEST, confirmCode: ip.confirmCode });
  check('erp_replay_ingest: preview shows the failed record, confirm re-applies it', ip.willDo?.status === 'failed' && id.status === 'done', JSON.stringify(id).slice(0, 160));
}
await aw.close();

// Leave one live admin token for the caller's "disabled account" check.
if (process.env.MCP_TOKEN_OUT) (await import('node:fs')).writeFileSync(process.env.MCP_TOKEN_OUT, t2.json.access_token);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
