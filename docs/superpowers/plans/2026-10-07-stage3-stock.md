# Stage 3 — stock owned by commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce's per-warehouse ledger is the only writer of stock; josh keeps one number per SKU fed by `inventory.sellable.snapshot`.

**Architecture:** commerce already ledgers ERP qty per warehouse (`inventory_movements` / `inventory_levels`, `warehouses.stock_source`). This stage (1) makes the ledger safe (unique level row, locked writes), (2) publishes `inventory.sellable.snapshot { sku, sellableQty, version }` after every applied movement — sum over sellable warehouses, version = latest movement time — in the same transaction, (3) gives admins ledger-backed receive / count / correction / transfer endpoints and screen and closes the raw `/inventory` writes, (4) deducts orders from a commerce-owned warehouse (`order.snapshot`, spec §4.3), (5) replays ERP calls josh caught while commerce was down (`josh_erp_fallback_calls`, spec §3.3). josh gets `COMMERCE_OWNS_STOCK` (no own stock writes: admin qty edits, live ERP stock pulls) and a consumer for the snapshot that also refreshes the PDP / PLP caches.

**Tech Stack:** NestJS 10, TypeORM 0.3, Postgres, Redis (josh), React (commerce-admin), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §1 (stock row), §2.3, §2.4 (`COMMERCE_OWNS_STOCK`), §3.2, §3.3, §4.2 row 3, §4.3.

## Global Constraints

- josh additive, default off: `COMMERCE_OWNS_STOCK` (josh). `/api/erp/products/qty` always accepted (rule 3) and keeps its `CHANGED_AT` version check.
- Shop never waits for commerce: checkout keeps reading josh's own `product_inventory_quantity`.
- Version of stock = real change time (`CHANGED_AT` or movement `occurred_at`), shared `commerce_applied_versions` aggregate `'stock'` on josh.
- Light tests: `--runInBand` single specs, `--maxWorkers=2` suites, no dev servers; real-DB checks on scratch copies.
- Branches: commerce `feat/stage3-stock` (from master), josh `feat/commerce-owns-stock` (from origin/main).

## Decisions taken while planning (owner may revisit)

- **Sellable warehouses:** new `warehouses.sellable boolean default true`; `sellableQty = Σ max(0, quantity − reserved)` over sellable warehouses.
- **Order deduction warehouse:** env `STOCK_ORDER_WAREHOUSE_CODE` (unset = no deduction). Only a `stock_source='commerce'` warehouse is deducted; ERP warehouses already reflect orders in ERP's own numbers.
- **Order deduction states:** deduct when the order status enters `paid | preparing | shipped | delivered`; put back on `cancelled | refunded` if it was deducted. A deduction never drives a level below 0 (clamped; logged) — josh already sold it.
- **josh lock scope:** only `product_inventory_quantity` (and only when the value actually changes, so full-form saves still work); `low_stock_threshold` / `reorder_quantity` stay josh product data (stage 4) — commerce has nowhere to edit them yet. `product_inventory_quantity` stays in `CATALOG_FIELDS` (removing it would 400 every edit from the hosted product form, which sends the whole form); the ProductService check refuses a changed value instead.

---

### Task 1: josh — `COMMERCE_OWNS_STOCK`

**Files:** `apps/backend/src/app/erp/commerce-ownership.flag.ts`, `app/product/product.service.ts` (create ~829, update ~2480), `app/jagota-order/jagota-stock.service.ts` (`syncStockBatch` ~133, `validateProductStock` ~468), specs; `.env.example`.

- [ ] `isCommerceOwningStock()` + `assertStockEditAllowed(current: number | null, next: unknown)` → `ForbiddenException('stock แก้ที่ commerce-admin แล้ว (COMMERCE_OWNS_STOCK)')` when owned and `next` is set and `Number(next) !== current`.
- [ ] `ProductService.create`: owned + body qty non-zero → 403. `update`: call the assert before assigning scalar fields.
- [ ] `syncStockBatch`: when owned, no qty write (DB, `setErpQty`, `cacheStockQty`, restock notify); price behaviour unchanged. `validateProductStock` ERP answer: no `setErpQty` / `cacheStockQty` when owned.
- [ ] Specs: owned + changed qty → 403; owned + same qty → ok; not owned → unchanged; `syncStockBatch` owned writes no qty.
- [ ] Commit `feat(stock): COMMERCE_OWNS_STOCK — josh stops writing stock itself (off by default)`

### Task 2: josh — consume `inventory.sellable.snapshot`, refresh caches

**Files:** `app/erp/commerce-erp-events.controller.ts(+spec)`, `app/erp/erp-webhook.service.ts` (`handleQtyChange`), `app/jagota-order/jagota-stock.service.ts` (public `refreshStockCaches`), `app/jagota-order/jagota-order.module.ts` (export `JagotaStockService`).

