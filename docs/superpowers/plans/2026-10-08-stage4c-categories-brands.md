# Stage 4c — category tree and brand names owned by commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce is the writer of the shop's category tree (create, rename, image, homepage / sort settings,
reorder, delete) and of brand names. josh keeps a copy fed by `category.tree.snapshot` and `brand.snapshot`.

**Architecture:** commerce stores `product_categories` and `product_brands` with josh's column names and unique
indexes, and runs josh's category rules on them (title case, same-level name / cat_code clash, sort → code / path /
path_code rebuild by the same recursive SQL). Every category write publishes the **whole tree** (~240 rows) as one
snapshot in the same transaction — a reorder changes many codes at once and josh's `category_code` unique index is not
deferrable, so josh applies the tree in one transaction (delete absent rows → park codes → upsert). Brand edits publish
one `brand.snapshot` per brand. commerce-admin's hosted josh pages send category / brand writes to commerce once
`GET /api/ownership` says `categories` (same routes and envelopes as josh); reads stay on josh.

**Tech Stack:** NestJS 10, TypeORM, Postgres, Redis (josh caches), React (commerce-admin), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §2.4 (category / brand
controllers) and §4.2 row 4 (category / brand group).

## Global Constraints

- Not in 4c: which category / brand a product has (`category_id`, `brand_code` — the ERP sends them; they move with the
  ERP product queue), category ↔ cuisine links (cuisine module), category sheet import (already 403 under the catalog switch).
- New switch both sides: `COMMERCE_OWNS_CATEGORIES` (josh: 403 on its category / brand write routes and accept the
  snapshots; commerce: accept writes). Off by default; off = josh edits again (rollback).
- An empty tree snapshot is refused (a wrong database must never wipe josh's categories).
- Light tests (`--runInBand`, `--maxWorkers=2`, scratch DBs).
- Branches (stacked on 4b): commerce `feat/stage4c-categories` from `feat/stage4b-content`, josh
  `feat/commerce-owns-categories` from `feat/commerce-owns-content`.

---

### Task 1: josh — flag, guards, apply snapshots
- [ ] `isCommerceOwningCategories()` + `CommerceOwnedCategoriesGuard`; on `POST /product-category`, `PUT level1-order`,
  `PUT :id/children-order`, `PATCH :id`, `DELETE :id`, `PATCH /brands/:id`.
- [ ] `CommerceCategoriesService.applyTree({ rows, version })`: 409 unless owned, 400 on empty; one transaction:
  `applyIfNewer(m, 'category.tree', 'all', version)`, delete rows not in the snapshot, park `category_code` / `cat_code`
  of the rest as `tmp-<id>`, upsert all rows (`jsonb_populate_recordset(NULL::product_category, …)`). Then category caches
  (`category:*`, version key, shoppable ids, catalog response).
- [ ] `applyBrand({ id, brand_code, brand_name_th, brand_name_en, version })`: `applyIfNewer('brand', id)`, upsert by id.
- [ ] Handlers `category.tree.snapshot`, `brand.snapshot`; specs; commit.

### Task 2: commerce — tables, services, events, API
- [ ] Migration `1794900000000-ProductCategoriesBrands`: both tables with josh's columns and unique indexes.
- [ ] `ProductCategoriesService`: create / update / reorderLevel1 / reorderChildren / remove (josh's rules), each
  publishing `CategoryTreeSnapshot` (aggregate = fixed uuid) in the transaction; `ProductBrandsService.update` publishing
  `BrandSnapshot` (aggregate = brand id).
- [ ] Controllers on josh's routes: `POST /api/product-category`, `PUT /api/product-category/level1-order`,
  `PUT /api/product-category/:id/children-order`, `PATCH|DELETE /api/product-category/:id`, `PATCH /api/brands/:id`
  (admin), josh's response envelopes; `GET /api/ownership` → `categories`.
- [ ] Specs (unit rules; opt-in DB: create / rename rebuild / reorder / delete / brand + snapshots); commit.

### Task 3: commerce-admin, import, parity
- [ ] josh-admin `product-category.api.ts` / `brand.api.ts`: writes go to commerce when `ownership().categories`.
- [ ] `import-from-josh -- categories` (both tables replaced in one transaction); `npm run category-parity` (all columns
  by id, both tables).
- [ ] Commit.

### Task 4: docs, verification, as built
- [ ] Contract, env, runbook `docs/runbooks/stage4c-categories-cutover.md`.
- [ ] Scratch DBs: import + parity; reorder / rename in commerce → josh applies the tree → parity.
- [ ] Full suites; as built; drop scratch DBs; commit.

## As built (2026-10-08)

- **Scope as planned.** New switch `COMMERCE_OWNS_CATEGORIES` on both sides; `GET /api/ownership` → `categories`.
- **commerce:** `product_categories` / `product_brands` with josh's columns and unique indexes; `ProductCategoriesService`
  ports josh's create / update / reorder level 1 / reorder children / delete (title case, same-level name and cat_code
  clash, the same recursive rebuild SQL, codes parked before a reorder) and brand name edits. Category writes take an
  advisory lock and publish the whole tree (fixed aggregate id) in the same transaction; brand edits publish that brand.
  Routes and answers match josh's, so the hosted josh category / brand pages only switch client
  (`product-category.api.ts`, `brand.api.ts` → commerce when `ownership().categories`). Reads stay on josh.
- **josh:** the five category write routes and the brand edit answer 403 under the switch; `CommerceCategoriesService`
  applies the tree in one transaction (delete absent → park `category_code` / `cat_code` → upsert via
  `jsonb_populate_recordset`), refuses an empty tree, then clears the category caches; brands upsert by id.

**Verification:** josh — `commerce-categories.service.spec`, erp-events specs. commerce — opt-in
`product-categories.service.db.spec.ts` (create / title case / cat_code / same-level clash, rename rebuilds the branch's
paths, children reorder swaps codes, level-1 reorder needs the whole row, brand snapshot). Scratch copies: import 236
categories + 181 brands, `category-parity` 0; then real edits in commerce (reverse 9 siblings, rename, new category,
Thai name, brand name) → the tree snapshot applied on josh's copy without a unique-index clash, an older tree refused →
`category-parity` 0 on 237 / 181. commerce full suite (`--maxWorkers=2`): 1295 passed (28 opt-in skipped).
josh full suite (`--maxWorkers=2`): 6739 passed; only the known `pii-leak.spec` fails (pre-existing). Scratch DBs dropped.
