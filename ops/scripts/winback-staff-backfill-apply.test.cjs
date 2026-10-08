// node --test ops/scripts/winback-staff-backfill-apply.test.cjs
// Runs the wrapper exactly like ops-platform.yml does (`node - < script`, cwd = app root) against a fake
// src/cli/winback-staff-backfill.js that replays canned reports and records every invocation.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const WRAPPER = path.join(__dirname, "winback-staff-backfill-apply.cjs");
const FAKE_CLI = `
const fs = require("fs");
const state = JSON.parse(fs.readFileSync("state.json", "utf8"));
const args = process.argv.slice(2);
state.calls.push(args);
const next = state.reports.shift();
fs.writeFileSync("state.json", JSON.stringify(state));
if (next === undefined) { console.error("no canned report"); process.exit(9); }
if (next.exit) { console.error("refused"); process.exit(next.exit); }
console.log(JSON.stringify(next));
`;
const plan = (links, rows, ambiguous = 0) => ({ mode: "dry-run", counts: { matched: links, unmatched: 0, ambiguous, ineligible: 0, links }, rowsChanged: { winback_activity: rows } });

function runWrapper(scriptArgs, reports) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-apply-"));
  fs.mkdirSync(path.join(dir, "src/cli"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/cli/winback-staff-backfill.js"), FAKE_CLI);
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ calls: [], reports }));
  const env = { ...process.env };
  if (scriptArgs === undefined) delete env.SCRIPT_ARGS; else env.SCRIPT_ARGS = scriptArgs;
  const r = spawnSync("node", ["-"], { cwd: dir, env, input: fs.readFileSync(WRAPPER), encoding: "utf8" });
  const { calls } = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: r.stdout, err: r.stderr, calls, applied: calls.some((a) => a.includes("--apply")) };
}

for (const args of [undefined, "", "apply", "apply links=9 rows=9", "apply links=0 rows=0", "apply links=2 rows=36", "apply links=02 rows=37", "apply links=2 rows=37 --force", "apply  links=2 rows=37"]) {
  test(`SCRIPT_ARGS=${JSON.stringify(args)} exits 2 before the CLI is spawned`, () => {
    // Even with a live plan that matches the (unreviewed) numbers, nothing runs.
    const r = runWrapper(args, [plan(9, 9), plan(9, 9), plan(0, 0)]);
    assert.strictEqual(r.status, 2);
    assert.deepStrictEqual(r.calls, []);
  });
}

test("reviewed plan 2/37: dry run, --apply with the pinned expectation, empty dry run, exit 0", () => {
  const r = runWrapper("apply links=2 rows=37", [plan(2, 37), { ...plan(2, 37), mode: "apply" }, plan(0, 0)]);
  assert.strictEqual(r.status, 0, r.err);
  assert.deepStrictEqual(r.calls, [["--json"], ["--json", "--apply", "--expect-links=2", "--expect-rows=37"], ["--json"]]);
});

test("rerun after a committed apply (dry run 0/0, not ambiguous) exits 0 without --apply", () => {
  const r = runWrapper("apply links=2 rows=37", [plan(0, 0)]);
  assert.strictEqual(r.status, 0, r.err);
  assert.deepStrictEqual(r.calls, [["--json"]]);
  assert.match(r.out, /already applied/);
});

for (const [name, report] of [
  ["9/9", plan(9, 9)], ["2/36", plan(2, 36)], ["0 links / 37 rows", plan(0, 37)], ["2 links / 0 rows", plan(2, 0)],
  ["2/37 ambiguous=1", plan(2, 37, 1)], ["0/0 ambiguous=1", plan(0, 0, 1)],
]) {
  test(`live plan ${name} refuses (exit 1) without --apply`, () => {
    const r = runWrapper("apply links=2 rows=37", [report, plan(0, 0)]);
    assert.strictEqual(r.status, 1);
    assert.strictEqual(r.applied, false);
  });
}

for (const [name, report] of [
  ["no ambiguous field", { counts: { links: 2 }, rowsChanged: { winback_activity: 37 } }],
  ["no ambiguous field and an empty plan", { counts: { links: 0 }, rowsChanged: {} }],
  ["ambiguous: null", { counts: { links: 2, ambiguous: null }, rowsChanged: { winback_activity: 37 } }],
  ["no rowsChanged", { counts: { links: 2, ambiguous: 0 } }],
  ["no counts", { rowsChanged: { winback_activity: 37 } }],
]) {
  test(`dry-run report with ${name} exits 2 without --apply`, () => {
    const r = runWrapper("apply links=2 rows=37", [report, plan(0, 0)]);
    assert.strictEqual(r.status, 2);
    assert.strictEqual(r.applied, false);
  });
}

test("CLI refusing inside its transaction (plan drifted) fails the wrapper and skips the post-apply dry run", () => {
  const r = runWrapper("apply links=2 rows=37", [plan(2, 37), { exit: 1 }, plan(0, 0)]);
  assert.strictEqual(r.status, 1);
  assert.strictEqual(r.calls.length, 2);
});

test("a non-empty dry run after apply fails", () => {
  const r = runWrapper("apply links=2 rows=37", [plan(2, 37), { ...plan(2, 37), mode: "apply" }, plan(0, 1)]);
  assert.strictEqual(r.status, 1);
});
