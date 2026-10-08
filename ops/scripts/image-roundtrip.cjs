// Stage 4e smoke: commerce gallery upload → josh product_media → restore the original gallery → josh restored.
// SCRIPT_ARGS: 'sku=<SKU>' or empty = auto-pick a josh DRAFT product (not sold) with ≤ 2 images that commerce knows.
// Uploads one 1×1 PNG to S3 (josh bucket via putMediaObject), checks the public URL answers 200, then puts the
// original gallery back. The uploaded file stays in the bucket (harmless, unreferenced). Prints no secret.
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function login() {
  const r = await fetch(`${BASE}/admin/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.OPS_STAFF_EMAIL, password: process.env.OPS_STAFF_PASSWORD }) });
  const j = await r.json().catch(() => ({}));
  const token = j.accessToken || j.access_token || j.token || (j.data && (j.data.accessToken || j.data.access_token || j.data.token));
  if (!r.ok || !token) throw new Error(`staff login failed: HTTP ${r.status}`);
  return token;
}
async function api(token, method, path, body, form) {
  const headers = { authorization: `Bearer ${token}` };
  if (!form) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${path}`, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text.slice(0, 500); }
  return { status: r.status, json };
}
async function josh(sql, params) {
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.env.JOSH_DATABASE_URL, options: "-c default_transaction_read_only=on -c statement_timeout=60000" });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}
const joshGallery = async (sku) => (await josh(`SELECT COALESCE((SELECT jsonb_agg(m.source ORDER BY m.sort_order, m.created_at) FROM product_media m
  WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type::text = 'image'), '[]'::jsonb) AS images, p.product_status::text AS status
  FROM product_inventory p WHERE p.product_inventory_sku = $1`, [sku]))[0];
const galleryOf = (res) => (res.json && (res.json.images || (res.json.data && res.json.data.images))) || null;
const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
async function waitJosh(sku, want, label) {
  const t0 = Date.now(); let g;
  while (Date.now() - t0 < 180000) { g = await joshGallery(sku); if (g && same(g.images, want)) break; await sleep(4000); }
  const ok = !!g && same(g.images, want);
  console.log(`josh ${label}:`, JSON.stringify({ ok, seconds: Math.round((Date.now() - t0) / 1000), josh: g && g.images, want }));
  return ok;
}
(async () => {
  if (process.env.COMMERCE_OWNS_PRODUCT_IMAGES !== "true") throw new Error("COMMERCE_OWNS_PRODUCT_IMAGES is not true in this container");
  const arg = Object.fromEntries((process.env.SCRIPT_ARGS || "").trim().split(/\s+/).filter(Boolean).map((p) => p.split("=")));
  let sku = arg.sku;
  if (!sku) {
    const rows = await josh(`SELECT p.product_inventory_sku AS sku FROM product_inventory p
      WHERE p.product_status::text = 'draft' AND (SELECT count(*) FROM product_media m WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type::text = 'image') <= 2
      ORDER BY p.product_inventory_sku LIMIT 50`);
    const { AppDataSource } = (() => { require("reflect-metadata"); return require("./src/data-source"); })();
    const db = await AppDataSource.initialize();
    try {
      for (const r of rows) {
        const [k] = await db.query(`SELECT 1 FROM product_images WHERE product_inventory_sku = $1 UNION ALL SELECT 1 FROM josh_catalog_products WHERE sku = $1 AND removed_at IS NULL LIMIT 1`, [r.sku]);
        if (k) { sku = r.sku; break; }
      }
    } finally { await db.destroy(); }
    if (!sku) throw new Error("no josh draft SKU with ≤ 2 images known to commerce — pass sku=<SKU>");
  }
  const before = await joshGallery(sku);
  if (!before) throw new Error(`josh has no product ${sku}`);
  if (before.status !== "draft" && arg.allow_live !== "1") throw new Error(`${sku} is ${before.status} in josh — refusing a live product (allow_live=1 to override)`);
  const token = await login();
  const cur = await api(token, "GET", `/product-images/${encodeURIComponent(sku)}`);
  const original = galleryOf(cur) || before.images;
  console.log("sku:", sku, "josh status:", before.status, "original gallery:", JSON.stringify(original), "commerce GET:", cur.status);
  if (original.length >= 3) throw new Error("gallery already full (3)");
  // 1×1 transparent PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  const form = new FormData();
  form.append("images", new Blob([png], { type: "image/png" }), "ops-smoke.png");
  const up = await api(token, "POST", `/product-images/${encodeURIComponent(sku)}/upload`, undefined, form);
  const after = galleryOf(up);
  console.log("upload:", up.status, JSON.stringify(after || up.json));
  if (up.status >= 300 || !after) { process.exitCode = 1; return; }
  const added = after.filter((u) => !original.includes(u));
  let publicOk = null;
  if (added[0]) { const h = await fetch(added[0], { method: "GET" }).catch((e) => ({ status: `ERR ${e.message}` })); publicOk = h.status; }
  console.log("new file:", JSON.stringify({ url: added[0], publicStatus: publicOk }));
  const ok1 = await waitJosh(sku, after, "after upload");
  const back = await api(token, "PUT", `/product-images/${encodeURIComponent(sku)}`, { images: original });
  console.log("restore:", back.status, JSON.stringify(galleryOf(back) || back.json));
  const ok2 = await waitJosh(sku, original, "after restore");
  const ok = ok1 && ok2 && back.status < 300 && publicOk === 200;
  console.log("RESULT:", ok ? "PASS" : "FAIL");
  if (!ok) process.exitCode = 1;
})().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