- [ ] Handler: `'inventory.sellable.snapshot': { pipe: one(SellableSnapshotDto), input: 'data', run: (c, d) => { if (!isCommerceOwningStock()) throw new ConflictException(...); return c.erp.handleQtyChange([{ PRODUCT_CODE: d.sku, QUANTITY: d.sellableQty, CHANGED_AT: d.version }]); } }` — `SellableSnapshotDto { sku: string; sellableQty: number (int ≥ 0); version: ISO-8601 }`. Same `'stock'` version row as ERP's direct route, so the newer one wins either way.
- [ ] `handleQtyChange` after each applied write: `jagotaStock.refreshStockCaches(inventory, qty)` (deletes `inventory:*` / `product:{lang}:*`, patches `product:{id}`, sets `jagota:stock:{sku}` — the same keys `syncStockBatch` refreshes). Injected `@Optional()` so existing test modules keep compiling.
- [ ] Specs: handler maps the payload; 409 when not owned; 422 on bad payload; `handleQtyChange` calls the refresh.
- [ ] Commit `feat(stock): josh applies inventory.sellable.snapshot from commerce and refreshes PDP / PLP caches`

### Task 3: commerce — safe ledger

**Files:** `migrations/1794600000000-StockOwnership.ts`, `modules/commerce/inventory/application/inventory-ledger.service.ts(+spec)`, `inventory-level.entity.ts`, `warehouse.entity.ts`.

- [ ] Migration: merge duplicate `(product_id, warehouse_id)` level rows (keep the newest `updated_at`, delete the rest), then `CREATE UNIQUE INDEX "UQ_inventory_levels_product_warehouse" ON inventory_levels (product_id, warehouse_id) WHERE deleted_at IS NULL`; `warehouses.sellable boolean NOT NULL DEFAULT true`; `CREATE UNIQUE INDEX ... ON warehouses (code) WHERE deleted_at IS NULL` only if no duplicates (skip with a NOTICE otherwise); `josh_erp_fallback_calls.processed_at timestamptz NULL`, `processed_note text NULL`; table `josh_order_stock_moves (order_line_id uuid PRIMARY KEY, orders_id uuid NOT NULL, product_id uuid NOT NULL, warehouse_id uuid NOT NULL, quantity numeric(14,4) NOT NULL, state varchar(16) NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`.
- [ ] Ledger: one private `lockedLevel(manager, productId, warehouseId)` = `INSERT … ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE`; used by both `recordExternalQuantity` and `adjustOwnStock` (no read-modify-write outside the lock; the stale check reads the latest movement under that lock).
- [ ] Spec: concurrent `adjustOwnStock(+1)` ×2 on a fresh product/warehouse in a DB spec (opt-in) → quantity 2, one level row.
- [ ] Commit `fix(inventory): one level row per product and warehouse; ledger writes under a row lock`

### Task 4: commerce — `inventory.sellable.snapshot`

**Files:** `modules/commerce/inventory/domain/events/inventory-sellable-snapshot.event.ts`, ledger service, `portal/webhooks/event-catalog.ts`.

- [ ] Event `inventory.sellable.snapshot`, aggregate = product id, `snapshot: true`, payload `{ sku, sellableQty, version }` (+ `erp: { PRODUCT_CODE, QUANTITY, CHANGED_AT }` so a platform that takes ERP-shaped qty can use it unchanged).
- [ ] `recordExternalQuantity` (every applied movement, ERP feed or own) publishes it after the level write, same transaction: `SELECT sku, Σ GREATEST(l.quantity − l.reserved, 0), MAX(m.occurred_at)` over sellable, non-deleted warehouses.
- [ ] Spec: applied → one snapshot with the sum; ignored / stale → none; a non-sellable warehouse is excluded.
- [ ] Commit `feat(inventory): publish inventory.sellable.snapshot (sum of sellable warehouses) on every applied movement`

### Task 5: commerce — receive / count / transfer, close raw writes

**Files:** `modules/commerce/inventory/presentation/stock-moves.controller.ts`, `application/stock-moves.service.ts(+spec)`, `inventory.controller.ts`, `inventory.module.ts`; admin `apps/commerce-admin/src/app/pages/StockMoves.tsx`, `app.tsx` route + nav, `lib/api.ts`; `Inventory.tsx` read-only.

- [ ] `POST /api/inventory/adjustments` `{ productId, warehouseId, mode: 'add'|'set', quantity, reason: RECEIVE|COUNT|DAMAGE|RETURN|CORRECTION, note? }` → `adjustOwnStock` in a transaction. `POST /api/inventory/transfers` `{ productId, fromWarehouseId, toWarehouseId, quantity }` → two `adjustOwnStock` (−q then +q, reason TRANSFER, same ref) in one transaction; both warehouses must be `commerce`. Admin only (default).
- [ ] `/inventory` POST / PATCH / DELETE → 405 `ใช้ /inventory/adjustments หรือ /inventory/transfers` (GET stays).
- [ ] Admin page "เคลื่อนไหว stock": three forms (รับเข้า, ตรวจนับ, โอนย้าย) over the endpoints; warehouse picker lists commerce warehouses; product by SKU search (existing products list API).
- [ ] Commit `feat(inventory): receive, count and transfer through the ledger; raw /inventory writes closed`

