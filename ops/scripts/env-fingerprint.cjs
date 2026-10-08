// SCRIPT_ARGS: 'NAME …' (allowlisted) — sha256 fingerprint (first 12 hex) + length of each env value in the platform
// container, to compare a secret with josh's copy (josh: Webjosh ops-winback-2b.yml action=fingerprints) without
// printing it. Never prints a value.
const crypto = require("crypto");
const ALLOWED = new Set(["JOSH_JWT_SECRET", "WINBACK_INTAKE_KEY", "JOSH_EVENTS_SECRET"]);
const names = (process.env.SCRIPT_ARGS || "").trim().split(/\s+/).filter(Boolean);
if (!names.length || names.some((n) => !ALLOWED.has(n))) { console.error(`SCRIPT_ARGS must be some of: ${[...ALLOWED].join(" ")}`); process.exit(1); }
const out = {};
for (const n of names) {
  const v = process.env[n] || "";
  out[n] = v ? { set: true, len: v.length, sha256_12: crypto.createHash("sha256").update(v).digest("hex").slice(0, 12) } : { set: false };
}
console.log("env fingerprints:", JSON.stringify(out));
