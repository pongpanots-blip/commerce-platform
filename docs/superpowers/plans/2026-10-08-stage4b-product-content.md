# Stage 4b — product content owned by commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce is the writer of the product content staff edit — names and descriptions (th / en), ingredients,
allergens, expiry info, usage, pairing, storage temperature, shelf life, organic, short code, cost and stock-alert
levels. josh keeps a copy fed by `product.content.snapshot`.

**Architecture:** commerce stores `product_contents (product_inventory_sku PK, fields jsonb)` — only the content keys,
validated per key. With `COMMERCE_OWNS_PRODUCT_CONTENT=true`, the product form's content keys are saved there and
publish `product.content.snapshot { sku, fields, version }` in the same transaction; the rest of the form is relayed to
josh as before. josh applies the snapshot with its existing `COMMERCE_OWNS_CATALOG` (the switch that already makes
commerce the editor): newest version only, inventory columns + th / en translations, then PDP / PLP / catalog caches.

**Tech Stack:** NestJS 10, TypeORM, Postgres, Redis (josh caches), React (commerce-admin), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §4.2 row 4 (third group:
identity / content / units).

## Global Constraints

- **Content = fields only staff write.** Fields the ERP / Jagota feeds also write stay with josh's ERP product queue
  and move with it in the next stage (units, pack size, brand, VAT, product type, status, category, ordering flags,
  storage instruction and certificates — Jagota's live sync writes these). ERP writes names only when it creates a
  draft product; live products' names are never staged from the ERP, so commerce owns them cleanly.
- Not in 4b: `nutrition` (JSON josh validates; stays on the relay), `original_price` (josh derives it with the price,
  stage 4a), images, the AI-written translation columns (story / detail / …).
- A SKU with no commerce row keeps josh's values (new drafts from the ERP); the snapshot only carries keys commerce
  holds, so josh never blanks a field commerce does not know.
- josh `/api/erp/*` untouched. Checkout keeps reading josh's own tables.
- Light tests (`--runInBand`, `--maxWorkers=2`, scratch DBs, no dev servers).
- Branches (stacked on 4a, not merged yet): commerce `feat/stage4b-content` from `feat/stage4a-prices`, josh
  `feat/commerce-owns-content` from `feat/commerce-owns-prices`.

---

### Task 1: josh — apply `product.content.snapshot`
- [ ] `CommerceContentService.apply({ sku, fields, version })` (`erp/commerce-content.service.ts`): 409 unless
  `COMMERCE_OWNS_CATALOG`; DTO validates `fields` keys against `CONTENT_KEYS` (unknown → 400). Transaction: lock
  `product_inventory` by SKU (unknown → 422), `applyIfNewer(m, 'product.content', sku, version)`, assign inventory
  columns, upsert th / en translation (`product_name` only when non-empty; insert needs a name), save. Then
  `refreshProductCaches`, catalog facet rows, catalog response cache.
- [ ] Handler `product.content.snapshot` (`input: 'data'`).
- [ ] Sheet import `POST /product-category/upload` gets `CommerceOwnedCatalogGuard` (it writes names / content).
- [ ] Specs (apply, stale version, 409, 422, unknown key); commit.

### Task 2: commerce — table, service, event
- [ ] Migration `1794800000000-ProductContents`: `product_contents (product_inventory_sku varchar(64) PK, fields jsonb NOT NULL DEFAULT '{}', source varchar(16) NOT NULL DEFAULT 'import', updated_by text, updated_at timestamptz NOT NULL DEFAULT now())`.
- [ ] `product-contents/content-fields.ts`: `CONTENT_FIELDS` (key → kind: name ≤255 non-empty, text, str(n), money, count),
  `parseContentPatch(raw)` (400 on unknown key / bad value), `JOSH_CONTENT_SQL` (josh row → the same jsonb; used by import and parity).
- [ ] `ProductContentsService`: `get(sku)`, `edit(sku, patch, staffId, source)` (known SKU, merge `fields || patch`,
  publish `ProductContentSnapshot` with the whole row), `ownsProductContent()`; `skuAggregateId(sku, 'content')`.
- [ ] `GET /api/product-contents/:sku` (admin); `GET /api/ownership` → `productContent`.
- [ ] Specs (unit parse; opt-in DB: merge + snapshot, 404, 409); commit.

### Task 3: commerce — product form split, create, admin
- [ ] `JoshActionsController.updateProduct`: owned → content keys to `ProductContentsService.edit`, price (4a) to prices,
  the rest relayed. `createProduct`: owned → after josh creates, record the content keys sent (source `create`).
- [ ] commerce-admin `JoshProductDetail`: content fields added to the form (ingredients, allergens, expiry, usage,
  pairing, shelf life, organic, short code, cost, reorder); when owned, values shown from commerce's row over josh's copy.
  `JoshProducts.detail` selects the extra columns.
- [ ] Commit.

### Task 4: commerce — import and parity
- [ ] `import-from-josh -- contents` (`JOSH_CONTENT_SQL` → `product_contents`, paged by SKU, source `import`).
- [ ] `npm run content-parity`: per SKU and key, commerce row vs josh (only keys commerce holds; SKUs commerce lacks
  are listed as `joshOnly`, not a failure).
- [ ] Commit.

### Task 5: docs, verification, as built
- [ ] Contract (`product.content.snapshot`), env, runbook `docs/runbooks/stage4b-content-cutover.md`.
- [ ] Scratch DBs: import + parity; edit → snapshot in outbox; josh apply on a scratch copy (names in th / en,
  ingredients, cost), older version refused.
- [ ] Full suites `--maxWorkers=2`; as built; drop scratch DBs; commit.

## As built (2026-10-08)

- **Scope as planned.** Content = fields only staff write; josh applies it under its existing `COMMERCE_OWNS_CATALOG`
  (no new josh flag). Commerce's switch is `COMMERCE_OWNS_PRODUCT_CONTENT`; `GET /api/ownership` → `productContent`.
- **Storage:** one jsonb per SKU (`product_contents.fields`), validated per key in `content-fields.ts` (names required
  ≤255, text ≤20k, short strings by josh's column length, cost 2 decimals, counts int). `JOSH_CONTENT_SQL` builds the
  same object from josh for import and parity. Snapshot aggregate = uuid from md5(`content:<sku>`).
- **Product form:** content keys are validated before anything is written (400 → nothing saved anywhere), then saved in
  commerce; price (4a) and the rest of the form follow as before. New fields in the form (ingredients, allergens, expiry,
  usage, pairing, shelf life, organic, short code, cost, reorder); when owned the form shows commerce's row over josh's copy.
- **Found in the browser check:** the form's SKU lookup used only the catalog copy; a product not copied yet (just
  created, or the copy lags) failed with 404 — now it is pulled from josh once before giving up (also fixes 4a's price path).
- **Create through commerce:** content sent with a new product is recorded in commerce (source `create`). The josh
  `create` action lives on josh's unmerged `feat/commerce-owns-catalog`.

**Verification:** josh — `commerce-content.service.spec` (apply, stale, 409, 400, 422), erp-events / product-category
specs; a real snapshot made by commerce applied on a copy of the dev DB: th name inserted, en name / description
updated, ingredients / cost / alert level written, older version refused. commerce — content-fields spec, opt-in
`product-contents.service.db.spec.ts`, relay controller spec; import 5,888 SKUs from the local josh DB and
`content-parity` → 5,888 same (and it flags an edited / deleted row); after josh applied the snapshot, parity still
matched. Scratch API + admin: the form shows the new fields, a save goes to commerce (outbox has the snapshot), an
empty name is a 400. Scratch DBs dropped.
