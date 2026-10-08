// stage 2a test: commerce segment create → josh (same id, member_count) → delete → gone in josh
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}/api`;
async function login() {
  const r = await fetch(`${BASE}/admin/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.OPS_STAFF_EMAIL, password: process.env.OPS_STAFF_PASSWORD }) });
  const j = await r.json().catch(() => ({}));
  const token = j.accessToken || j.access_token || j.token || (j.data && (j.data.accessToken || j.data.access_token || j.data.token));
  if (!r.ok || !token) throw new Error(`staff login failed: HTTP ${r.status} keys=${Object.keys(j.data || j).join(",")}`);
  return token;
}
async function api(token, method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text.slice(0, 2000); }
  return { status: r.status, json };
}
async function josh(sql, params) {
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.env.JOSH_DATABASE_URL, options: "-c default_transaction_read_only=on -c statement_timeout=120000" });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const token = await login();
  const own = await fetch(`${BASE}/ownership`).then((r) => r.json()).catch(() => null);
  console.log("ownership:", JSON.stringify(own));
  const slug = `ops-cutover-test-${Date.now()}`;
  const created = await api(token, "POST", "/user-segments", { slug, name: "[ops test] cutover 2a — auto-deleted", description: "created + deleted by ops cutover test", rule_type: "min_order_count", rule_config: { min: 50 }, is_active: false });
  console.log("create:", created.status, JSON.stringify(created.json && created.json.data ? { id: created.json.data.id, member_count: created.json.data.member_count, frozen_at: created.json.data.frozen_at } : created.json));
  if (created.status >= 300) { process.exitCode = 1; return; }
  const seg = created.json.data;
  let row = null; const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    row = (await josh("SELECT s.id, s.slug, s.member_count, s.frozen_at, s.is_active, (SELECT count(*)::int FROM segment_membership_snapshots m WHERE m.segment_id = s.id) AS snapshot_rows FROM user_segments s WHERE s.id = $1", [seg.id]))[0];
    if (row && row.frozen_at && Number(row.snapshot_rows) >= Number(seg.member_count || 0)) break; await sleep(5000);
  }
  const snaps = row ? row.snapshot_rows : null;
  const ok1 = !!row && Number(row.member_count) === Number(seg.member_count);
  console.log("josh after create:", JSON.stringify({ found: !!row, row, snapshotRows: snaps, commerceMemberCount: seg.member_count, seconds: Math.round((Date.now() - t0) / 1000), ok: ok1 }));
  const del = await api(token, "DELETE", `/user-segments/${seg.id}`);
  console.log("delete:", del.status);
  let gone = false; const t1 = Date.now();
  while (Date.now() - t1 < 180000) {
    const r = (await josh("SELECT id FROM user_segments WHERE id = $1", [seg.id]))[0];
    if (!r) { gone = true; console.log("josh after delete:", JSON.stringify(r || "row removed")); break; }
    await sleep(5000);
  }
  console.log(`RESULT: create→josh ${ok1 ? "OK" : "FAIL"} · delete→josh ${gone ? "OK" : "FAIL"}`);
  if (!ok1 || !gone || del.status >= 300) process.exitCode = 1;
})().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
