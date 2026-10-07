# Stage 4a — product prices owned by commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce is the writer of each product's base price (`selling_unit_price`), ERP box price (`ordering_price`) and MOQ, including the MER approval queue for ERP price / MOQ changes; josh keeps a copy fed by `product.price.snapshot`. Customer / contract prices are already commerce-primary (`staff_prices`); this stage closes the josh paths that still write them.

**Architecture:** commerce stores `product_prices` (one row per SKU) and `product_price_pending` (the MER queue). Once `COMMERCE_OWNS_PRICES=true` on commerce, ERP `PUT /erp/products/price|moq` stage into the queue; MER approves / rejects in commerce-admin; approve and staff edits write `product_prices` and publish `product.price.snapshot { sku, sellingUnitPrice, orderingPrice, moq, version }` in the same transaction. josh, with its existing `COMMERCE_OWNS_PRICES`, applies the snapshot through its own `applyErpPendingPayloadToInventory` (so `original_price` is re-normalised by josh's rule), stops staging ERP price / MOQ itself, and refuses the remaining direct price writes.

**Tech Stack:** NestJS 10, TypeORM, Postgres, Redis (josh caches), React (commerce-admin), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §4.2 row 4 (first group: customer / contract prices → list price + MER queue + ERP price / MOQ webhooks).

## Global Constraints

- Promotions / coupons stay josh-owned (decided 2026-10-06, confirmed 2026-10-08). `original_price` (strikethrough) and `buying_price` stay josh product data (stage 4b): `original_price` is derived by josh from the price it receives.
- josh `/api/erp/*` always accepted (rule 3): with the flag on, ERP price / MOQ calls that reach josh directly are acknowledged and forwarded to commerce (`erp.fallback.received`, replayed by commerce into its queue) instead of staged in josh.
- Checkout keeps reading josh's own `product_inventory` — josh never calls commerce.
- Light tests (`--runInBand`, `--maxWorkers=2`, scratch DBs, no dev servers).
- Branches: commerce `feat/stage4a-prices` (from master), josh `feat/commerce-owns-prices` (from origin/main).

---

### Task 1: josh — `COMMERCE_OWNS_PRICES` closes the remaining writers
- [ ] `assertPriceEditAllowed(current, next)` (changed `selling_unit_price` → 403) in `ProductService.update`.
- [ ] `handlePriceChange` / `handleMoqChange`: owned → no staging, no live write for non-draft rows (answer `{ skipped }`); draft rows unchanged (not sellable until approved).
- [ ] `handleProductUpsert`: owned → staged patch for an existing non-draft row drops `ordering_price`, `selling_unit_price`, `moq`.
- [ ] `approveDraftProducts`: owned → the staged payload's price / MOQ keys are dropped before applying (left over from before the switch).
- [ ] `syncInventoryMetadata` / `applyProductFields`: owned → no `moq` / `selling_unit_price` writes.
- [ ] CS price-request `APPROVED`: owned → 403 (customer prices are set in commerce).
- [ ] Bug fix (any flag): `QuotationSpecialPriceService.applyFromQuotation` bumps `invalidateAllSkuPriceCaches` after writing.
- [ ] Specs for each; commit.

### Task 2: josh — apply `product.price.snapshot`
- [ ] `CommercePricesService.apply({ sku, sellingUnitPrice, orderingPrice, moq, version })`: 409 unless owned; transaction: lock `product_inventory` by SKU, `applyIfNewer(m, 'price', sku, version)`, `applyErpPendingPayloadToInventory(inv, { selling_unit_price, ordering_price, moq })` (non-null only), save; then `invalidateSkuPriceCache(redis, id)`, catalog facet cache, PDP / PLP caches (`refreshProductCaches` in JagotaStockService — inventory / product keys with the new price).
- [ ] Receiver handler `product.price.snapshot` (`input: 'data'`, DTO validated); unknown SKU → 422 (dead-letter).
- [ ] Specs; commit.

### Task 3: commerce — tables, service, events
- [ ] Migration `1794700000000-ProductPrices`: `product_prices (product_inventory_sku varchar(64) PK, selling_unit_price numeric(12,2), ordering_price numeric(12,2), moq int, source varchar(16) NOT NULL DEFAULT 'import', updated_by text, updated_at timestamptz NOT NULL DEFAULT now())`; `product_price_pending (product_inventory_sku varchar(64) PK, selling_unit_price numeric(12,2), ordering_price numeric(12,2), moq int, changed_at timestamptz, received_at timestamptz NOT NULL DEFAULT now())`.
- [ ] `ownsPrices()` (`COMMERCE_OWNS_PRICES`), `GET /api/ownership` → `prices`.
- [ ] `ProductPricesService`: `stage(sku, patch, changedAt)` (merge into pending), `approve(skus)` / `reject(skus)`, `edit(sku, patch, staffId)`, `list` / `pending`; every write to `product_prices` publishes `ProductPriceSnapshot` (aggregate = uuid from md5(sku), `snapshot: true`, version = now).
- [ ] Specs (unit + opt-in DB); commit.

### Task 4: commerce — ERP feed and fallback replay stage into the queue
- [ ] `ErpFeedService` price / moq: when owned, `stage()` in the same transaction (the existing `product.price.changed` / `product.moq.changed` publish stays — josh's subscription drops them at the switch).
- [ ] `ErpFallbackReplayJob`: `/products/price` and `/products/moq` paths replay through `receive('price'|'moq')`.
- [ ] Specs; commit.

### Task 5: commerce — API, admin page, product edit split
- [ ] `GET /api/product-prices?search`, `GET /api/product-prices/pending`, `POST /api/product-prices/pending/approve|reject {skus}`, `PATCH /api/product-prices/:sku {sellingUnitPrice?, orderingPrice?, moq?}` — marketing? no: admin + `mer` role if it exists, else admin.
- [ ] `JoshActionsController.updateProduct`: owned → `selling_unit_price` goes to `ProductPricesService.edit`, the rest is relayed as before.
- [ ] commerce-admin page "ราคาสินค้า" (pending queue with approve / reject, search + edit).
- [ ] Commit.

### Task 6: commerce — import and parity
- [ ] `import-from-josh -- prices`: `product_inventory` → `product_prices` (same column names), plus pending price / MOQ from `erp_pending_payload`.
- [ ] `npm run price-parity`: commerce `product_prices` vs josh `product_inventory` (different SKUs, sample).
- [ ] Commit.

### Task 7: docs, verification, as built
- [ ] Contract (`product.price.snapshot`, josh handler), env, runbook `docs/runbooks/stage4a-prices-cutover.md`.
- [ ] Scratch DBs: import + parity; stage → approve → snapshot; josh apply on a scratch copy.
- [ ] Full suites `--maxWorkers=2`; as built; drop scratch DBs; commit.
