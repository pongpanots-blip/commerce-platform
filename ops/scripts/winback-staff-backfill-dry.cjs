// Read-only: runs the winback-staff backfill in DRY-RUN mode only (never --apply; SCRIPT_ARGS ignored).
// The CLI uses a READ ONLY repeatable-read transaction and prints ids/counts only (no emails, no driver errors).
const { spawnSync } = require("child_process");
const r = spawnSync("node", ["src/cli/winback-staff-backfill.js", "--json"], { encoding: "utf8", timeout: 300000 });
process.stdout.write((r.stdout || "").slice(0, 30000));
if (r.stderr) process.stderr.write(r.stderr.split("\n").filter((l) => !/postgres:\/\/|password|secret|token/i.test(l)).join("\n").slice(0, 3000));
process.exitCode = r.status === 0 ? 0 : 1;
