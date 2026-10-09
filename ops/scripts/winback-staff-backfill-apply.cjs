// Runs the app's own winback-staff backfill CLI (src/cli/winback-staff-backfill.js) — no hand-written SQL, no token minting.
// Pinned to the reviewed plan. SCRIPT_ARGS must be exactly 'apply links=2 rows=37'; anything else exits 2 before the CLI is spawned.
// 1) dry run. Exit 2 if its report has no numeric counts.links / counts.ambiguous / rowsChanged (a missing field never passes).
//    Already applied (links=0, rows=0, ambiguous=0) → exit 0 without --apply (idempotent rerun).
//    Anything other than exactly links=2 rows=37 ambiguous=0 → exit 1 without --apply.
// 2) --apply --expect-links=2 --expect-rows=37: the CLI refuses unless WINBACK_OWNER=commerce and COMMERCE_OWNS_SALES_REPS=true,
//    and re-checks 2/37/ambiguous=0 inside its own locked transaction; a drifted plan throws there and rolls back (nothing committed).
// 3) dry run again; must plan 0 links / 0 rows (a post-commit check only — it cannot undo step 2). Prints counts only.
const { spawnSync } = require("child_process");
const EXPECTED_ARGS = "apply links=2 rows=37";
const LINKS = 2;
const ROWS = 37;
if ((process.env.SCRIPT_ARGS || "").trim() !== EXPECTED_ARGS) {
  console.error(`SCRIPT_ARGS must be exactly '${EXPECTED_ARGS}' (the reviewed plan); refusing without running the backfill`);
  process.exit(2);
}
class Refused extends Error { constructor(message, code) { super(message); this.code = code; } }
const run = (apply) => {
  const args = ["src/cli/winback-staff-backfill.js", "--json", ...(apply ? ["--apply", `--expect-links=${LINKS}`, `--expect-rows=${ROWS}`] : [])];
  const r = spawnSync("node", args, { encoding: "utf8", timeout: 600000 });
  if (r.status !== 0) {
    process.stderr.write((r.stderr || "").split("\n").filter((l) => !/postgres:\/\/|password|secret|token/i.test(l)).join("\n").slice(0, 2000));
    throw new Error(`backfill ${apply ? "--apply" : "dry run"} exited ${r.status}`);
  }
  let rep;
  try { rep = JSON.parse((r.stdout || "").trim().split("\n").pop()); } catch { throw new Refused("backfill report is not JSON", 2); }
  const counts = (rep && rep.counts) || {};
  const changed = rep && rep.rowsChanged;
  const values = changed && typeof changed === "object" ? Object.values(changed) : null;
  if (!Number.isInteger(counts.links) || !Number.isInteger(counts.ambiguous) || !values || !values.every(Number.isInteger)) {
    throw new Refused("backfill report lacks counts.links / counts.ambiguous / rowsChanged; refusing", 2);
  }
  return { links: counts.links, ambiguous: counts.ambiguous, rows: values.reduce((a, b) => a + b, 0), rowsChanged: changed };
};
try {
  const before = run(false);
  console.log("dry run:", JSON.stringify(before));
  if (before.links === 0 && before.rows === 0 && before.ambiguous === 0) {
    console.log("already applied: dry run plans 0 links / 0 rows; --apply not run");
  } else {
    if (before.ambiguous !== 0) throw new Refused(`ambiguous=${before.ambiguous}; resolve before applying`, 1);
    if (before.links !== LINKS || before.rows !== ROWS) throw new Refused(`plan changed (links=${before.links} rows=${before.rows}, reviewed links=${LINKS} rows=${ROWS}); re-review the dry run`, 1);
    const applied = run(true);
    console.log("applied:", JSON.stringify(applied));
    if (applied.links !== LINKS || applied.rows !== ROWS) throw new Error(`apply report links=${applied.links} rows=${applied.rows} differs from the reviewed plan (already committed; investigate)`);
    const after = run(false);
    console.log("dry run after:", JSON.stringify(after));
    if (after.links !== 0 || after.rows !== 0) throw new Error("second dry run is not empty");
    console.log("OK — wait 60 s for identity caches (or restart platform) before reopening the app");
  }
} catch (e) { console.error(String((e && e.message) || e)); process.exitCode = e instanceof Refused ? e.code : 1; }
