# Status — Stage 5: data jobs read commerce copies (branch `feat/stage5-data-jobs`)

Updated 2026-10-07. Not pushed. **Stage 5 coding is done**: every reader has a copies mode or explains itself, S5-11 and
S5-12 (josh snapshot groups + commerce copies) are done, and the readers use the S5-11 / S5-12 copies. What remains is
ops (real-DB migration check, deploy + backfill, flip switches, staging click-through) and owner decisions — see
"Final summary" at the end.

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
- **S5-4, products report (after S5-11):** new switch `PRODUCTS_SOURCE`, `replica` (default) · `copies`.
  - Copies read `josh_catalog_products` with the S5-11 fields (removed products left out). Where commerce owns a part,
    its table wins: `product_prices`, the approval queues `product_price_pending` / `product_master_pending` (josh never
    sees those), `product_images`, `product_contents`, `product_categories`. MCP `josh_products` follows.
  - `summary.missing_report_fields` = copied rows not yet re-sent with the S5-11 fields; switch only at 0.
  - Detail lists `notCopied`: josh's `erp_pending_payload`, its full media list and content fields when commerce does
    not own them. Spec +4.
- **S5-10, staff-prices create by SKU:** works without the replica. The SKU/id lookup reads `josh_catalog_products`
  and falls back to the replica only when it is configured and the copy has no row. Spec: 12 passing.
- **S5-5, sales report:** `JoshInsights.sales()` has a new switch `SALES_SOURCE`.
  - `replica` (default, unchanged) · `copies` (`josh_orders.paid`, `josh_order_lines`, catalog copy names, commerce
    `customer_metrics`; works without the replica). Covers `/reports/sales`, MCP `shop_sales`, and growth's sales numbers.
  - Refunds come from `josh_order_refunds` (S5-11; `status = 'refunded'`, `created_at` range). Parity compares them.
  - New `GET /reports/sales/parity` returns both answers side by side, with the totals that differ and the
    top-products ranking diff.
  - Specs: josh-insights (2 files) and the growth specs, 27 passing; `tsc` clean.
- **S5-8, order target group: blocked and reclassified.** josh's view isn't built from orders. It reads an xlsx
  staging import, `order_taking_flag`, and `sku_order_period` (a josh cron reading the ERP calendar). Commerce has
  none of these. Options are in plan Task S5-8 / §4 q5 for the owner. No snapshot group was invented.
