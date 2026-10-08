// Runs the app's own winback-staff backfill CLI (src/cli/winback-staff-backfill.js) — no hand-written SQL, no token minting.
// SCRIPT_ARGS must be exactly: 'apply links=<n> rows=<m>' (the numbers from the reviewed dry run, e.g. 'apply links=2 rows=37').
// 1) dry run; refuses unless the planned new links / total rows equal the expected numbers
// 2) --apply (the CLI itself refuses unless WINBACK_OWNER=commerce and COMMERCE_OWNS_SALES_REPS=true; one locked transaction, rolls back on conflict)
// 3) dry run again; must plan 0 links / 0 rows. Prints counts only (no emails, no driver errors).
const { spawnSync } = require("child_process");
const m = /^apply links=(\d+) rows=(\d+)$/.exec((process.env.SCRIPT_ARGS || "").trim());
if (!m) { console.error("SCRIPT_ARGS must be 'apply links=<n> rows=<m>' from the reviewed dry run"); process.exit(2); }
const want = { links: Number(m[1]), rows: Number(m[2]) };
const run = (apply) => {
  const r = spawnSync("node", ["src/cli/winback-staff-backfill.js", "--json", ...(apply ? ["--apply"] : [])], { encoding: "utf8", timeout: 600000 });
  if (r.status !== 0) {
    process.stderr.write((r.stderr || "").split("\n").filter((l) => !/postgres:\/\/|password|secret|token/i.test(l)).join("\n").slice(0, 2000));
    throw new Error(`backfill ${apply ? "--apply" : "dry run"} exited ${r.status}`);
  }
  const rep = JSON.parse((r.stdout || "").trim().split("\n").pop());
  const rows = Object.values(rep.rowsChanged || {}).reduce((a, b) => a + b, 0);
  return { counts: rep.counts, rowsChanged: rep.rowsChanged, rows };
};
try {
  const before = run(false);
  console.log("dry run:", JSON.stringify(before));
  if (before.counts.links !== want.links || before.rows !== want.rows) throw new Error(`plan changed (links=${before.counts.links} rows=${before.rows}, expected links=${want.links} rows=${want.rows}); re-review the dry run`);
  if (before.counts.ambiguous) throw new Error(`ambiguous=${before.counts.ambiguous}; resolve before applying`);
  const applied = run(true);
  console.log("applied:", JSON.stringify(applied));
  const after = run(false);
  console.log("dry run after:", JSON.stringify(after));
  if (after.counts.links !== 0 || after.rows !== 0) throw new Error("second dry run is not empty");
  console.log("OK — wait 60 s for identity caches (or restart platform) before reopening the app");
} catch (e) { console.error(String((e && e.message) || e)); process.exitCode = 1; }
