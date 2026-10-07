# Stage 4f — ordering / logistics owned by commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce is the writer of the ordering / logistics data that is authored (not computed) — the ERP's supplier
order rounds (`supplier_order_period`: which delivery dates a pre-order supplier takes, until when) and the per-SKU
logistics fields staff set (`unit_ratio`, `sub_packing_unit`, `product_unit`, `expected_restock_at`, `delivery_dates`).
josh keeps copies fed by `supplier.order_periods.snapshot` and `product.logistics.snapshot`; checkout keeps reading them.

**Architecture:** same shape as 4d / 4e.
- **Order rounds:** commerce stores `supplier_order_periods` with josh's columns and unique key
  (`sup_code`, `erp_order_period`). With `COMMERCE_OWNS_ORDERING=true`, every ERP `POST|PUT /erp/order-periods` commerce
  relays (and every fallback call josh took directly) also runs a port of josh's `SupplierOrderPeriodService.upsertFromErp`
  (date-only `DATE_FROM` / `DATE_TO`, Bangkok wall-clock `EST_CLOSE_DATE`, rounds missing from the push → `C`) in the same
  transaction, then publishes **one snapshot per supplier with all its rounds** (open and closed). josh replaces that
  supplier's rows in one transaction (newest version only).
- **SKU logistics:** commerce stores `product_logistics (sku PK, fields jsonb)` — only the five keys, validated per key.
  The product form's logistics keys go here when owned and publish the whole row in the same transaction.

**Tech Stack:** NestJS 10, TypeORM, Postgres, React (commerce-admin), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §2.4 (MOQ / ordering / season
dates still writable outside the flags) and §4.2 row 4 (fifth group: ordering / logistics).

## What is where today (josh `feat/commerce-owns-images`, explored 2026-10-07)

| Data | Writer in josh | Read by | Decision |
|---|---|---|---|
| `supplier_order_period` | ERP `POST/PUT /api/erp/order-periods` → `upsertFromErp`; `SupplierOrderPeriodPollCron` (Node `GET /products/get-order-periods`, backstop); simulator | checkout gate `ensureOrderPeriodOpenForOtLines`, `FulfillmentDatesService` (PDP / cart OT rounds) | **4f → commerce** |
| `unit_ratio`, `sub_packing_unit`, `product_unit` | admin `POST/PATCH /product` (+ relay `CATALOG_FIELDS`), sheet import (insert only); Jagota sync writes `unit_ratio` (not in any owned list) | PDP, promotion mechanics, ERP order units | **4f → commerce** |
| `expected_restock_at` | admin `POST/PATCH /product` (+ relay) | PDP / cs-admin | **4f → commerce** |
| `delivery_dates` (weekday list, default all 7) | nobody since the 1790210000000 backfill | PDP fallback `nextDeliveryDateFromWeekdays` | **4f → commerce** (staff can finally set it) |
| `order_taking_flag`, `season_start/end`, `sup_code`, units | ERP upsert | | already 4d |
| MOQ, `ordering_price` | ERP | | already 4a |
| `sku_order_period`, `delivery_calendar` | josh probes of the Jagota Node API (crons, `/erp/*/probe`) — caches of Jagota's calendar, never authored | checkout / PDP | **stay josh** (pulled caches, not owned data) |
| `order_taking_dates` column | nobody (computed from `sku_order_period` + `supplier_order_period` at read time) | | not moved (dead column) |
| `tier_prices` | deprecated; routed into promotion rules | | promotions stage (4g) |

## Global Constraints

- New switch both sides: `COMMERCE_OWNS_ORDERING`. Off by default; off = josh writes as before (rollback).
- Additive only: new tables, new events, new routes; the existing `erp.order_periods.pushed` relay to josh is unchanged.
- A supplier snapshot always carries **all** rounds commerce has for that supplier (josh replaces, never merges); an
  empty list is never sent (a supplier only ever appears after a push with rows).
- The ERP push is accepted as josh accepts it: rows missing `SUP_CODE` / `ORDER_PERIOD` / `DATE_FROM` / `DATE_TO` are
  skipped, not refused (the relay already answered 200).
- josh `/api/erp/*` always accepted (rule 3). Checkout keeps reading josh's own tables — josh never calls commerce.
- Light tests (`--runInBand`, `--maxWorkers=2`, opt-in scratch DBs).
- Branches: commerce `feat/stage4-g5-ordering-logistics` (from master after 4e); josh `feat/commerce-owns-ordering`
  from `feat/commerce-owns-images` (**not done in this branch — see Task 1**).

---

### Task 1: josh — stop writing ordering data itself, apply the snapshots (FOLLOW-UP, josh repo)

Not done here (this branch is commerce-only). For the josh session:

- [ ] `isCommerceOwningOrdering()` (`COMMERCE_OWNS_ORDERING`); `LOGISTICS_KEYS = ['unit_ratio', 'sub_packing_unit',
  'product_unit', 'expected_restock_at', 'delivery_dates']`.
