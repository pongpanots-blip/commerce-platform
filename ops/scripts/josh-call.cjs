// SCRIPT_ARGS: '<path> <json>' — signed POST to josh's internal API exactly as the platform does (postToJosh),
// printing josh's answer or error. Allowed paths: /internal/commerce/backfill, /internal/commerce/segments/counts.
(async () => {
  const a = (process.env.SCRIPT_ARGS || "").trim();
  const m = a.match(/^(\/\S+)\s+(\{.*\})$/s);
  if (!m) throw new Error("SCRIPT_ARGS must be: /path {json}");
  if (!["/internal/commerce/backfill", "/internal/commerce/segments/counts"].includes(m[1])) throw new Error(`path ${m[1]} not allowed`);
  const base = (process.env.JOSH_API_URL || "").trim();
  console.log("JOSH_API_URL host:", base.replace(/\/\/[^@/]*@/, "//").replace(/^(https?:\/\/[^/]+).*$/, "$1"));
  const { postToJosh } = require("./src/modules/integration/connector/josh/josh-api");
  const t0 = Date.now();
  try {
    const out = await postToJosh(m[1], JSON.parse(m[2]), 900000);
    console.log(`josh answered OK in ${Date.now() - t0} ms:`, JSON.stringify(out).slice(0, 3000));
  } catch (e) {
    console.log(`josh call FAILED after ${Date.now() - t0} ms:`, String((e && (e.cause && e.cause.code ? `${e.message} (${e.cause.code})` : e.message)) || e).slice(0, 600));
    process.exitCode = 1;
  }
})().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
