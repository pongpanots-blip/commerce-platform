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
- **S5-4, products report: blocked, documented and not built.** josh's `catalog.snapshot` has no category id/path,
  original price, sup_code, quantity, low-stock, MOQ, order-taking flag, ERP-pending, or image list. A copies mode
  without them would show wrong issue tiles. The list of fields to add moves to the S5-11 josh batch (plan, Task S5-4).
- **S5-10, staff-prices create by SKU:** works without the replica. The SKU/id lookup reads `josh_catalog_products`
  and falls back to the replica only when it is configured and the copy has no row. Spec: 12 passing.
- **S5-5, sales report:** `JoshInsights.sales()` has a new switch `SALES_SOURCE`.
  - `replica` (default, unchanged) · `copies` (`josh_orders.paid`, `josh_order_lines`, catalog copy names, commerce
    `customer_metrics`; works without the replica). Covers `/reports/sales`, MCP `shop_sales`, and growth's sales numbers.
  - Refunds show n/a in copies mode until `order_refunds` is copied (S5-11).
  - New `GET /reports/sales/parity` returns both answers side by side, with the totals that differ and the
    top-products ranking diff.
  - Specs: josh-insights (2 files) and the growth specs, 27 passing; `tsc` clean.
- **S5-8, order target group: blocked and reclassified.** josh's view isn't built from orders. It reads an xlsx
  staging import, `order_taking_flag`, and `sku_order_period` (a josh cron reading the ERP calendar). Commerce has
  none of these. Options are in plan Task S5-8 / §4 q5 for the owner. No snapshot group was invented.
- **S5-9, health:** without the replica, the josh panel now shows ERP-send failures from `jagota_order_sync_history`,
  including how fresh that copy is, and points to josh-admin for josh-only checks. With the replica, nothing changes.
  Spec: 2 passing.
- **S5-6, growth:** new switch `GROWTH_SOURCE`, `replica` (default) · `copies`.
  - Workspace: sales come from the order copies, reorder-due from commerce's `winback_account`.
  - Timeline: `josh_companies` + `josh_orders` + commerce `winback_*`.
  - Carts, devices and marketing workflows have no copy, so the page says "ยังไม่มีสำเนาใน commerce" and
    availability is partial. Workflow results still need the replica (S5-12).
  - Readiness chip shows "สำเนาใน commerce". Specs: 38 passing; `tsc` clean for both apps.
- **S5-7, orders report:** new switch `ORDERS_SOURCE`, `replica` (default) · `copies`.
  - Copies read `josh_orders` (`paid`), `josh_companies`, `jagota_order_sync_history` and `josh_order_lines`.
  - Not copied yet, so null and listed in `notCopied`: branch, payment rows, shipments, ERP codes.
  - Spec: 8 passing.
- **S5-14, josh-only pages explain themselves:** `joshOnly(why)` in `system-health.ts` replaces the bare replica
  503 at every remaining replica gate. Each page now says, in Thai, whether it is in josh-admin, a cutover tool, or not
  copied yet. Pages already show the backend message, so no frontend change was needed. Spec: 3 passing.
- **Customers report: deferred.** It is mostly KYC, credit and branch data. It waits on open question 1 and the
  S5-11 company/branch snapshots.

## Not done / not verified
- The copy SQL has not been run against a real DB yet; only unit tests with a mocked `query`.
  First check: `BESTSELLERS_SOURCE=shadow` on staging or prod after the order backfill.
- Full commerce suite not run (single spec only).
- No josh changes yet. The first one is needed at S5-11; S5-4 (products) waits for it too.

## Next (safe, commerce-only, in order)
1. S5-11 (josh, needs the josh branch `feat/commerce-copies-for-reports`): the `catalog.snapshot` fields from S5-4,
   `branch.snapshot`, payments / shipments / refunds / `sending_date` on `order.snapshot`, `jagota_sync`.
2. S5-12 josh snapshots: `push_campaign`, `marketing_workflow`.
3. S5-16 staging click-through with `JOSH_DATABASE_URL` unset (needs an environment).

## Open questions for the owner (plan §4)
KYC / credit data in commerce or josh-admin only? Traffic analytics: copy daily aggregates, or drop?
Back-office views stay in josh-admin? One global `REPORTS_SOURCE`, or one switch per reader?
Order target group (S5-8): copy josh's inputs, move them to commerce, or keep it in josh-admin?

## Cutover for S5-5 (ops)
Prerequisite: the order backfill is done. Check `GET /reports/sales/parity?period=last_month` and `?period=this_month`:
`differs` should be empty (or explained), and `topProducts.firstDiffRank` should be null or > 20. Then set
`SALES_SOURCE=copies`. Rollback: `replica`.

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