- [ ] Owned → `POST/PATCH /api/erp/order-periods`: answer `{ received: true, skipped: 'commerce-owned' }` without
  `upsertFromErp` (the `ErpFallbackInterceptor` still forwards the call as `erp.fallback.received`, commerce replays it).
- [ ] Owned → `SupplierOrderPeriodPollCron`: do not upsert; put the polled rows in `commerce_outbox` as `erp.fallback`
  with path `/api/erp/order-periods` (so the Node backstop still reaches the owner). Simulator `testing/order-periods` → 403.
- [ ] Owned → `PATCH /product/:id`, `POST /product`, relay `CATALOG_FIELDS`, sheet import: 403 when a `LOGISTICS_KEYS` key
  changes (`assertLogisticsEditAllowed(current, next)`). Jagota `applyProductFields`: put commerce's `unit_ratio` back
  (add to the restore list like `MASTER_COLUMNS`).
- [ ] `CommerceOrderingService.applyOrderPeriods({ supCode, periods, version })`: 409 unless owned; DTO (status 1–5 chars,
  dates `YYYY-MM-DD`, `close_at` ISO or null, `periods` non-empty ≤500); transaction: `applyIfNewer(m,
  'supplier.order_periods', supCode, version)`, delete the supplier's rows, insert the given ones (`synced_at = now()`).
  Then clear the fulfillment-date / delivery-date caches that read it (`jagota:delivery_dates:*`, OT-round caches if any).
- [ ] `CommerceOrderingService.applyLogistics({ sku, fields, version })`: 409 unless owned; 400 on a non-logistics key;
  lock SKU (422 unknown), `applyIfNewer(m, 'product.logistics', sku, version)`, assign columns (`expected_restock_at` via
  `parseExpectedRestockAt`, `delivery_dates` null → the all-days default), save; `refreshProductCaches`.
- [ ] Handlers `supplier.order_periods.snapshot`, `product.logistics.snapshot` (`input: 'data'`) in
  `commerce-erp-events.controller.ts`.
- [ ] Pre-existing gap found while exploring: commerce relays `erp.order_periods.pushed` but josh's `HANDLERS` has no
  entry for it (the josh subscription must not list it, or it dead-letters). Either add a handler that calls
  `upsertFromErp` when **not** owned, or keep it off the subscription — decide in the josh PR.
- [ ] Specs (apply, stale, 409, 400, 422, owned ERP push skipped, poll forwarded, PATCH guard); commit.

### Task 2: commerce — tables, fields, services, events
- [ ] Migration `1795150000000-OrderingLogistics`: `supplier_order_periods (id uuid PK, sup_code varchar(50),
  erp_order_period varchar(50), date_from date, date_to date, close_at timestamptz, status varchar(5), synced_at,
  created_at, updated_at, UNIQUE (sup_code, erp_order_period))`; `product_logistics (product_inventory_sku varchar(64) PK,
  fields jsonb, source, updated_by, updated_at)`.
- [ ] `order-periods.ts`: `toDateOnly`, `toBangkokTimestamp`, `mapErpOrderPeriods(rows)` (port of josh's mapping, skip
  incomplete rows, dedupe last-wins per key), `JOSH_ORDER_PERIODS_SQL`.
- [ ] `logistics-fields.ts`: `LOGISTICS_KEYS`, `splitLogistics(body)` (400 on bad value: strings ≤50, ISO date or empty for
  `expected_restock_at`, weekday array for `delivery_dates`), `JOSH_LOGISTICS_SQL`.
- [ ] `OrderingService`: `fromErp(m, body)` (upsert + close missing per supplier, publish one
  `SupplierOrderPeriodsSnapshot` per supplier with all rows), `periods(supCode?)`, `republish(supCode)`,
  `getLogistics(sku)`, `editLogistics(sku, body, staff)` (merge, publish `ProductLogisticsSnapshot`). `ownsOrdering()`.
- [ ] ERP relay (`erp.order_periods.pushed`) and fallback replay (`/order-periods`) call `fromErp` when owned.
- [ ] Specs (unit: mapping / validation; opt-in DB: upsert + close + snapshot, logistics merge, switch off); commit.

### Task 3: commerce — API, product form, admin page, import, parity
- [ ] `GET /api/order-periods?supCode=`, `POST /api/order-periods/:supCode/republish`, `GET /api/product-logistics/:sku`;
  `GET /api/ownership` → `ordering`.
- [ ] `JoshActionsController.updateProduct`: owned → logistics keys to `OrderingService.editLogistics`; the form shows
  commerce's row over josh's copy and gains the five fields.
- [ ] Admin page "รอบสั่งซื้อ supplier (ERP)": rounds per supplier, status, close time, republish.
- [ ] `import-from-josh -- ordering` (both tables), `npm run ordering-parity`. Commit.

### Task 4: docs, verification, as built
- [ ] Contract, env, runbook `docs/runbooks/stage4f-ordering-logistics-cutover.md`, prod-data list.
- [ ] Scratch DBs: import + parity; ERP push → snapshot → josh apply → parity (needs Task 1 + a Postgres; not available
  in this session).
- [ ] commerce suite (`--maxWorkers=2`), typecheck; as built; commit.
