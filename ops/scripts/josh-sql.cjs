// SCRIPT_ARGS: one SELECT / WITH query, run read-only on josh
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
  const sql = (process.env.SCRIPT_ARGS || "").trim();
  if (!/^(select|with)\b/i.test(sql)) throw new Error("only SELECT / WITH");
  const rows = await josh(sql);
  console.log(JSON.stringify(rows, null, 1).slice(0, 30000));
})().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
