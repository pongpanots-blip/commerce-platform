// Read-only release verification, plus staff login and a register probe for the
// already authenticated staff account (which cannot create a new account).
// Never print credentials, tokens, rows or key values.
const assert = require('node:assert/strict');
require('reflect-metadata');
const base = `http://127.0.0.1:${process.env.PORT || 3100}/api`;
async function call(path, token, body) {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
(async () => {
  const { portalSelfRegisterEnabled } = require('./src/modules/core/auth/application/portal-auth.service');
  const { keyMintApproved } = require('./src/portal/keys/key-mint-approval');
  const { trustedKeysEnforced, trustedKeyIds } = require('./src/storefront/trusted-storefront-key');
  const policy = { selfRegisterEnabled: portalSelfRegisterEnabled(), syntheticAccountMayMint: keyMintApproved('__release_smoke_not_an_account__'), trustedKeysMode: trustedKeysEnforced() ? 'enforce' : 'warn', trustedDbKeyCount: trustedKeyIds().length };
  console.log('release policy:', JSON.stringify(policy));
  assert.equal(policy.selfRegisterEnabled, false, 'Self-registration must remain closed');
  assert.equal(policy.syntheticAccountMayMint, false, 'New key minting must require approval');

  const login = await call('/admin/auth/login', null, { email: process.env.OPS_STAFF_EMAIL, password: process.env.OPS_STAFF_PASSWORD });
  const j = login.json;
  const token = j?.accessToken || j?.access_token || j?.token || j?.data?.accessToken || j?.data?.access_token || j?.data?.token;
  assert.equal(login.status, 200, 'Staff login failed');
  assert.ok(token, 'Staff login returned no token');
  console.log('staff login: OK');

  const register = await call('/v1/portal/auth/register', null, { email: process.env.OPS_STAFF_EMAIL, password: 'release-smoke-invalid-password' });
  console.log('existing-account register probe:', register.status);
  assert.equal(register.status, 403, 'Registration gate is not closed');

  for (const path of ['/product-prices', '/product-prices/pending', '/product-masters/pending', '/order-periods']) {
    const paged = await call(path + '?page=1&limit=1', token);
    assert.equal(paged.status, 200, `Paged ${path}: HTTP ${paged.status}`);
    const data = paged.json;
    assert.ok(Array.isArray(data?.items), `Paged ${path} missing items`);
    assert.ok(Number.isInteger(data.total) && data.total >= 0, `Paged ${path} missing total`);
    assert.equal(data.page, 1); assert.equal(data.limit, 1);
    assert.ok(data.items.length <= 1 && data.items.length <= data.total);
    const legacy = await call(path, token);
    assert.equal(legacy.status, 200, `Legacy ${path}: HTTP ${legacy.status}`);
    assert.ok(Array.isArray(legacy.json), `Legacy ${path} must retain its array response`);
    console.log('queue contract:', JSON.stringify({ path, pagedStatus: paged.status, page: data.page, limit: data.limit, total: data.total, items: data.items.length, legacyStatus: legacy.status, legacyItems: legacy.json.length }));
  }
  const gps = await call('/winback/team-locations', token);
  assert.equal(gps.status, 200, `Team locations: HTTP ${gps.status}`);
  const locations = gps.json?.data ?? gps.json;
  assert.ok(Array.isArray(locations?.locations), 'Team locations shape is incompatible');
  console.log('team locations:', JSON.stringify({ status: gps.status, locations: locations.locations.length, repsWithoutLocation: locations.repsWithoutLocation?.length ?? null }));
  console.log('PASS: policies, staff login, closed registration, four paged/legacy queue contracts and team locations');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
