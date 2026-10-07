# Stage 7 — cleanup: retire josh's replica + cutover tools · STATUS

Worktree `/workspace/commerce-s7` · branch `feat/stage7-cleanup` (from master `a1730cd`) · not pushed, no PR.
Plan: `docs/superpowers/plans/2026-10-09-stage7-cleanup.md` · runbook: `docs/runbooks/stage7-replica-removal.md`

## Done (commits on this branch)

| Commit | What |
|---|---|
| `183a07e` | Plan. Inventory of every `JOSH_DATABASE_URL` / `JoshReplica` / cutover-CLI user on this branch, plus what S5/G5 will add. Each item is classed A (report reader) / B (copier, shadow) / C (cutover CLI) / W (wiring) / K (keep), with the gate from the earlier stage's own docs. |
| `854e82b` | `apps/commerce-platform/src/replica-readers.spec.ts`: guard. No new file may import `JoshReplica` or read `JOSH_DATABASE_URL`; each listed file carries its class and gate. It is a subset check, so deletions pass. It already lists the S5 (`winback-reports*`) and G5 (`ordering-parity`) files, so those merges pass. Checked against all four sibling trees: ok. |
| `f82c93c` | Runbook: gates per group, which crons to turn off (env only), a rehearsal without the URL, and the order of deletes. |
| (last) | This file. |

**Nothing was removed or retired in code.** No B/C/W item has its gate met as far as the repo knows: no runbook or
STATUS records a prod cutover, and the parity CLIs + imports are the documented post-switch check and rollback aid.
Class A has no `copies` path on this branch until S5 is merged. Deleting any of them now would break a page or a
pending cutover.

## Waits on merging S4–S6 into master

- S5 (`feat/stage5-data-jobs`): the `*_SOURCE` switches and `joshOnly` texts. Without them, removing the replica empties
  ~15 commerce-admin pages and MCP tools. Take S5's `.env.example` text at merge.
- G5 (`feat/stage4-g5-ordering-logistics`) adds `ordering-parity` + `import-from-josh -- ordering` (class C).
  G9 and S6 add no replica readers.
- After the merges: rebase, re-run the inventory grep (runbook §0) and the guard spec (plan S7-3).

## Waits on ops (shadow weeks / cutovers) — runbook §1–3

- **First: check whether prod has `JOSH_DATABASE_URL` set** (the stage 1 plan says no, S5 assumes yes; plan §3 q1).
- Every gate in runbook §1: 4a–4g flags on for ≥ 1 week with parity 0, `WINBACK_OWNER=commerce`, ERP gateway through
  commerce, S5 switches 1–9 on `copies` for a week.
- Crons off by env (runbook §2). `CRON_JOSH_CATALOG_SYNC_ENABLED` **defaults on**, so ops must set it `false`. Don't
  flip the default in code before that.
- Rehearsal: staging, then prod, without the URL for a week (S5-16).
- At the end: `DROP ROLE commerce_ro` on josh Postgres and close 5432. Keep the Mongo user, because `JOSH_MONGO_URL` is
  not stage 7.

## Waits on the owner

S5 §4 q1–q5 (KYC/credit, traffic, back-office, one switch, order target group) decide what happens to the class-A
pages with no copy. The rollback window after the last group before the imports are deleted is undecided (plan §3 q3,
suggested 2 weeks).

## Not stage 7 (keep)

`josh-events` receiver + `josh_*` copies, `order-copy/backfill`, relay / `JOSH_API_URL`, `JOSH_MONGO_URL` readers,
everything staff (S6), `competitor-parity` / `segment-parity` (no replica).

## How to verify

**Verify:**
```bash
cd /workspace/commerce-s7   # node_modules is a symlink to commerce-g5's (as commerce-s5/s6 do)
npx jest -c apps/commerce-platform/jest.config.cts --runInBand apps/commerce-platform/src/replica-readers.spec.ts
# → 2 passed. Negative check done: a temp file importing JoshReplica fails the first test.
```
Not run: the full suite or `tsc` (no runtime code changed; the spec is compiled by ts-jest).

## Final summary

**Coding is paused at the right point and ready to hand off.** Everything that can be done safely before the S4–S6
merges and the ops gates is done: the inventory/plan, the guard, the runbook. The remaining stage-7 tasks (S7-3 … S7-8)
are deletions. Each one is unblocked by a merge or an ops/owner fact listed above, not by more coding now. Next step:
merge S4f/S4g/S5/S6, then S7-3. After that, delete one class at a time as ops confirms each gate.

## Update (merge day)
G5, G9, S5, and S6 are now on `master`. Hard deletes still wait on ops gates in the runbook; this branch itself is mergeable.
