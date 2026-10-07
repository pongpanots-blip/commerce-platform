# Stage 5 — data jobs (report / metrics / analytics) read commerce copies, not josh's replica — Inventory + Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every report, metric, analytics page and offload job in commerce works with `JOSH_DATABASE_URL` unset. Each
reads commerce's own tables: the event copies from stage 0/2c (`josh_orders`, `josh_order_lines`, `josh_customers`,
`josh_companies`, `josh_restaurant_places`, `josh_staff`, `josh_catalog_products`, …) or the tables commerce owns since
stages 1–4 (`product_*`, `staff_prices`, `inventory_*`, `winback_*`, `segments`, `customer_metrics`). Commerce pages
stop showing "not configured". Spec §1: no read replica, no bridge — josh's order / payment / customer facts reach
commerce **only** through events.

**Architecture:** per reader, one of three moves:
1. **Re-point** — the data is already in a commerce table: same SQL shape over the copy, behind a `*_SOURCE` switch
   (`replica` default → `shadow` compares and logs → `copies`), like `CUSTOMER_METRICS_TO_JOSH` in stage 2a.
2. **New copy** — josh owns the data (orders/payments/shipments/KYC/credit…) and commerce has no copy yet: add a
   `<group>.snapshot` to josh's commerce outbox (trigger + builder + backfill group, stage 2c pattern) and a copy table in
   commerce, then re-point.
3. **Drop / defer** — the page shows josh-owned operational state with no report value after the move (or belongs to
   another stage, e.g. G9 promotions, stage 6 staff admin): say so on the page instead of "not configured", and list it
   for stage 7 cleanup.

**Tech Stack:** NestJS 10, TypeORM 0.3, Postgres, React (commerce-admin), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §1 (report/metrics/analytics move
to commerce; no replica), §2.2 (josh → commerce events), §2.5 (backfill). Previous:
`2026-10-07-stage2c-winback-off-replica.md` (winback already off the replica), `2026-10-07-stage2a-customer-marketing.md`
(customer metrics already on copies).

## Global Constraints

- josh changes additive, off by default; new snapshot groups only send when `JOSH_EVENTS_TO_COMMERCE_ENABLED=true`.
  josh must not get slower — new triggers are one cheap outbox INSERT, builders run in the drainer, never in a request.
- `customer.snapshot` stays marketing-safe (no password / OTP / token). KYC / credit data needs its own decision (§Open
  questions) — not silently added to `customer.snapshot`.
- PDPA: every new customer-linked copy is wiped by `customer.deleted` (josh-events.service.ts `customer.deleted` case).
- Each switch defaults to today's behaviour (`replica`); `copies` must work with `JOSH_DATABASE_URL` unset.
- One-off migration tools (`cli/import-from-josh.ts`, `cli/*-parity.ts`) **keep** `JOSH_DATABASE_URL` — they are run by
  hand against josh prod (read-only user) during cutovers (`docs/runbooks/prod-data-from-josh.md`). Out of scope; stage 7.