- **S5-9, health:** without the replica, the josh panel now shows ERP-send failures from `jagota_order_sync_history`,
  including how fresh that copy is, and points to josh-admin for josh-only checks. With the replica, nothing changes.
  Since S5-11 it says `fedBy: events | import | none` with `lastEventAt` / `lastImportAt` (a quiet event stream = no new
  sends; lag shows as josh's outbox backlog). Spec: 3 passing.
- **S5-6, growth:** new switch `GROWTH_SOURCE`, `replica` (default) · `copies`.
  - Workspace: sales come from the order copies, reorder-due from commerce's `winback_account`.
  - Timeline: `josh_companies` + `josh_orders` + commerce `winback_*`.
  - Carts and devices have no copy, so the page says "ยังไม่มีสำเนาใน commerce" and availability is partial.
    Since S5-12: workflow failures and `results` come from `josh_marketing_workflows`; per-company enrollments in the
    timeline stay "not copied".
  - Readiness chip shows "สำเนาใน commerce". Specs: 38 passing; `tsc` clean for both apps.
- **S5-7, orders report:** new switch `ORDERS_SOURCE`, `replica` (default) · `copies`.
  - Copies read `josh_orders` (`paid`), `josh_companies`, `jagota_order_sync_history` and `josh_order_lines`; since
    S5-11 also `josh_branches`, `josh_order_payments` (incl. batch payments — the replica detail lists only direct
    ones), `josh_order_shipments`, `sending_date`, the company ERP code and the orderer's phone (masked).
  - `notCopied` is now only a line's `order_taking_flag`. Spec: 8 passing.
- **S5-14, josh-only pages explain themselves:** `joshOnly(why)` in `system-health.ts` replaces the bare replica
  503 at every remaining replica gate. Each page now says, in Thai, whether it is in josh-admin, a cutover tool, or not
  copied yet. Pages already show the backend message, so no frontend change was needed. Spec: 3 passing.
- **Runbook:** `docs/runbooks/stage5-reports-copies.md` lists every switch, its parity check, the order to flip them,
  what still needs the replica and why, and which crons to turn off (S5-15).
- **S5-11, josh snapshot groups for the report copies (josh branch `feat/commerce-copies-for-reports`, 5 commits; commerce 1 + docs):**
  - josh: `catalog.snapshot` + products report fields (fingerprint unchanged; qty sends on stock-state changes only),
    new `branch.snapshot` (no personal data), `company.snapshot` + `business_type` / `erp_customer_code` /
    `document_language` (no credit — q1), `order.snapshot` + `sending_date` / `payments[]` / `shipments[]` / `refunds[]`,
    new `jagota_sync.snapshot`. Migrations `1792360000000`…`1792400000000`, builder, drainer, backfill groups.
    Specs: commerce-events 30 passing (+10 opt-in real-DB cases, not run).
  - commerce: migration `1795200000000-JoshReportCopies` (nullable columns + `josh_branches`, `josh_order_payments`,
    `josh_order_shipments`, `josh_order_refunds`, `jagota_order_sync_history.source_version`); `JoshEventsService`
    cases; backfill groups `branch`, `jagota_sync`. Older-shape snapshots never null the new data.
    Specs: josh connector 45 suites / 482+ passing; `tsc` clean.
  - Deploy order: commerce first, then josh migrations + backend, then backfill (runbook "ข้อมูลเพิ่มจาก josh (S5-11)").
- **S5-12, push campaigns + marketing workflows (josh branch 2 commits; commerce 2 + docs):**
  - josh: new `push_campaign.snapshot` (the row) and `marketing_workflow.snapshot` (workflow row + counts by status / by
    Bangkok day, recent runs / failures, credited conversion order ids — no enrollments, no user ids). Migrations
    `1792410000000`, `1792420000000`. commerce-events specs 37 passing.
  - commerce: migration `1795300000000-JoshMarketingCopies` (`josh_push_campaigns`, `josh_marketing_workflows`), events
    cases, backfill groups. New switches `PUSH_CAMPAIGNS_SOURCE`, `MARKETING_WORKFLOWS_SOURCE` (replica default · copies);
    `GROWTH_SOURCE=copies` now also covers workflow failures and `results`. Specs: events 31, touched suites 61; `tsc` clean.
  - Not invented: `cart_snapshot` / `user_devices` (growth idle carts) and per-company workflow enrollments (growth
    timeline) have no snapshot group — owner / plan gap.
- **Customers report: deferred.** It is mostly KYC, credit and branch data. It waits on open question 1 and the
  S5-11 company/branch snapshots.

## Not done / not verified
- The copy SQL has not been run against a real DB yet; only unit tests with a mocked `query`.
  First check: `BESTSELLERS_SOURCE=shadow` on staging or prod after the order backfill.
- Integration + MCP suites run (121 suites / 1074 passing, 4 opt-in suites skipped); the full commerce suite was not.
- S5-11 / S5-12 migrations (josh + commerce) not run against a real DB; the josh trigger db-spec cases are opt-in
  (`JOSH_SCOPE_TEST_DATABASE_URL`) and were not run here.

## Next (ops / owner only)
1. Real-DB check of the S5-11 / S5-12 migrations (josh trigger db-spec + commerce migrations on a scratch DB).
2. Deploy commerce, then josh; backfill per the runbook; flip switches 1–9 one by one with their parity checks.
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

## Final summary (2026-10-07)

**Done (code, not pushed):** S5-1 … S5-7, S5-9, S5-10, S5-11, S5-12, S5-14 and the runbook. Every report reader has a
`*_SOURCE=replica|copies` switch (replica default; copies work with `JOSH_DATABASE_URL` unset): bestsellers, winback
reports, restaurants, sales, growth, orders, products, push campaigns, marketing workflows. Health and staff-price SKU
lookup use the copies on their own. Every remaining replica-only page says why (`joshOnly`).
- josh branch `feat/commerce-copies-for-reports`: 7 snapshot-group commits (S5-11 ×5, S5-12 ×2) + STATUS.
- commerce branch `feat/stage5-data-jobs`: copies, events cases, readers, docs.

**Remaining (none of it is coding that can be done without an environment or an owner answer):**
- ops: real-DB migration check; deploy (commerce first), backfill (`branch`, `company`, `catalog`, `jagota_sync`,
  `order`, `push_campaign`, `marketing_workflow`); flip switches 1–9 (runbook); turn off replica crons (S5-15);
  staging click-through without the replica (S5-16), one week on prod without it (plan §5).
- owner (plan §4): customers report KYC / credit (q1), traffic (q2), back-office (q3), one global switch (q4),
  order target group (q5); no snapshot group for `cart_snapshot` / `user_devices` (growth idle carts) or per-company
  workflow enrollments (growth timeline) — documented, not invented.
- stage 7 (unchanged): delete `JoshReplica`, the env var, readonly-user scripts, parity / import CLIs.

**Verify:**
```bash
# commerce
npx jest -c apps/commerce-platform/jest.config.cts apps/commerce-platform/src/modules/integration apps/commerce-platform/src/mcp --runInBand
npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json
# josh (in /workspace/webjosh-s5)
npx nx test backend -- apps/backend/src/app/commerce-events --runInBand
npx tsc --noEmit -p apps/backend/tsconfig.app.json
```

**Hand-off to stage 6:** yes, from the code side. Stage 5's code is complete and additive (all switches default to
`replica`), so stage 6 can start on top of it. Stage 5 itself is only *closed* after the ops items above (plan §5:
prod a week without `JOSH_DATABASE_URL`); those don't block stage 6 coding.
