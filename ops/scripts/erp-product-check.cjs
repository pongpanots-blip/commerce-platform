// SCRIPT_ARGS: "<check-code> <sku,sku,...>" — looks the SKUs up in the ERP node API and upserts product_erp_checks
// (src/cli/erp-product-check). Writes only that table; prints a count per verdict.
const { spawnSync } = require("child_process");
const [code, ...rest] = (process.env.SCRIPT_ARGS || "").trim().split(/\s+/);
if (!code || !rest.length) { console.error('SCRIPT_ARGS: "<check-code> <sku,sku,...>"'); process.exit(1); }
const r = spawnSync("node", ["src/cli/erp-product-check.js", code, "-"], { input: rest.join(","), encoding: "utf8", timeout: 900000 });
process.stdout.write((r.stdout || "").slice(0, 30000));
if (r.stderr) process.stderr.write(r.stderr.split("\n").filter((l) => !/postgres:\/\/|password|secret|token/i.test(l)).join("\n").slice(0, 3000));
process.exitCode = r.status === 0 ? 0 : 1;
