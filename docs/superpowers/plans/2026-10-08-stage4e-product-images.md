# Stage 4e — product images owned by commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce is the writer of each product's image gallery (which images, in what order): staff upload / remove /
reorder on the product page, bulk upload by file name, and ERP `PUT /erp/products/image`. josh keeps the gallery copy
(`product_media`) fed by `product.images.snapshot`, and keeps making the list thumbnails.

**Architecture:** commerce stores `product_images (sku PK, images jsonb = ordered URLs)`. Files go to the same S3 bucket
and key shapes josh uses (env `S3_MEDIA_BUCKET` / `AWS_*` / `MEDIA_BASE_URL`, like winback's photo upload): product page
`uploads/products/<name>`, bulk `{sku}/{sku}_{ts}-{rand}{ext}`. Every change publishes the whole gallery in the same
transaction. josh replaces the SKU's image rows in one transaction (newest version only), then — best effort, after
commit — makes the `*_thumb.webp` of any new josh-bucket image that has none (sharp stays in josh), and clears caches.

**Tech Stack:** NestJS 10, TypeORM, Postgres, S3, Redis (josh caches), React (commerce-admin), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §4.2 row 4 (last group: images).

## Global Constraints

- New switch both sides: `COMMERCE_OWNS_PRODUCT_IMAGES`. Off = josh edits images as before.
- Staff galleries keep josh's limit (3 images on the product page); the ERP may send more (josh never capped it).
- Not in 4e: josh's bulk-upload history / restore / prune of replaced images (stays in josh for images uploaded there;
  commerce's bulk upload has no undo log — a replaced image just leaves the gallery), videos (none in the data).
- Light tests (`--runInBand`, `--maxWorkers=2`, scratch DBs).
- Branches (stacked on 4d): commerce `feat/stage4e-images`, josh `feat/commerce-owns-images`.

---

### Task 1: josh — stop writing galleries, apply the snapshot
- [ ] `isCommerceOwningProductImages()`; owned → `PATCH /product/:id` with images / `removed_media_ids` → 403,
  `POST /product/images/bulk-upload` and `…/logs/:id/restore` → 403, ERP `handleProductImage` skips (the call is
  forwarded to commerce as `erp.fallback.received`).
- [ ] `CommerceImagesService.apply({ sku, images, version })`: 409 unless owned; transaction: lock SKU (422 unknown),
  `applyIfNewer('product.images', sku)`, delete image rows, insert in order; after commit thumbs (best effort) +
  `refreshProductCaches` + facet / catalog caches. Handler `product.images.snapshot`. Specs; commit.

### Task 2: commerce — table, storage, service, API
- [ ] Migration `1795100000000-ProductImages`.
- [ ] `ProductImageStorage` (S3 put, josh key shapes, 5 MB, jpg / png / gif / webp).
- [ ] `ProductImagesService`: `get`, `upload(sku, files)` (append, ≤3), `set(sku, urls)` (remove / reorder: only URLs
  already in the gallery, ≤3), `bulk(files, mode)` (josh's `sku_<n>` rule, append / replace), `fromErp(m, body)`
  (replace, relay + fallback replay); publish `ProductImagesSnapshot`. Ownership `productImages`.
- [ ] Routes: `GET /api/product-images/:sku`, `POST …/:sku/upload`, `PUT …/:sku`, `POST /api/product-images/bulk-upload`.
- [ ] Specs; commit.

### Task 3: commerce-admin, import, parity
- [ ] `ProductImages` on the product page: commerce routes when owned (upload, remove, reorder).
- [ ] `import-from-josh -- images`, `npm run image-parity`. Commit.

### Task 4: docs, verification, as built
- [ ] Contract, env, runbook `docs/runbooks/stage4e-images-cutover.md`.
- [ ] Scratch: import + parity; set / ERP replace → snapshot → josh apply → parity.
- [ ] Full suites; as built; drop scratch DBs; commit.

## As built (2026-10-08)

- **Scope as planned.** New switch `COMMERCE_OWNS_PRODUCT_IMAGES` both sides; `GET /api/ownership` → `productImages`.
- **commerce:** `product_images` (ordered URLs). `putMediaObject` (shared-kernel) puts files in josh's bucket with josh's
  env names — winback's photo upload now uses it too. `ProductImagesService`: product-page upload (≤3, 5 MB, jpg / png /
  gif / webp, key `uploads/products/images-<ts>-<rand>.<ext>`), set (remove / reorder known images only), bulk by file
  name (josh's `SKU_<n>` rule, append / replace, `{ appended, failed }`, key `{sku}/{sku}_<ts>-<rand>.<ext>`), ERP image
  call (full replace, from the relay and the fallback replay). A SKU without a gallery starts from the catalog copy's image.
  Every change publishes the whole gallery. The product page and josh-admin's bulk upload switch to commerce when owned.
- **josh:** image edits on `PATCH /product/:id`, bulk upload / restore → 403; the ERP image call is skipped;
  `CommerceImagesService` replaces the SKU's image rows in order, then `ensureProductImageThumb` for josh-bucket images
  (best effort) and the caches.
- **Prod data:** `docs/runbooks/prod-data-from-josh.md` lists every import / backfill from **josh prod** (read-only) per
  stage, with its parity check (asked for during this stage).

**Verification:** josh — `commerce-images.service.spec` (order, thumbs only for josh-bucket images, stale, 409 / 422,
edit guard), erp / product specs. commerce — opt-in `product-images.service.db.spec.ts` (S3 mocked: upload cap / size,
set, bulk replace + failures, ERP replace, switch off), winback specs after the upload refactor. Scratch copies: import
5,888 galleries, `image-parity` 0; upload + reorder in commerce → josh applied the same order (thumbs requested for 2) →
parity 0. commerce full suite (`--maxWorkers=2`): 1300 passed (33 opt-in skipped).
josh full suite (`--maxWorkers=2`): 6749 passed; only the known `pii-leak.spec` fails (pre-existing). Scratch DBs dropped.
