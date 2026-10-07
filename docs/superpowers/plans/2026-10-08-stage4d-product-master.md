# Stage 4d — ERP product master and its MER queue owned by commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce is the writer of the product fields the ERP feeds — units, pack, brand name, VAT, marketed by,
product type, status, category, order-taking flag / units, supplier code, season — and of the MER queue that approves
ERP changes to them on live products. josh keeps a copy fed by `product.master.snapshot`.

**Architecture:** same shape as 4a / 4b. commerce stores `product_masters (sku PK, fields jsonb)` with josh's column
names (category as `category_code`, like the ERP) and `product_master_pending (sku PK, patch jsonb)`. With
`COMMERCE_OWNS_PRODUCT_MASTER=true`, every ERP product upsert commerce relays to josh is also turned into josh's pending
patch (a port of `buildProductUpsertPendingPatch`, price keys left to 4a) and staged in commerce's queue — for SKUs the
catalog copy shows live (new SKUs and drafts stay josh's: josh creates drafts and MER activates them there). MER
approves / rejects in commerce-admin; approve and staff edits of these fields in the product form write
`product_masters` and publish the whole row in the same transaction. josh applies it with its own
`applyErpPendingPayloadToInventory` (pack normalisation, `original_price`, draft-locked status) and resolves
`category_code`.

**Tech Stack:** NestJS 10, TypeORM, Postgres, Redis (josh caches), React (commerce-admin), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §2.4 (`sync-product-status`,
`sync-inventory-metadata`) and §4.2 row 4 (units / ordering groups).

## Global Constraints

- Drafts stay josh's: an unknown SKU from the ERP becomes a josh draft with ERP values, activated by MER (josh approve,
  relayed from commerce under `COMMERCE_APPROVES_PRODUCTS`). commerce holds a SKU's master row once it imports or edits it.
- Not in 4d: names (josh-owned / 4b), prices / MOQ (4a), images, order periods / delivery dates (Jagota feeds, josh).
- New switch both sides: `COMMERCE_OWNS_PRODUCT_MASTER`. Off = josh stages and approves ERP product changes as before.
- Light tests (`--runInBand`, `--maxWorkers=2`, scratch DBs).
- Branches (stacked on 4c): commerce `feat/stage4d-product-master`, josh `feat/commerce-owns-product-master`.

---

### Task 1: josh — stop writing master fields itself, apply the snapshot
- [ ] `isCommerceOwningProductMaster()`, `MASTER_KEYS`, `withoutMasterKeys(patch)`.
- [ ] Owned: `handleProductUpsert` stages nothing of the master keys for live SKUs; `approveDraftProducts` drops them
  from a left-over live payload; Jagota `applyProductFields` skips them; `POST /product/admin/sync-product-status` → 403.
- [ ] `CommerceProductMasterService.apply({ sku, fields, version })`: 409 unless owned; 400 on a non-master key; lock by
  SKU (422 unknown), `applyIfNewer('product.master', sku)`, `applyErpPendingPayloadToInventory`, `category_code` →
  `category_id`, save; caches (product, facets, shoppable categories). Handler `product.master.snapshot`. Specs; commit.

### Task 2: commerce — tables, patch builder, service, queue
- [ ] Migration `1795000000000-ProductMasters`: `product_masters`, `product_master_pending`.
- [ ] `erp-product-patch.ts`: `buildMasterPatch(erpItem)` (port; VAT / status / ordering-units rules), `MASTER_FIELDS`
  (validation for staff edits), `JOSH_MASTER_SQL`.
- [ ] `ProductMastersService`: `stage(m, sku, patch, at)` (merge), `pending`, `approve(skus)` / `reject(skus)`,
  `edit(sku, body, staff)` (form keys; `category_id` → `category_code` via `product_categories`), publish
  `ProductMasterSnapshot` (aggregate md5 `master:<sku>`). `ownsProductMaster()`, ownership `productMaster`.
- [ ] ERP relay: product upsert / bulk → stage when owned and the catalog copy says the SKU is live. Fallback replay of
  `/products` upsert paths stages the same way.
- [ ] Specs (builder unit; opt-in DB); commit.

### Task 3: commerce — API, product form, queue page, import, parity
- [ ] `GET /api/product-masters/pending`, `POST …/pending/approve|reject`, `GET /api/product-masters/:sku`.
- [ ] `JoshActionsController.updateProduct`: owned → master keys (status, category, brand, units, pack …) to
  `ProductMastersService.edit`; product form shows commerce's row over josh's copy.
- [ ] Admin page "คิวข้อมูลสินค้าจาก ERP" (current → new per field, approve / reject).
- [ ] `import-from-josh -- masters` (+ live part of josh's queue), `npm run master-parity`. Commit.

### Task 4: docs, verification, as built
- [ ] Contract, env, runbook `docs/runbooks/stage4d-product-master-cutover.md`.
- [ ] Scratch DBs: import + parity; ERP upsert → queue → approve → snapshot → josh applies → parity.
- [ ] Full suites; as built; drop scratch DBs; commit.

## As built (2026-10-08)

- **Scope as planned.** New switch `COMMERCE_OWNS_PRODUCT_MASTER` both sides; `GET /api/ownership` → `productMaster`.
- **commerce:** `product_masters` / `product_master_pending` (jsonb, josh's pending-patch keys). `master-fields.ts` ports
  josh's `buildProductUpsertPendingPatch` (VAT, status, ordering units rules) for the master keys and validates the
  product form's master keys. The ERP relay stages product upserts / bulk in the same transaction as the relay; the
  fallback replay stages `/products` paths. Staging skips SKUs that are neither in `product_masters` nor live in the
  catalog copy (new SKUs / drafts stay josh's). Approve / staff edit publish `product.master.snapshot` (whole row).
  New page "คิวข้อมูลสินค้าจาก ERP"; the product form sends status / category / brand / units / pack here and shows
  commerce's row over josh's copy (category still josh's id).
- **Found in the end-to-end run:** josh derives packaging type / units per box / weight per unit from `pack_size` only
  when they are not given; the whole-row snapshot sent the old ones (25 KG pack kept 13 KG). Fix: a write with a new
  `pack_size` and without those keys drops them from commerce's row, so josh derives them — same result as josh's own approve.
- **josh:** live products' master keys are no longer staged from the ERP or applied by josh's approve; the Jagota
  metadata sync puts commerce's values back (and the 4b content it also wrote — shelf life, organic — under
  `COMMERCE_OWNS_CATALOG`, missed in 4b); `sync-product-status` → 403. `CommerceProductMasterService.apply` =
  `applyErpPendingPayloadToInventory` + `category_code` → id.

**Verification:** josh — master service / upsert gating specs, erp / product / jagota specs. commerce — builder unit
spec, opt-in `product-masters.service.db.spec.ts` (merge, live-only staging, approve only changed fields, reject,
category id → code, pack-derived drop, switch off), relay controller spec. Scratch copies: import 5,888 live SKUs,
`master-parity` 0; a real ERP upsert (pack 25 KG, unit, brand, VAT, status, category) → queue → approve → josh applied
(weight 25 KG derived, category 1-1-1-2) → parity 0. Browser: the queue page shows current → new, approve writes the row
and the snapshot. commerce full suite (`--maxWorkers=2`): 1299 passed (31 opt-in skipped).
josh full suite (`--maxWorkers=2`): 6745 passed; only the known `pii-leak.spec` fails (pre-existing). Scratch DBs dropped.
