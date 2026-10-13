// Read-only notification API contract check; output contains counts/shape, never records or tokens.
async function main() {
  const base = `http://127.0.0.1:${process.env.PORT || 3000}/api`;
  const login = await fetch(`${base}/admin/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.OPS_STAFF_EMAIL, password: process.env.OPS_STAFF_PASSWORD }),
  });
  const session = await login.json();
  if (!login.ok || !session.accessToken) throw new Error(`Staff login failed: HTTP ${login.status}`);
  const response = await fetch(`${base}/josh/admin-call`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ method: 'GET', path: '/admin/notifications', query: { limit: '20' } }),
  });
  const body = await response.json();
  const payload = body?.data;
  console.log(JSON.stringify({
    check: 'Notifications without userId', status: response.status,
    responseKeys: Object.keys(body ?? {}), payloadKeys: Object.keys(payload ?? {}),
    itemCount: Array.isArray(payload?.items) ? payload.items.length : null,
    hasNextCursor: !!payload?.nextCursor,
    error: response.ok ? null : String(body?.error?.message ?? body?.message ?? 'Read failed').slice(0, 500),
  }, null, 2));
  if (!response.ok || !Array.isArray(payload?.items)) throw new Error('Default notification feed contract is unavailable; stop before deploying the UI.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