### Task 6: commerce — orders deduct the commerce warehouse

**Files:** `modules/commerce/inventory/application/order-stock.service.ts(+spec)`, josh-events service (call after `saveOrder`).

- [ ] After an `order.snapshot` is applied: if `STOCK_ORDER_WAREHOUSE_CODE` names a `commerce` warehouse — for each line with a known product (`products.sku = line.sku`): deduct state rows per line inside the same transaction (`josh_order_stock_moves`), `deducted` ↔ `returned` per status rule; each move is a ledger movement (reason ORDER / ORDER_CANCEL, ref `order:<orders_id>`), clamped at 0.
- [ ] Spec: paid → one deduction per line; replay → no second deduction; cancelled after paid → put back once; cancelled before paid → nothing; unknown SKU skipped.
- [ ] Commit `feat(inventory): josh orders deduct the commerce warehouse (STOCK_ORDER_WAREHOUSE_CODE)`

### Task 7: commerce — replay ERP calls josh caught

**Files:** `modules/integration/connector/erp/ingest/erp-fallback-replay.job.ts(+spec)`, erp module.

- [ ] Cron (`CRON_ERP_FALLBACK_REPLAY_ENABLED`, every minute): unprocessed `josh_erp_fallback_calls` with path ending `/products/qty` → `ErpFeedService.receive('qty', body)` (normal ingest: ledger with `CHANGED_AT`, stale if commerce already has newer); other paths → `processed_note = 'not stock'`; set `processed_at`.
- [ ] Spec: qty call → receive called once and marked; second run → nothing.
- [ ] Commit `feat(erp): replay ERP qty calls josh received while commerce was down into the ledger`

### Task 8: docs, verification, as built

- [ ] `docs/event-contract.md` (§3 `inventory.sellable.snapshot`, §5 josh handler), `.env.example` (`STOCK_ORDER_WAREHOUSE_CODE`, `CRON_ERP_FALLBACK_REPLAY_ENABLED`), runbook `docs/runbooks/stage3-stock-cutover.md`.
- [ ] Scratch DBs: migration up/down/up (with seeded duplicate levels); ledger + snapshot + order deduction on real tables; josh handler + cache refresh against a scratch josh DB with Redis off (refresh no-op).
- [ ] Full suites `--maxWorkers=2`; As built; drop scratch DBs; commit both repos.

## As built (2026-10-07)

- **Snapshot version = now**, not the latest movement's `occurred_at` as the spec says: ERP `CHANGED_AT`s of different
  warehouses arrive out of order, and an equal-or-older version for a new sum would be dropped by josh as stale. "now" is
  monotonic per SKU. Trade-off: a snapshot built after commerce recovers but before the fallback replay can briefly
  overwrite a newer ERP-direct value on josh; the replay (≤1 min) sends the corrected sum.
- **Snapshots only for sellable warehouses' movements** (a move in a non-sellable store does not change the sum).
- **josh, `inventory.qty.changed` once owned:** acknowledged and skipped (per-warehouse values would overwrite the sum).
- **josh cache refresh:** `handleQtyChange` now refreshes the PDP / PLP caches for every source (ERP direct too) — fixes
  the existing "old stock for up to 24h" gap, not only for commerce.
- **Routes:** stock moves live under `/api/stock/*` (not `/inventory/*`, whose `:id` route would swallow them); added
  `POST /api/stock/sellable-snapshots/resend` for cutover.
- **Admin:** the raw Inventory page is gone (its form would now 405); `/inventory` redirects to Stock moves. Not checked in
  a browser (no dev servers, RAM) — typecheck only.
- **Order deduction:** `adjustOwnStock` got `clampAtZero` (orders only; also ignores reservations).
- **Not done:** lines removed from a held order (not a cancellation) keep their deduction; josh real-DB run of the new
  handler (wiring only; unit-covered).

**Verification:** scratch copy of the dev DB — migration up / down / up; opt-in `inventory-ledger.service.db.spec.ts`
(concurrent first-ever receipts 2 + 5×3 → 17 on one row; sellable sum excludes the non-sellable store; transfer atomic and
refused when too big; count / 404s; orders: pending → nothing, paid ×3 → one deduction, cancelled ×2 → one give-back,
unknown SKU skipped, clamp at 0 and give back only what was taken; resend → one snapshot per product).
Full suites (`--maxWorkers=2`): commerce 1282 passed (21 opt-in skipped).
