// SCRIPT_ARGS: '<path> <json>' — signed POST to josh's internal API exactly as the platform does (postToJosh).
// Allowed paths: /internal/commerce/backfill, /internal/commerce/segments/counts.
// josh's origin cert expired 2026-09-24: if (and only if) the normal call fails with CERT_HAS_EXPIRED, retry once
// pinned to josh's private IP (172.31.40.34, compose extra_hosts) and accept the cert ONLY when its sole problem is
// CERT_HAS_EXPIRED and it is the joshapp.io certificate. Any other TLS problem aborts. Temporary until the renewal.
const https = require("https");
const crypto = require("crypto");
const PINNED_IP = "172.31.40.34";
function expiredOnlyPost(url, text) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      host: PINNED_IP, servername: u.hostname, port: 443, path: u.pathname, method: "POST", rejectUnauthorized: false, timeout: 900000,
      headers: { host: u.hostname, "content-type": "application/json", "content-length": Buffer.byteLength(text), "x-signature": crypto.createHmac("sha256", process.env.JOSH_EVENTS_SECRET.trim()).update(text).digest("hex") },
    }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode, body: b })); });
    req.on("socket", (s) => s.on("secureConnect", () => {
      const c = s.getPeerCertificate();
      const ok = s.authorizationError === "CERT_HAS_EXPIRED" && /DNS:joshapp\.io\b/.test(c.subjectaltname || "") && s.remoteAddress === PINNED_IP;
      if (!ok) req.destroy(new Error(`refusing TLS: ${s.authorizationError || "?"} ${c.subjectaltname || ""} ${s.remoteAddress}`));
    }));
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(text);
  });
}
(async () => {
  const a = (process.env.SCRIPT_ARGS || "").trim();
  const m = a.match(/^(\/\S+)\s+(\{.*\})$/s);
  if (!m) throw new Error("SCRIPT_ARGS must be: /path {json}");
  if (!["/internal/commerce/backfill", "/internal/commerce/segments/counts"].includes(m[1])) throw new Error(`path ${m[1]} not allowed`);
  const base = (process.env.JOSH_API_URL || "").trim().replace(/\/$/, "");
  console.log("JOSH_API_URL host:", base.replace(/^(https?:\/\/[^/]+).*$/, "$1"));
  const body = JSON.parse(m[2]);
  const { postToJosh } = require("./src/modules/integration/connector/josh/josh-api");
  const t0 = Date.now();
  try {
    const out = await postToJosh(m[1], body, 900000);
    console.log(`josh answered OK in ${Date.now() - t0} ms:`, JSON.stringify(out).slice(0, 3000));
  } catch (e) {
    const code = e && e.cause && e.cause.code;
    console.log(`normal call failed after ${Date.now() - t0} ms: ${(e && e.message) || e}${code ? ` (${code})` : ""}`);
    if (code !== "CERT_HAS_EXPIRED") { process.exitCode = 1; return; }
    const r = await expiredOnlyPost(`${base}${m[1]}`, JSON.stringify(body));
    console.log(`expired-cert pinned retry → HTTP ${r.status} in ${Date.now() - t0} ms: ${r.body.slice(0, 3000)}`);
    if (r.status >= 300) process.exitCode = 1;
  }
})().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
