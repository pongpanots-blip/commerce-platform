# Status — Stage 5: data jobs read commerce copies (branch `feat/stage5-data-jobs`)

Updated 2026-10-07. Not pushed.

## Done
- **Inventory + plan:** `docs/superpowers/plans/2026-10-08-stage5-data-jobs.md`.
  - 26 replica readers, each classified: re-point to an existing copy (no josh change), needs a new josh
    snapshot group, or retire / explain (copiers, cutover checkers, pages that belong to another stage).
  - Every commerce-admin page that shows the replica 503 is mapped to its slice.
  - The import / parity CLIs keep `JOSH_DATABASE_URL` on purpose (manual cutover tools; removed in stage 7).
- **S5-1, bestsellers offload on copies:** `bestsellers-offload.job.ts`.
  - New switch `BESTSELLERS_SOURCE`: `replica` (default, unchanged) · `shadow` (pushes the replica's list and logs a
    ranking diff against the copies) · `copies` (`josh_orders` / `josh_order_lines`; works without the replica).
  - Spec has 6 tests, all passing (`--runInBand`). `tsc --noEmit` on commerce-platform is clean.
- `.env.example`: added `BESTSELLERS_SOURCE`, and updated the out-of-date list of what still reads `JOSH_DATABASE_URL`.
- **S5-2, winback manager reports:** `integration/winback/winback-reports.ts` + `winback-reports.controller.ts`.
  - The admin page can't call `/winback/*` directly (those routes take josh's token for the sales app), so
    `/reports/winback/*` keeps its paths and envelope and gets a new switch `WINBACK_REPORTS_SOURCE`:
    `replica` (default, unchanged) · `copies` (commerce's own winback services and tables; works without the replica).
  - MCP `winback_*` tools use the same reader. Page text no longer says "replica".
  - No shadow mode: `WinbackMirror` already compares the six tables row by row while josh owns winback.
  - Spec has 3 tests, passing; `mcp.restaurant-tools.spec` still passes; `tsc --noEmit` clean.
  - Deleting `connector/josh/winback/*` is left for stage 7 (the replica path still uses it).
- **S5-3, Market Explorer (restaurants report):** `connector/josh/restaurant-places.ts`.
  - New switch `RESTAURANTS_SOURCE`: `replica` (default, unchanged) · `copies` (`josh_restaurant_places` and commerce's
    own `winback_account`; works without the replica). The MCP tool follows it.
  - New `GET /reports/restaurants/parity` shows both sides' counts. `linked_to_winback` is expected to differ,
    because josh's `winback_account` has been stale since 2b.
  - Specs: 7 + MCP restaurant spec passing; `tsc` clean. No scratch-DB spec (documented in the plan).

## Not done / not verified
- The copy SQL has not been run against a real DB yet; only unit tests with a mocked `query`.
  First check: `BESTSELLERS_SOURCE=shadow` on staging or prod after the order backfill.
- Full commerce suite not run (single spec only).
- No josh changes yet. The first one is needed at S5-11.

## Next (safe, commerce-only, in order)
1. S5-4 products report → `josh_catalog_products` + owned `product_*` tables.
2. S5-5 sales report → `josh_orders` / `josh_order_lines` (parity endpoint first).

## Open questions for the owner (plan §4)
KYC / credit data in commerce or josh-admin only? Traffic analytics: copy daily aggregates, or drop?
Back-office views stay in josh-admin? One global `REPORTS_SOURCE`, or one switch per reader?

## Cutover for S5-3 (ops)
Prerequisite: the `restaurant_place` backfill is done (stage 2c runbook). Check `GET /reports/restaurants/parity`:
`total` and `enriched` should be equal. Then set `RESTAURANTS_SOURCE=copies`. Rollback: `replica`.

## Cutover for S5-2 (ops)
Prerequisite: commerce's winback tables are current (`CRON_WINBACK_MIRROR_ENABLED=true`, or `WINBACK_OWNER=commerce`).
Compare `/reports/winback/overview` before/after, then set `WINBACK_REPORTS_SOURCE=copies`. Rollback: `replica`.

## Cutover for S5-1 (ops)
1. Prerequisite: order backfill is done (`docs/runbooks/prod-data-from-josh.md`, rows 0–1).
2. Set `CRON_JOSH_BESTSELLERS_ENABLED=true` and `BESTSELLERS_SOURCE=shadow`.
3. Watch the `bestsellers shadow (copies vs replica)` log for about a week. `firstDiffRank` should be null or ≥ 50
   (josh shows at most 50).
4. Set `BESTSELLERS_SOURCE=copies`. Rollback: set it back to `replica`.