- Light tests (owner's RAM): single specs `--runInBand`, suites `--maxWorkers=2`, scratch DBs only.
- Branches: commerce `feat/stage5-data-jobs` (from master @ a1730cd); josh `feat/commerce-copies-for-reports` when the
  first new snapshot group is needed (S5-11).

---

## 1. Inventory

`JOSH_DATABASE_URL` appears in 41 files: 22 code (incl. 6 CLIs), 19 docs/ops/scripts. Code goes through `JoshReplica`
(`connector/josh/josh-replica.ts`, `configured = !!JOSH_DATABASE_URL`); 25 files import it. Unset → controllers throw
503 (`shop-reports.controller.ts:37` `replica()`), MCP tools return `NO_REPLICA` (`mcp/mcp.tools.ts:85`), crons return
early, growth returns `availability: 'unavailable'`.

Paths below are under `apps/commerce-platform/src/modules/integration/` unless absolute.

### 1.1 Already off the replica (nothing to do in stage 5)

| Reader | Reads | Since |
|---|---|---|
| `customers/customer-metrics.service.ts` (cron `joshCustomerMetrics`, push to josh) | `josh_orders`, `segment_customers` | 2a |
| segments, sales reps | `josh_customers` / `josh_users` | 2a / 2b |
| winback request paths (sales app, intake, staff sign-in) | `josh_users`, `josh_companies`, `josh_cuisines`, `josh_restaurant_places`, `josh_erp_sales_history` | 2c |
| `connector/josh/josh-erp-logs.ts`, `api-log/*` | josh **Mongo** (`JOSH_MONGO_URL`) — not Postgres; separate concern | – |
| `GET /reports/promotions/shadow`, `/reports/price-shadow/summary|list`, `/staff-prices/summary|list` | commerce tables | – |

### 1.2 Readers still on the replica

Legend for **Move**: R = re-point (copy already covers it) · R* = re-point, small gap · C = needs new josh snapshot +
copy · D = drop/defer (other stage or no report value).

| # | Reader (file) | Callers | josh tables read | Commerce source after | Gap | Move |
|---|---|---|---|---|---|---|
| 1 | `connector/josh/bestsellers-offload.job.ts` | cron `joshBestsellers` → POST josh `/internal/bestsellers` | `order_items`, `orders`, `product_inventory` | `josh_order_lines.sku` + `josh_orders.status` | none | **R — done in this branch (S5-1)** |
| 2 | `connector/josh/restaurant-places.ts` | `GET /reports/restaurants[/export|/:id]`; MCP `restaurant_places` | `restaurant_place`, `winback_account` | `josh_restaurant_places` (2c, every column) + commerce-owned `winback_account` | none — note it reads josh's **stale** `winback_account` today | **R — done (S5-3)**: `RESTAURANTS_SOURCE` |
| 3 | `connector/josh/josh-insights.ts` `sales()` | `GET /reports/sales`; MCP `shop_sales`; growth `workspace()` | `orders`, `order_items`, `product_inventory`, `product_translation`, `payment_transactions(+_orders)`, `customer_metrics`, `order_refunds` | `josh_orders` (`paid` is computed by josh's builder with the same `paidOrderSql`, and `payment_transactions` has an outbox trigger → order re-sent on payment change), `josh_order_lines`, `josh_catalog_products.translations`, commerce `customer_metrics` | `order_refunds` (refund total) | R* (refunds = C or show "n/a") |
| 4 | `josh-insights.ts` `traffic()` | `GET /reports/traffic`; MCP `shop_traffic` | `analytics_events`, `analytics_funnel_daily`, `user_search_history` | none | all — high-volume event tables | C (daily aggregates only: `analytics.daily.snapshot`) or D |
| 5 | `josh-insights.ts` `orderTargetgroup()` | `GET /reports/order-targetgroup` | view `customer_order_targetgroup_summary` | rebuild as a commerce view over `josh_orders` + `segment_customers` | view definition must be copied from josh | R* |
| 6 | `josh-insights.ts` `failures()` | `GET /reports/health` (system-health), MCP `system_health` | `payment_transactions`, `jagota_order_sync`, `marketing_workflow_scheduled_runs`, `push_campaigns` | `jagota_order_sync_history` (commerce) for the ERP part | payments, workflow runs, push | R* for ERP part, D for the rest (josh's own health) |
| 7 | `connector/josh/josh-orders.ts` | `GET /reports/orders[/summary|/:id]`; MCP `josh_orders` | `orders`, `company`, `branch`, `users`, `jagota_order_sync`, `payment_transactions`, `order_items`, `product_inventory`, `product_translation`, `shipments` | `josh_orders`, `josh_order_lines`, `josh_companies`, `josh_users`/`josh_customers.data->>'mobile_phone'`, `jagota_order_sync_history`, `josh_catalog_products` | `branch` (name, erp code), `company.erp_customer_code`, payment detail (method/paid_at/amount), `shipments`, `orders.sending_date`, `order_taking_flag` | R* list/summary now (degrade missing columns); C for detail (`order.snapshot` gains `payments[]`, `shipments[]`, `sending_date`; new `branch.snapshot`) |
| 8 | `connector/josh/josh-customers.ts` | `GET /reports/customers[/summary|/:id]`; MCP `josh_customers` | `company`, `branch`, `users`, `orders`, `kyc_document`, `credit_term_applications` (+ paid) | `josh_customers`, `josh_companies`, `josh_orders`, `customer_metrics` | company business/credit fields, `branch`, KYC, credit applications | R* basic; C for company/branch; **KYC/credit = open question** |
| 9 | `growth/growth-data.service.ts` | `GET /growth/workspace|results/:id|timeline/:companyId`; MCP `growth_*`; `growth.service.evidence()` | `insights.sales`, `cart_snapshot`, `user_devices`, `winback_account`, `winback_activity`, `company`, `orders`, `users`, `marketing_workflow_enrollments`, `marketing_workflows` | sales via #3, commerce `winback_*` (owned since 2b — josh's copy is stale), `josh_companies`, `josh_orders`, `josh_users` | `cart_snapshot`, `user_devices`, marketing workflow tables | R* (workspace/timeline); results needs workflows (#12) |
| 10 | `growth/growth.service.ts` | `/growth/readiness`, plans | only `replica.configured` | readiness → "copies" status | – | R (readiness flag only); josh **writes** via API stay |
| 11 | `connector/josh/josh-backoffice.ts` | `GET /reports/backoffice[/:view]`; MCP `josh_backoffice` | 16 views: KYC, credit, CN/CB, invoices, shipments, payments, coupons, campaigns, user_segments, supplier, internal docs, admin access requests | segments view → `segments`; rest none | almost all — josh operational back-office | D (stays josh-admin's job; stage 6 staff admin decides) except `segments` view → R |
| 12 | `connector/josh/josh-marketing-workflows.ts` (+controller) | `GET /reports/marketing-workflows[/:id]`; MCP | `marketing_workflow*` (4 tables) | none | all | C (`marketing_workflow.snapshot`) — or ownership move with stage 2 marketing; writes already go through `JoshActions` |
| 13 | `connector/josh/josh-push-campaigns.ts` | `GET /reports/push-campaigns*`; MCP `push_campaigns` | `push_campaigns` (+ Mongo deliveries) | none | `push_campaigns` | C (`push_campaign.snapshot`, small table) |
| 14 | `connector/josh/josh-products.ts` | `GET /reports/products*`; MCP `josh_products` | `product_inventory`, `product_media`, `product_translation`, `product_category` | `josh_catalog_products` + owned `product_prices/contents/masters/images/categories/brands`, `inventory_levels` | category id/path, original price, sup_code, qty, low-stock, MOQ, order-taking, ERP-pending, image list (see S5-4) | **R\*** — needs `catalog.snapshot` extension (S5-11) |
| 15 | `connector/josh/josh-prices.ts` | `GET /reports/prices/*`; MCP `josh_prices` | `branch`, `shop`, `company`, `private_price`, `branch_contract_price`, `product_branch_specials`, `promotion_*`, `erp_quotations` | `staff_prices`, `product_prices`, `josh_companies`, `josh_catalog_products` | branch, shop, branch specials, quantity rules, mechanics (G9 promotions), `erp_quotations` | R* (customer/contract/base prices) after G9; quotations C or D |
| 16 | `connector/josh/josh-promotions.ts` (+controller) | `GET /reports/promotions*`; MCP `josh_promotions` | `promotion_*`, `campaigns`, `product_translation` | none until G9 promotions | all | **D → stage 4 G9** (promotions ownership) |
| 17 | `pricing/price-shadow.ts` | cron `priceShadow`, `POST /reports/price-shadow/run|recheck` | `order_items`, `orders`, `product_inventory` + pricing resolver tables | order lines from copies; resolver inputs need G9 | resolver inputs | D — cutover tool for stage 4a; retire after prices switch |
| 18 | `pricing/staff-prices.ts` | cron `staffPricesImport`, `POST /staff-prices/import`, SKU lookups in create/patch | `private_price`, `branch_contract_price`, `product_inventory` | SKU lookup → `josh_catalog_products`; import is a cutover tool | – | **R — done (S5-10)** for SKU lookup; import = D (stage 7) |
| 19 | `connector/josh/josh-catalog-sync.service.ts` | cron `joshCatalogSync` (on by default, every 15 min), `syncId`/`syncSku` | `product_inventory`, `product_translation` | `catalog.snapshot` events already feed the same table | – | D: turn the cron off once `catalog` backfill + events are trusted; callers use events |
| 20 | `mcp/mcp.tools.ts` | MCP tools for #2–#16 | via the readers | follows the readers | – | follows |
| 21 | `system-health.ts` | `/reports/health` | via #6 | – | – | follows #6 |
| 22 | `connector/josh/winback/josh-winback.ts` (+controller, `report.service.ts`, `meeting-prep.service.ts`, `winback-pool.service.ts`, `josh-tables.ts`) | `GET /reports/winback/{overview,pool,aging,scorecard,dashboard,team-stats,lead-signals}`; MCP (`mcp.tools.ts:930`) | josh's **stale** `winback_*`, `users`, `orders`, `restaurant_place` | commerce `GET /winback/{team-stats,aging,lead-signals,pool,scorecard,dashboard}` (`integration/winback/winback.controller.ts`) — already on commerce tables + copies | response shapes to check per tab | **R — done (S5-2)**: `WINBACK_REPORTS_SOURCE=copies`; josh copy of the code deleted in stage 7 |
| 23 | `orders/josh-order-copy.ts` (+controller) | cron `joshOrderCopy`, `POST v1/storefront/josh-orders/:id/placed`, `POST /reports/order-copy/run` | `orders`, `order_items`, `product_inventory` | it **is** a copier into `josh_orders`/lines; `order.snapshot` events + `POST /reports/order-copy/backfill` fill the same tables | – | D: cron off once events are trusted; `placed` 503 is harmless (events cover it); delete in stage 7 |
| 24 | `jagota/jagota-sync-history.ts` | cron `jagotaSyncImport`, `POST /reports/jagota-sync-history/run` | `jagota_order_sync` ⟕ `orders` | it **is** the copier into `jagota_order_sync_history`; GETs already commerce-only | no event path for `jagota_order_sync` | C (`jagota_sync.snapshot`, josh trigger on `jagota_order_sync`) — needed by #6 and #7 too |
| 25 | `jagota/jagota-shadow.ts` (+controller) | cron `jagotaShadow`, `POST /reports/jagota-shadow/run|recheck` | `jagota_order_sync`, `orders`, `shipments`, `order_items`, `product_inventory`, `branch` | results in commerce `jagota_shadow_checks` (GETs fine) | live josh rows | D — cutover check for the ERP gateway; retire after it |
| 26 | `integration/winback/winback-mirror.ts` | cron `CRON_WINBACK_MIRROR_ENABLED` | six `winback_*` tables + `information_schema` | – | – | D — 2c kept it on the replica by design; retire in stage 7 |

### 1.3 Copiers and cutover checkers (rows 17, 19, 23–26)

These read the replica **to fill or check** a commerce copy, not to show a report. They do not cause "not configured"
pages (their GETs read commerce tables; only `POST …/run|recheck` answer 503). Stage 5 does not port them; it makes
each one unnecessary (events + backfill) and lists them for stage 7. Exception: `jagota_order_sync` has no event path
yet (row 24) — the orders/health reports need it, so it gets a snapshot group in S5-11.

### 1.4 commerce-admin pages that show the replica error

There is no dedicated "not configured" component: `apps/commerce-admin/src/app/lib/api.ts:69-71` throws the backend
`message`, and pages render it in `<ErrorText>` / `<Alert>`. commerce-portal has none.

| Page | Endpoint(s) | Inventory row | Slice |
|---|---|---|---|
| `/reports/winback` (`Winback.tsx`) — **whole page 503** | `reports/winback/*` | 22 | S5-2 |
| `/marketing/restaurants` (`MarketExplorer.tsx`) | `reports/restaurants*` | 2 | S5-3 |
| `/reports/products` | `reports/products*` | 14 | S5-4 |
| `/reports/sales` (`ShopReports.tsx`) | `reports/sales` | 3 | S5-5 |
| `/marketing/growth*` chip "ข้อมูลร้าน · ยังไม่เชื่อม" | `growth/readiness`, `growth/*` | 9, 10 | S5-6 |
| `/reports/orders`, `/reports/customers` | `reports/orders*`, `reports/customers*` | 7, 8 | S5-7 |
| `/reports/order-targetgroup` | `reports/order-targetgroup` | 5 | S5-8 |
| `/reports/health` (inline `<Empty>`) | `reports/health` | 6 | S5-9 |
| `/prices/staff` (create by SKU) | `staff-prices` | 18 | S5-10 |
| `/reports/traffic` | `reports/traffic` | 4 | S5-13 |
| `/reports/prices` | `reports/prices*` | 15 | after G9 |
| `/marketing/workflows` | `reports/marketing-workflows*` | 12 | S5-12 |
| `/josh/:view` (`JoshBackoffice.tsx`) | `reports/backoffice*` | 11 | S5-14 (explain) |
| `/reports/price-shadow`, `/erp/jagota-shadow` Run/Recheck buttons | `…/run`, `…/recheck` | 17, 25 | S5-14 (explain) |

### 1.5 Ops wiring

`.github/workflows/deploy-ecr.yml`, `docker/docker-compose.prod.yml`, `apps/commerce-platform/.env.example`,
`scripts/josh-db-readonly-users.sh`, `scripts/josh-postgres-readonly-user.mjs` — keep until stage 7; the variable stays
optional, and stage 5 ends when prod runs with it **unset** and nothing degrades. The `.env.example` comment at :50-55
("only WinbackMirror and import-from-josh still read it") is out of date — fixed in S5-1.

---

## 2. Prioritised task list

Order = value ÷ risk. "Safe" = commerce-only, default unchanged, copy already complete.

| Pri | Slice | Readers | Needs josh change | Risk |
|---|---|---|---|---|
| **S5-1** | bestsellers offload on copies (`BESTSELLERS_SOURCE`) | #1 | no | low — **done** |
| S5-2 | `/reports/winback` page + MCP → commerce's winback services (`WINBACK_REPORTS_SOURCE`) | #22 | no | low — **done** |
| S5-3 | restaurants report on copies (also stops reading josh's stale `winback_account`) | #2 | no | low — **done** |
| S5-4 | products report on catalog copy + owned tables | #14 | **yes** — `catalog.snapshot` fields (S5-11) | low — blocked |
| S5-5 | sales report on copies (refunds → "n/a" until copied) | #3 | no (refunds later) | medium — money numbers; parity endpoint first |
| S5-6 | growth workspace / timeline on copies + commerce `winback_*`; readiness says "copies" | #9, #10 | no | medium |
| S5-7 | orders + customers reports — list / summary on copies, missing columns "—" | #7, #8 | no | medium |
| S5-8 | order-targetgroup view rebuilt in commerce | #5 | no | low |
| S5-9 | health: ERP part from `jagota_order_sync_history`; josh-only checks labelled | #6, #21 | no | low |
| S5-10 | staff-prices SKU lookup from catalog copy (fixes crash without replica, `staff-prices.ts:136`) | #18 | no | low — **done** |
| S5-11 | josh snapshots: `branch`, `order.snapshot` + `payments[]` / `shipments[]` / `sending_date` / refunds, `company` business + erp code, `jagota_sync`; backfill groups | #7, #8, #3, #24 | **yes** (additive) | medium |
| S5-12 | josh snapshots: `push_campaign`, `marketing_workflow` (+ enrollment counts) | #12, #13, #9 results | yes | medium |
| S5-13 | traffic — daily aggregate snapshot, or drop | #4 | decision | – |
| S5-14 | pages that stay josh-only (backoffice, promotions until G9, price-shadow, jagota-shadow run, imports): say "managed in josh-admin" / "cutover tool" instead of the 503 text | #11, #16, #17, #25 | no | low |
| S5-15 | copiers off: `joshOrderCopy`, `joshCatalogSync`, `jagotaSyncImport` crons once events + backfill are trusted | #19, #23, #24 | – | low (env only) |
| S5-16 | staging with `JOSH_DATABASE_URL` unset → every commerce page + MCP tool answers | all | – | – |

### Switch pattern (each re-point slice)

```
<READER>_SOURCE = replica (default) | shadow | copies
```
- `shadow`: answer from the replica, run the copy query too, log a diff (counts / totals / first differing key).
  Request paths: run shadow only in the cron or a `/…/parity` endpoint, never double the latency of a page.
- `copies`: never touch `JoshReplica`; work with `JOSH_DATABASE_URL` unset.
- One global `REPORTS_SOURCE` may replace the per-reader switches once three slices are in `copies` (decide at S5-5).

---

## 3. Tasks

### Task S5-1: bestsellers offload reads the order copies — DONE (this branch)

**Files:** `connector/josh/bestsellers-offload.job.ts(+spec)`, `apps/commerce-platform/.env.example`.

- [x] `BESTSELLERS_COPIES_SQL` over `josh_order_lines` ⋈ `josh_orders` (same statuses, same top 200, same tie-break).
- [x] `BESTSELLERS_SOURCE=replica|shadow|copies` (default replica). `copies` → `configured` without the replica.
- [x] `shadow` → pushes the replica's list, logs `rankingDiff` (only-replica / only-copies counts, first differing rank);
      a failing copy query never blocks the push.
- [x] Specs: copies path without replica, shadow with failing copies, default unconfigured, `rankingDiff`.
- [x] `.env.example`: `BESTSELLERS_SOURCE`; the stale `JOSH_DATABASE_URL` comment now lists who still reads it.

Known, accepted differences (visible in shadow): copies keep lines of products josh deleted (replica inner-joins
`product_inventory`); a line's SKU is the one at the order's last snapshot; ties may sort differently across collations.

**Cutover:** prod `BESTSELLERS_SOURCE=shadow` ~1 week (needs order backfill done — `prod-data-from-josh.md` row 0–1) →
`firstDiffRank` stays null or ≥ 50 (josh shows ≤ 50) → `copies`. Rollback: `replica`.

### Task S5-2: `/reports/winback` → commerce's winback services — DONE (this branch)

The page cannot call `/winback/*` itself: those routes take **josh's** access token (`AdminWriteGuard`, the sales
app), commerce-admin sends a commerce staff token. So `/reports/winback/*` stays (commerce staff guard, same paths, same
`{data, meta}` envelope) and its source moves.

- [x] Shapes: `connector/josh/winback/*` is josh's module copied as is; commerce's `integration/winback` is the same
      module on commerce tables — `getCounts` / `listProvinces` / `findPool` / `getAging`, `getScorecard` /
      `getDashboard` / `getTeamStats`, `getLeadSignals`, `revenueRisk` return the same keys. Page unchanged but its text.
- [x] `integration/winback/winback-reports.ts` `WinbackReports` + `WINBACK_REPORTS_SOURCE=replica|copies` (default
      replica = `JoshWinback` as before; copies = `WinbackService` / `ReportService` / `MeetingPrepService` + commerce
      `winback_account`, no replica). Controller moved to `winback/winback-reports.controller.ts` (WinbackModule).
- [x] MCP `winback_*` tools use `WinbackReports` (McpModule imports WinbackModule).
- [x] Spec `winback-reports.spec.ts` (3). No shadow mode: until `WINBACK_OWNER=commerce`, `WinbackMirror` already
      hash-compares every row of the six tables on both sides, so the two sources answer from the same rows.
- [ ] Deferred to stage 7: delete `connector/josh/winback/*` (except `pii.helper.ts`, used by josh-orders /
      -customers / -backoffice) and `JOSH_WINBACK_TABLES` in `JoshReplica` once prod runs `copies`.

**Cutover:** prerequisite = commerce's winback tables are current (`WinbackMirror` on, or `WINBACK_OWNER=commerce`).
Compare `/reports/winback/overview` before/after, then `WINBACK_REPORTS_SOURCE=copies`. Rollback: `replica`.

### Task S5-3: restaurants report on copies — DONE (this branch)

**Files:** `connector/josh/restaurant-places.ts(+spec)`, `shop-reports.controller.ts`, `mcp/mcp.tools.ts`.

- [x] Inject commerce `DataSource`; `RESTAURANTS_SOURCE=replica|copies`; SQL: `restaurant_place` →
      `josh_restaurant_places` (same columns, migration `1794500000000`), `winback_account` → commerce's own (same name).
- [x] `available` = copies mode or replica configured; the restaurant routes use the reader's `available`, not
      `insights.available`. MCP `restaurant_places` already checked `restaurants.available`.
- [x] `GET /reports/restaurants/parity` (needs the replica): total / enriched / linked-to-winback / newest
      `updated_at` on both sides. Expected difference: `linked_to_winback` — josh's `winback_account` is stale since 2b.
- [x] Spec: default replica, copies without replica (every query on `josh_restaurant_places`), 7 + MCP spec pass.
- [ ] Opt-in db spec on a scratch DB — not written; the copies SQL is the replica SQL with one table renamed.

Note: `JoshWinback` (the replica path of S5-2) also lists places through `RestaurantPlaces`, so with
`RESTAURANTS_SOURCE=copies` its "places not yet leads" comes from the copy — the commerce answer, which is the
intended end state anyway.

**Cutover:** `restaurant_place` backfill done (stage 2c runbook) → `GET /reports/restaurants/parity`: `total`,
`enriched` equal (± enrichment in flight) → `RESTAURANTS_SOURCE=copies`. Rollback: `replica`.

### Task S5-4: products report on the catalog copy — BLOCKED on a `catalog.snapshot` extension (checked 2026-10-07)

Row 14 is **R\***, not R. josh's `catalog.snapshot` (Webjosh `commerce-events/commerce-snapshot.builder.ts` `CATALOG`)
was cut for competitor matching; `josh-products.ts` needs more:

| report needs (josh column) | commerce today |
|---|---|
| sku, status, names / descriptions, brand, units, VAT, selling / ordering price, category **names**, first image | `josh_catalog_products` ✓ |
| `category_id`, `category_path` (filter `categoryId`, `GET /reports/products/categories`) | ✗ — copy has names only; `product_categories` (4c) has the tree but no product → category link |
| `original_price`, `sup_code` | ✗ nowhere |
| `product_inventory_quantity` (issues `out_of_stock` / `low_stock`) | ✗ in the copy; commerce stock ledger only once `COMMERCE_OWNS_STOCK` |
| `low_stock_threshold`, ingredients … `reorder_quantity` (detail) | `product_contents.fields` — only filled for SKUs commerce owns (4b) |
| `moq` | `product_prices` (4a, when owned) |
| `order_taking_flag` | `product_masters.fields` (4d, when owned) |
| `erp_pending_source / _at / _payload` (issue `pending_approval`, `pendingChanges`) | `product_price_pending` / `product_master_pending` (only when owned) |
| all images (`media[]`, `image_count`, issue `no_image`) | `product_images.images` (4e, when owned); copy has the first only |

- [ ] **josh (S5-11 batch, additive):** add to `CATALOG`: `p.category_id`, `c.category_path`, `p.original_price`,
      `p.sup_code`, `p.product_inventory_quantity`, `p.low_stock_threshold`, `p.moq`, `p.order_taking_flag`,
      `p.erp_pending_source`, `p.erp_pending_at`, image count. Contract note in `docs/event-contract.md`; commerce
      migration adds the columns to `josh_catalog_products` (nullable). Careful: `catalogFingerprint` must keep
      hashing only the old fields (competitor matching compares fingerprints byte for byte). `erp_pending_payload`
      and the full media list stay replica-only until the owned tables cover them.
- [ ] **commerce:** `PRODUCTS_SOURCE=replica|copies`; copies = `josh_catalog_products` overlaid by the owned tables
      where the matching `COMMERCE_OWNS_*` is on (commerce is the truth there); MCP `josh_products` follows.
- Until then the page stays on the replica. Not built now: a copies mode without these columns would show
  wrong issue tiles (every product "out of stock" / "no category").

### Task S5-5: sales report on copies

- [ ] Port `SALES_SQL`, daily series, top products, new customers to `josh_orders` (`paid` column replaces
      `paidOrderSql`), `josh_order_lines`, `josh_catalog_products.translations`, commerce `customer_metrics.first_order_at`.
- [ ] Refunds: `null` + note "refunds not copied yet" until S5-11.
- [ ] `/reports/sales/parity?period=…` returns both answers side by side (shadow without doubling page latency).
- [ ] Growth `workspace()` gets sales from the same reader.

### Task S5-6 … S5-9

Same pattern as S5-3; each one PR-sized commit. Details are in the inventory row; write each task's steps when picked.

### Task S5-10: staff-prices SKU lookup on the catalog copy — DONE (this branch)

- [x] `StaffPrices.create`: SKU → product id and id → SKU from `josh_catalog_products` (same ids as josh's
      `product_inventory`; removed products excluded for SKU → id). The replica is asked only when it is configured
      **and** the copy has no row, so nothing that works today breaks before the catalog backfill. No switch: a lookup.
- [x] Spec: copy hit without replica; copy miss → 400 without replica, replica fallback when configured (12 pass).
- `POST /staff-prices/import` and the `staffPricesImport` cron stay on the replica (cutover tool, D → stage 7).

### Task S5-11 / S5-12: new josh snapshot groups

Stage 2c pattern: josh migration (trigger → `commerce_outbox`), `commerce-snapshot.builder.ts` group, drainer type,
backfill group; commerce migration (real-column copy table + tombstones), `josh-events.service.ts` case, PDPA wipe,
`docs/event-contract.md`, runbook. One group per commit.

### Task S5-14 / S5-16: no more "not configured"

- [ ] commerce-admin: a page whose reader is in `copies` mode never shows the replica banner; a page that stays josh-only
      says so (link to josh-admin) instead of an error.
- [ ] Staging with `JOSH_DATABASE_URL` unset: click through every report page and MCP tool; record in As built.

---

## 4. Open questions (need the owner)

1. **KYC / credit applications / credit limit** on the customers report — copy them (PII-heavy; PDPA wipe needed) or
   keep that view in josh-admin only? Default if unanswered: josh-admin only.
2. **Traffic** (`analytics_events`, funnel, search history) — worth a daily-aggregate snapshot, or drop from commerce?
3. **Back-office views** (#11) — confirm they stay josh-admin (stage 6 decides staff admin).
4. **One global `REPORTS_SOURCE`** vs per-reader switches.

## 5. Done when

- Every row of §1.2 is R-done, C-done, or D with a page that explains itself.
- Prod commerce runs with `JOSH_DATABASE_URL` unset for one week; no page shows "not configured"; MCP tools answer.
- Stage 7 removes `JoshReplica`, the env var, the readonly-user scripts and the parity CLIs.
