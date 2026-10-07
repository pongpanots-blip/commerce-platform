# Stage 1 — commerce owns competitor / scraping / research — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce becomes the only writer of competitor prices, scraping sources/items and marketing research. josh's copies of these features answer 403, and josh's crons stop, behind `COMMERCE_OWNS_COMPETITOR`.

**Architecture:**
- commerce already has older ports of all three features. This plan:
  1. brings them up to josh `origin/main`: the review grid / overview / export / match flow, two scraping fixes and the research social / AI-summary work;
  2. replaces the one remaining josh-DB read (the catalog copy `josh_catalog_products`) with a `catalog.snapshot` event on the stage-0 pipe.
- josh only gains a catalog trigger and the flag. No shop page or checkout reads these tables (checked: only `app.module.ts` imports them), so josh keeps no read copy.

**Tech Stack:**
- josh: NestJS 10, TypeORM 0.3, Postgres 16
- commerce: NestJS 10, TypeORM raw-SQL migrations, React (commerce-admin), jest

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` (§2.4 flag row `COMMERCE_OWNS_COMPETITOR`, §2.5, §4.1, §4.2 row 1)

## Global Constraints

- josh changes are additive, default off. Only the literal `'true'` turns on a flag. Turning the flag off is the rollback.
- josh must not get slower:
  - the catalog trigger fires only when catalog columns actually change, never on qty / stock writes;
  - one INSERT per changed row.
- `/api/erp` in josh is never gated.
- commerce has no `JOSH_DATABASE_URL` in prod. No runtime code may depend on it. The one-off cutover import (Task 10) is run once by ops and is not a bridge.
- Match fingerprints must stay byte-for-byte equal to josh's `catalogFingerprint`, so pairs verified in josh stay verified.
- Copy josh code from `origin/main` at the commits named in each task, not from a local branch.

## Deviations from the spec (decided here — object before Task 10 if you disagree)

1. **No 1-week shadow for this group.**
   - A shadow would mean both systems scrape the same sites twice, and the competitor sites would see double traffic.
   - Cutover is freeze-and-copy instead: flag on in josh (writes + crons stop) → one-off import → turn on the commerce crons. Write downtime is a few minutes.
   - The parity check is done once, on counts and fingerprints, right after the import (Task 10).
2. **Historical competitor rows move with the existing one-off CLI `npm run import-from-josh`, not via the event pipe.**
   - These rows have no writer in josh after the flag, so they need a single copy, not a stream.
   - The CLI already exists, is read-only and is idempotent.
   - Only the catalog (which josh keeps writing) goes through the pipe.

## File map

**josh** (worktree from `origin/main`, branch `feat/commerce-owns-competitor`):

| File | Change |
|---|---|
| `apps/backend/src/migrations/1792320000000-CommerceOutboxCatalog.ts` | new: `commerce_outbox_catalog()` + triggers on product_inventory / product_translation / product_media / product_category |
| `app/commerce-events/commerce-snapshot.builder.ts` | `build('catalog', ids)` |
| `app/commerce-events/commerce-outbox.drainer.ts` | group `catalog`; envelope `catalog.deleted` |
| `app/commerce-events/commerce-backfill.controller.ts` | group `catalog` |
| `app/erp/commerce-ownership.flag.ts` | `isCommerceOwningCompetitor()`, `CommerceOwnedCompetitorGuard` |
| `app/competitor-prices/competitor-prices.controller.ts`, `scraping.controller.ts`, `app/marketing-research/marketing-research.controller.ts` | guard on writes / whole scraping + worker controllers |
| `competitor-prices.service.ts` (`hourlyRefresh`), `scraping.service.ts` (`tick`), `marketing-research.cron.ts` (`tick`) | return early when the flag is on |

**commerce** (this worktree, branch `feat/stage1-competitor-ownership`):

| File | Change |
|---|---|
| `src/migrations/1794200000000-CompetitorOwnership.ts` | new: catalog copy columns + `source_version`; competitor_prices size columns; `competitor_match_rejections`, `competitor_match_reviews` |
| `connector/josh/josh-catalog-product.entity.ts` | new columns |
| `connector/josh/events/josh-events.service.ts` | `catalog.snapshot`, `catalog.deleted` |
| `connector/josh/josh-catalog-sync.service.ts` | `syncSku` / `syncId` read the local copy when no replica is configured |
| `integration/competitor-prices/competitor-size.ts`, `pack-order-price.ts` | port from josh |
| `integration/competitor-prices/competitor-prices.service.ts`, `.controller.ts`, `competitor-price.entity.ts`, `competitor-price.dto.ts` | port the josh `origin/main` version onto `JoshCatalogProduct` |
| `integration/competitor-prices/competitor-review.service.ts` | port |
| `platform/scraping/infrastructure/public-web.reader.ts`, `application/scraping.service.ts` | fixes from josh d6995670 + 547bd2b7 |
| `platform/marketing-research/**` | social connectors, AI summary, AI worker, Gemini key fix |
| `apps/commerce-admin/src/app/pages/CompetitorPrices.tsx` (+ `CompetitorReviewGrid.tsx`), `src/lib/api*` | review grid / overview / export / match-queue UI |
| `src/cli/import-from-josh.ts` | add rejections / reviews tables |
| `docs/runbooks/stage1-competitor-cutover.md` | cutover steps |

---

## Field mapping used by every port task (josh `ProductInventory` → commerce `JoshCatalogProduct`)

| josh | commerce |
|---|---|
| `product_inventory_id` | `id` |
| `product_inventory_sku` | `sku` |
| `product_status` | `status` |
| `brand_code`, `brand_name`, `country_code_source`, `storage_temperature`, `packaging_type`, `pack_size`, `units_per_box`, `weight_per_unit`, `selling_unit`, `vat_type` | camelCase of the same (`brandCode` …) |
| `selling_unit_price` | `sellingUnitPrice` (string) |
| `ordering_price` | `orderingPrice` (string, new) |
| `order_taking_unit` | `orderTakingUnit` (new) |
| `translations[]` (`language_code`, `product_name`, …) | `translations` jsonb, same keys |
| `productCategory.category_name_th` / `_en` | `categoryNameTh` / `categoryNameEn` (new) |
| first `product_media` image (`media_type='image'`, lowest `sort_order`) `.source` | `imageUrl` (new) |
| `updated_at` | `joshUpdatedAt` |
| `find({ where: { product_status: 'active' } })` | `find({ where: { status: 'active', removedAt: IsNull() } })` |

The helpers ported in Task 3 take a plain object with josh's snake_case keys. Commerce calls them through one adapter (`toInventoryShape`, Task 3) instead of rewriting their bodies. That keeps the bodies identical to josh, so future josh fixes can be diffed in.

---

### Task 1: josh — `catalog.snapshot` on the pipe

**Files:**
- Create: `apps/backend/src/migrations/1792320000000-CommerceOutboxCatalog.ts`
- Modify: `apps/backend/src/app/commerce-events/commerce-snapshot.builder.ts`, `commerce-outbox.drainer.ts`, `commerce-backfill.controller.ts`
- Test: `commerce-outbox.trigger.db.spec.ts` (extend), `commerce-snapshot.builder.spec.ts` (extend), `commerce-outbox.drainer.spec.ts` (extend)

**Interfaces:**
- Produces:
  - outbox types `catalog` (aggregate = product_inventory_id) and `catalog.deleted`;
  - envelope `{type:'catalog.snapshot', aggregateId, version, occurredAt, data: CatalogRow}`, where `CatalogRow` keys are exactly `id, sku, status, brand_code, brand_name, country_code_source, storage_temperature, packaging_type, pack_size, units_per_box, weight_per_unit, selling_unit, vat_type, selling_unit_price, ordering_price, order_taking_unit, category_name_th, category_name_en, image_url, updated_at, translations`;
  - `{type:'catalog.deleted', aggregateId, version: <outbox row id>, data:{id}}`.

- [ ] **Step 1: Write the failing trigger test** (append to `commerce-outbox.trigger.db.spec.ts`; same opt-in `JOSH_SCOPE_TEST_DATABASE_URL` harness as stage 0)

```ts
it('catalog: name change enqueues, qty change does not', async () => {
  const id = await anyProductId(db);
  await db.query(`DELETE FROM commerce_outbox`);
  await db.query(`UPDATE product_inventory SET product_inventory_quantity = product_inventory_quantity + 1 WHERE product_inventory_id = $1`, [id]);
  expect(await outbox(db, 'catalog')).toEqual([]);
  await db.query(`UPDATE product_inventory SET pack_size = coalesce(pack_size,'') || 'x' WHERE product_inventory_id = $1`, [id]);
  expect(await outbox(db, 'catalog')).toEqual([id]);
});
it('catalog: translation and image changes enqueue the parent product', async () => {
  const id = await anyProductId(db);
  await db.query(`DELETE FROM commerce_outbox`);
  await db.query(`UPDATE product_translation SET product_name = product_name || ' ' WHERE product_inventory_id = $1`, [id]);
  await db.query(`INSERT INTO product_media (product_inventory_id, media_type, source, sort_order) VALUES ($1, 'image', 'https://x/y.jpg', 999)`, [id]);
  expect(new Set(await outbox(db, 'catalog'))).toEqual(new Set([id]));
});
it('catalog: delete enqueues catalog.deleted', async () => {
  const id = await insertThrowawayProduct(db);
  await db.query(`DELETE FROM commerce_outbox`);
  await db.query(`DELETE FROM product_inventory WHERE product_inventory_id = $1`, [id]);
  expect(await outbox(db, 'catalog.deleted')).toEqual([id]);
});
```

`outbox(db, type)` returns `aggregate_id`s of that type ordered by id. `anyProductId` / `insertThrowawayProduct` are small helpers in the same spec file: the first does `SELECT product_inventory_id … LIMIT 1`; the second does an INSERT with the NOT NULL columns of `product_inventory` copied from an existing row and a new uuid + sku. Run each test inside the stage-0 harness's rollback transaction.

- [ ] **Step 2: Run, expect FAIL** (no trigger yet)

Run: `JOSH_SCOPE_TEST_DATABASE_URL=… npx jest apps/backend/src/app/commerce-events/commerce-outbox.trigger.db.spec.ts`

- [ ] **Step 3: Migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

const CATALOG_COLS = ['product_inventory_sku', 'product_status', 'brand_code', 'brand_name', 'country_code_source',
  'storage_temperature', 'packaging_type', 'pack_size', 'units_per_box', 'weight_per_unit', 'selling_unit', 'vat_type',
  'selling_unit_price', 'ordering_price', 'order_taking_unit', 'category_id'];
const changed = CATALOG_COLS.map((c) => `OLD.${c} IS DISTINCT FROM NEW.${c}`).join(' OR ');

/**
 * Stage 1: commerce keeps its catalog copy (competitor matching) from these events instead of reading josh's DB.
 * UPDATE OF + WHEN: stock / qty / timestamp writes never fire it (spec rule "josh must not get slower").
 */
export class CommerceOutboxCatalog1792320000000 implements MigrationInterface {
  name = 'CommerceOutboxCatalog1792320000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE OR REPLACE FUNCTION commerce_outbox_catalog() RETURNS trigger AS $$
      BEGIN
        IF TG_TABLE_NAME = 'product_inventory' THEN
          IF TG_OP = 'DELETE' THEN
            INSERT INTO commerce_outbox (type, aggregate_id) VALUES ('catalog.deleted', OLD.product_inventory_id);
          ELSE
            INSERT INTO commerce_outbox (type, aggregate_id) VALUES ('catalog', NEW.product_inventory_id);
          END IF;
        ELSIF TG_TABLE_NAME IN ('product_translation', 'product_media') THEN
          INSERT INTO commerce_outbox (type, aggregate_id)
            VALUES ('catalog', CASE WHEN TG_OP = 'DELETE' THEN OLD.product_inventory_id ELSE NEW.product_inventory_id END);
        ELSIF TG_TABLE_NAME = 'product_category' THEN
          INSERT INTO commerce_outbox (type, aggregate_id)
            SELECT 'catalog', p.product_inventory_id FROM product_inventory p WHERE p.category_id = NEW.category_id_uuid;
        END IF;
        RETURN NULL;
      END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_catalog_ins AFTER INSERT OR DELETE ON product_inventory
      FOR EACH ROW EXECUTE FUNCTION commerce_outbox_catalog()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_catalog_upd AFTER UPDATE OF ${CATALOG_COLS.join(', ')} ON product_inventory
      FOR EACH ROW WHEN (${changed}) EXECUTE FUNCTION commerce_outbox_catalog()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_catalog_tr AFTER INSERT OR UPDATE OR DELETE ON product_translation
      FOR EACH ROW EXECUTE FUNCTION commerce_outbox_catalog()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_catalog_media AFTER INSERT OR UPDATE OR DELETE ON product_media
      FOR EACH ROW EXECUTE FUNCTION commerce_outbox_catalog()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_catalog_cat AFTER UPDATE OF category_name_th, category_name_en ON product_category
      FOR EACH ROW WHEN (OLD.category_name_th IS DISTINCT FROM NEW.category_name_th OR OLD.category_name_en IS DISTINCT FROM NEW.category_name_en)
      EXECUTE FUNCTION commerce_outbox_catalog()`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const [t, table] of [['commerce_outbox_catalog_cat', 'product_category'], ['commerce_outbox_catalog_media', 'product_media'],
      ['commerce_outbox_catalog_tr', 'product_translation'], ['commerce_outbox_catalog_upd', 'product_inventory'],
      ['commerce_outbox_catalog_ins', 'product_inventory']]) await q.query(`DROP TRIGGER IF EXISTS ${t} ON ${table}`);
    await q.query(`DROP FUNCTION IF EXISTS commerce_outbox_catalog()`);
  }
}
```

Before running, confirm the timestamp is unused: `git ls-tree origin/main apps/backend/src/migrations | grep 17923200`. A product_media row whose product was deleted in the same transaction: the product's `catalog.deleted` arrives with a higher version and wins.

- [ ] **Step 4: Run trigger tests, expect PASS**

- [ ] **Step 5: Builder test** (append to `commerce-snapshot.builder.spec.ts`, same mocked-`db.query` style as the order/customer cases)

```ts
it('catalog: one snapshot per product with translations, category names and first image', async () => {
  db.query.mockResolvedValueOnce([{ id: 'p1', sku: 'S1', version: '42', translations: [{ language_code: 'th', product_name: 'ก' }],
    category_name_th: 'หมวด', image_url: 'https://x/1.jpg' }]);
  const [snap] = await builder.build('catalog', ['p1']);
  expect(snap).toMatchObject({ type: 'catalog.snapshot', aggregateId: 'p1', version: '42',
    data: { sku: 'S1', category_name_th: 'หมวด', image_url: 'https://x/1.jpg' } });
  expect(snap.data).not.toHaveProperty('version');
  expect(db.query.mock.calls[0][0]).toContain('product_inventory_id = ANY($1::uuid[])');
});
```

- [ ] **Step 6: Builder implementation** (in `commerce-snapshot.builder.ts`)

```ts
export type SnapshotType = 'order' | 'customer' | 'catalog';
// Snapshot.type gains 'catalog.snapshot'

/** Same fields as commerce JoshCatalogSyncService SELECT plus what the review grid shows (category, first image). */
const CATALOG = `p.product_inventory_id::text AS id, p.product_inventory_sku AS sku, p.product_status AS status,
  p.brand_code, p.brand_name, p.country_code_source, p.storage_temperature, p.packaging_type, p.pack_size,
  p.units_per_box, p.weight_per_unit, p.selling_unit, p.vat_type, p.selling_unit_price, p.ordering_price, p.order_taking_unit,
  c.category_name_th, c.category_name_en, p.updated_at,
  (SELECT m.source FROM product_media m WHERE m.product_inventory_id = p.product_inventory_id AND m.media_type = 'image'
     ORDER BY m.sort_order LIMIT 1) AS image_url,
  COALESCE((SELECT json_agg(json_build_object('language_code', t.language_code, 'product_name', t.product_name,
    'product_description', t.product_description, 'product_detail', t.product_detail) ORDER BY t.language_code)
    FROM product_translation t WHERE t.product_inventory_id = p.product_inventory_id), '[]'::json) AS translations`;

// in build(), before the order branch:
if (type === 'catalog') {
  const rows = await this.db.query<Row[]>(
    `SELECT ${CATALOG}, nextval('commerce_snapshot_seq')::text AS version
       FROM product_inventory p LEFT JOIN product_category c ON c.category_id_uuid = p.category_id
      WHERE p.product_inventory_id = ANY($1::uuid[])`, [ids]);
  return rows.map(({ version, ...data }) => ({ type: 'catalog.snapshot' as const, aggregateId: data.id as string,
    version: version as string, occurredAt, data }));
}
```

- [ ] **Step 7: Drainer test + change.**

Test:
- three `catalog` rows for the same product collapse into one `build('catalog', [id])` call;
- a `catalog.deleted` row sends `{type:'catalog.deleted', version: row.id, data:{id}}`.

Change:
- in `groups()`, treat `catalog` like `order` / `customer`: `['order','customer','catalog'].includes(r.type)`;
- in `envelope()`, use the same includes check for the build branch, and add

```ts
if (row.type === 'catalog.deleted') {
  return { type: 'catalog.deleted', aggregateId: row.aggregate_id, version: row.id, occurredAt, data: { id: row.aggregate_id } };
}
```

`version: row.id` is a bigserial from a different sequence than `commerce_snapshot_seq`. Commerce compares versions per aggregate, so a delete could lose to a later-numbered snapshot from the seq. To prevent that, make the deleted version win by taking it from the shared seq as well: `version: (await this.db.query("SELECT nextval('commerce_snapshot_seq')::text AS v"))[0].v`. Add a drainer test asserting the `nextval` call.

- [ ] **Step 8: Backfill group.** Add to `GROUPS` in `commerce-backfill.controller.ts`:

```ts
catalog: `INSERT INTO commerce_outbox (type, aggregate_id) SELECT 'catalog', p.product_inventory_id FROM product_inventory p`,
```

Update the error text to `(order | customer | catalog)`. Extend `commerce-backfill.controller.spec.ts` with `group:'catalog'` → `{ enqueued }`.

- [ ] **Step 9: Run** `npx jest apps/backend/src/app/commerce-events` → PASS.

- [ ] **Step 10: Commit** `feat(commerce-events): catalog.snapshot for commerce's competitor catalog copy`

---

### Task 2: josh — `COMMERCE_OWNS_COMPETITOR`

**Files:**
- Modify: `app/erp/commerce-ownership.flag.ts`, `competitor-prices.controller.ts`, `scraping.controller.ts`, `marketing-research.controller.ts`, `competitor-prices.service.ts:680`, `scraping.service.ts:362`, `marketing-research.cron.ts:20`
- Test: `app/erp/commerce-ownership.flag.spec.ts` (create if absent), `competitor-ownership.spec.ts` (new, in `competitor-prices/`)

**Interfaces:**
- Produces: `isCommerceOwningCompetitor(): boolean` and `CommerceOwnedCompetitorGuard`.

- [ ] **Step 1: Failing tests**

```ts
// competitor-ownership.spec.ts
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CompetitorPricesController } from './competitor-prices.controller';
import { ScrapingController } from './scraping.controller';
import { MarketingResearchController, MarketingResearchWorkerController } from '../marketing-research/marketing-research.controller';
import { CommerceOwnedCompetitorGuard, isCommerceOwningCompetitor } from '../erp/commerce-ownership.flag';

const guarded = (cls: any, method?: string) =>
  (Reflect.getMetadata(GUARDS_METADATA, method ? cls.prototype[method] : cls) ?? []).includes(CommerceOwnedCompetitorGuard);

describe('COMMERCE_OWNS_COMPETITOR', () => {
  afterEach(() => delete process.env.COMMERCE_OWNS_COMPETITOR);
  it('only literal true turns it on', () => {
    process.env.COMMERCE_OWNS_COMPETITOR = 'TRUE'; expect(isCommerceOwningCompetitor()).toBe(false);
    process.env.COMMERCE_OWNS_COMPETITOR = 'true'; expect(isCommerceOwningCompetitor()).toBe(true);
  });
  it('guards every competitor-prices write, no read', () => {
    for (const m of ['reviewCell', 'reviewFinish', 'create', 'update', 'match', 'confirm', 'verify', 'capture', 'refresh', 'remove']) expect(guarded(CompetitorPricesController, m)).toBe(true);
    for (const m of ['list', 'reviewGrid', 'overview', 'overviewExport', 'catalog', 'matchQueue', 'candidates']) expect(guarded(CompetitorPricesController, m)).toBe(false);
  });
  it('guards the whole scraping controller and research worker; research writes only', () => {
    expect(guarded(ScrapingController)).toBe(true);
    expect(guarded(MarketingResearchWorkerController)).toBe(true);
    for (const m of ['create', 'update', 'archive', 'startRun', 'keep', 'summarize']) expect(guarded(MarketingResearchController, m)).toBe(true);
  });
});
```

The method names in the arrays must equal the handler names in the controllers. Read them from `git show origin/main:apps/backend/src/app/competitor-prices/competitor-prices.controller.ts` (lines 21–77) and the research controller (lines 59–148), and fix the arrays to match before running. Also add one service test per cron: with the flag on, `hourlyRefresh()` / `tick()` resolve without touching the repository (`expect(prices.find).not.toHaveBeenCalled()`).

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

In `commerce-ownership.flag.ts` (also add a doc-comment line to the header list):

```ts
/** COMMERCE_OWNS_COMPETITOR=true — competitor prices, scraping and research are written in commerce-admin; josh's write routes answer 403 and its crons stop. */
export function isCommerceOwningCompetitor(): boolean {
  return process.env.COMMERCE_OWNS_COMPETITOR === 'true';
}
export const CommerceOwnedCompetitorGuard = CommerceOwned('COMMERCE_OWNS_COMPETITOR', 'ราคาคู่แข่ง การเก็บข้อมูลเว็บ และ research ย้ายไป commerce-admin แล้ว');
```

- Add `@UseGuards(CommerceOwnedCompetitorGuard)`:
  - on each write handler of `CompetitorPricesController` and `MarketingResearchController`;
  - at class level on `ScrapingController` and `MarketingResearchWorkerController`, appended after the existing class guards.
- First line of `hourlyRefresh()`, scraping `tick()` and `MarketingResearchCron.tick()`: `if (isCommerceOwningCompetitor()) return;`

Check that `MarketingResearchCron.tick` is what drives `ResearchFreeWorker.tick` and `ResearchAiWorker.tick`. If either worker is scheduled elsewhere (`git grep -n "Worker.*tick\|\.tick()" origin/main -- apps/backend/src/app/marketing-research`), add the same early return there.

- [ ] **Step 4: Run** `npx jest apps/backend/src/app/competitor-prices apps/backend/src/app/marketing-research apps/backend/src/app/erp` → PASS.

- [ ] **Step 5: Commit** `feat(competitor): COMMERCE_OWNS_COMPETITOR — 403 writes, stop crons (default off)`

Open the josh PR after Task 2 (Tasks 1–2 are the whole josh side).

---

### Task 3: commerce — catalog copy from events + schema for the review grid

**Files:**
- Create: `apps/commerce-platform/src/migrations/1794200000000-CompetitorOwnership.ts`
- Modify: `connector/josh/josh-catalog-product.entity.ts`, `connector/josh/events/josh-events.service.ts`, `connector/josh/josh-catalog-sync.service.ts`, `integration/competitor-prices/competitor-price.entity.ts`
- Create: `integration/competitor-prices/competitor-match.entity.ts` (`CompetitorMatchRejection`, `CompetitorMatchReview`)
- Test: `connector/josh/events/josh-events.service.spec.ts` (extend), `josh-catalog-sync.service.spec.ts` (create)

**Interfaces:**
- Consumes: the Task 1 envelope.
- Produces:
  - `JoshCatalogProduct` gains `orderingPrice: string|null`, `orderTakingUnit: string|null`, `categoryNameTh: string|null`, `categoryNameEn: string|null`, `imageUrl: string|null`, `sourceVersion: string`;
  - `CompetitorPrice` gains `competitorUnit: 'kg'|'l'|'piece'`, `competitorQtyMin: string|null`, `competitorQtyMax: string|null`, `competitorPackCount: number`;
  - entities `CompetitorMatchRejection {id, productId, sourceUrl, createdBy, createdAt}` and `CompetitorMatchReview {productId, reviewedBy, reviewedAt}`.

- [ ] **Step 1: Failing apply tests** (append to `josh-events.service.spec.ts`, using the same real-DB / mocked-manager style as the existing order/customer cases in that file)

```ts
it('catalog.snapshot upserts the copy and ignores an older version', async () => {
  await svc.apply(env('catalog.snapshot', 'p1', '10', { id: 'p1', sku: 'S1', status: 'active', category_name_th: 'ก', image_url: 'u', translations: [], updated_at: '2026-10-07T00:00:00Z' }));
  expect(await svc.apply(env('catalog.snapshot', 'p1', '9', { id: 'p1', sku: 'OLD', translations: [], updated_at: '2026-10-06T00:00:00Z' }))).toBe('stale');
  expect(await catalog('p1')).toMatchObject({ sku: 'S1', categoryNameTh: 'ก', imageUrl: 'u', sourceVersion: '10', removedAt: null });
});
it('catalog.deleted marks removed_at, keeps the row', async () => {
  await svc.apply(env('catalog.snapshot', 'p1', '10', { id: 'p1', sku: 'S1', translations: [], updated_at: '2026-10-07T00:00:00Z' }));
  await svc.apply(env('catalog.deleted', 'p1', '11', { id: 'p1' }));
  expect((await catalog('p1')).removedAt).not.toBeNull();
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 1: catalog copy fed by josh catalog.snapshot events + josh's CompetitorReview schema (josh 1792270000000). */
export class CompetitorOwnership1794200000000 implements MigrationInterface {
  name = 'CompetitorOwnership1794200000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE josh_catalog_products
      ADD COLUMN source_version bigint NOT NULL DEFAULT 0,
      ADD COLUMN ordering_price numeric(12,2), ADD COLUMN order_taking_unit varchar(50),
      ADD COLUMN category_name_th varchar(100), ADD COLUMN category_name_en varchar(100), ADD COLUMN image_url varchar(2000)`);
    await q.query(`ALTER TABLE competitor_prices
      ADD COLUMN competitor_unit varchar(8) NOT NULL DEFAULT 'kg', ADD COLUMN competitor_qty_min numeric(12,4),
      ADD COLUMN competitor_qty_max numeric(12,4), ADD COLUMN competitor_pack_count integer NOT NULL DEFAULT 1,
      ADD CONSTRAINT ck_competitor_price_unit CHECK (competitor_unit IN ('kg', 'l', 'piece')),
      ADD CONSTRAINT ck_competitor_price_pack_count CHECK (competitor_pack_count >= 1)`);
    await q.query(`CREATE TABLE competitor_match_rejections (
      id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY, product_id uuid NOT NULL REFERENCES josh_catalog_products(id) ON DELETE CASCADE,
      source_url varchar(2000) NOT NULL, created_by varchar(100) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_competitor_match_rejection UNIQUE (product_id, source_url))`);
    await q.query(`CREATE TABLE competitor_match_reviews (
      product_id uuid PRIMARY KEY REFERENCES josh_catalog_products(id) ON DELETE CASCADE,
      reviewed_by varchar(100) NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now())`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE competitor_match_reviews`);
    await q.query(`DROP TABLE competitor_match_rejections`);
    await q.query(`ALTER TABLE competitor_prices DROP CONSTRAINT ck_competitor_price_pack_count, DROP CONSTRAINT ck_competitor_price_unit,
      DROP COLUMN competitor_pack_count, DROP COLUMN competitor_qty_max, DROP COLUMN competitor_qty_min, DROP COLUMN competitor_unit`);
    await q.query(`ALTER TABLE josh_catalog_products DROP COLUMN image_url, DROP COLUMN category_name_en, DROP COLUMN category_name_th,
      DROP COLUMN order_taking_unit, DROP COLUMN ordering_price, DROP COLUMN source_version`);
  }
}
```

Add the matching `@Column`s to both entities, using the same style as the existing columns in each file. Write `competitor-match.entity.ts` from josh `apps/backend/src/entities/competitor-price.entity.ts` (`CompetitorMatchRejection`, `CompetitorMatchReview`), with the FK pointing at `JoshCatalogProduct`. Register all new entities in `competitor-prices.module.ts` `TypeOrmModule.forFeature`.

- [ ] **Step 4: Apply in `josh-events.service.ts`**

```ts
case 'catalog.snapshot':
  return this.guarded('josh_catalog_products', 'id', e, (m) => this.saveCatalog(m, e));
case 'catalog.deleted':
  return this.guarded('josh_catalog_products', 'id', e, (m) =>
    m.query(`UPDATE josh_catalog_products SET removed_at = now(), source_version = $2 WHERE id = $1`, [e.aggregateId, e.version]));
```

Widen the `guarded` table union to include `'josh_catalog_products'`, and add:

```ts
private async saveCatalog(m: EntityManager, e: JoshEnvelope) {
  const d = e.data ?? {};
  if (d.id !== e.aggregateId) throw new BadRequestException('catalog.snapshot data.id must equal the aggregate id');
  await m.getRepository(JoshCatalogProduct).upsert([{
    id: d.id, sku: d.sku, status: d.status ?? null, brandCode: d.brand_code ?? null, brandName: d.brand_name ?? null,
    countryCodeSource: d.country_code_source ?? null, storageTemperature: d.storage_temperature ?? null,
    packagingType: d.packaging_type ?? null, packSize: d.pack_size ?? null, unitsPerBox: d.units_per_box ?? null,
    weightPerUnit: d.weight_per_unit ?? null, sellingUnit: d.selling_unit ?? null, vatType: d.vat_type ?? null,
    sellingUnitPrice: d.selling_unit_price ?? null, orderingPrice: d.ordering_price ?? null, orderTakingUnit: d.order_taking_unit ?? null,
    categoryNameTh: d.category_name_th ?? null, categoryNameEn: d.category_name_en ?? null, imageUrl: d.image_url ?? null,
    translations: d.translations ?? [], joshUpdatedAt: new Date(d.updated_at), removedAt: null, syncedAt: new Date(),
    sourceVersion: e.version,
  }], ['id']);
}
```

Keep the raw values exactly as josh sends them (numeric stays a string). `catalogFingerprint` depends on this.

- [ ] **Step 5: `JoshCatalogSyncService` without a replica.**
  - Test: with `josh.configured === false`, `syncSku('S1')` returns the local row found by `products.findOneBy({ sku: 'S1' })` and makes no replica call; `syncId` is a no-op.
  - Change: at the top of `syncSku`, add `if (!this.josh.configured) return this.products.findOneBy({ sku });`, and in `syncId` add `if (!this.josh.configured) return;`.
  - In `competitor-prices.service.ts` around line 119, the message for a SKU missing from the copy becomes `ไม่พบ SKU นี้ในแค็ตตาล็อก` (NotFound), not ServiceUnavailable.

- [ ] **Step 6: Run** `npx jest apps/commerce-platform/src/modules/integration/connector/josh` → PASS; run migrations on the dev DB (`npm run migration:run`).

- [ ] **Step 7: Commit** `feat(josh-events): catalog copy from catalog.snapshot; competitor review schema`

---

### Task 4: commerce — size and offer helpers (pure functions)

**Files:**
- Create: `integration/competitor-prices/competitor-size.ts` (copy of josh `origin/main` `apps/backend/src/app/competitor-prices/competitor-size.ts`, 82 lines)
- Create: `integration/competitor-prices/pack-order-price.ts` (from josh `apps/backend/src/shared/helpers/pack-order-price.helper.ts`: only `resolvePackTotalQty`, `resolveCatalogOrderingPrice` and the private functions they call)
- Create: `integration/competitor-prices/catalog-shape.ts`
- Test: `competitor-size.spec.ts`, `pack-order-price.spec.ts` (copy the matching `describe` blocks from josh `competitor-prices.spec.ts` / `pack-order-price.helper.spec.ts`)

**Interfaces:**
- Produces:
  - `toInventoryShape(p: JoshCatalogProduct): InventoryShape`. `InventoryShape` is the snake_case object the josh helpers read: `product_inventory_id, product_inventory_sku, product_status, brand_code, …, selling_unit_price, ordering_price, order_taking_unit, translations, productCategory: {category_name_th, category_name_en}, updated_at`.
  - Exports of `competitor-size.ts` and `pack-order-price.ts` unchanged from josh.

- [ ] **Step 1: Copy the josh specs; run → FAIL (modules missing).**
- [ ] **Step 2: Copy the two josh files.**
  - Replace their `ProductInventory` import with `InventoryShape` from `catalog-shape.ts`.
  - Replace `roundMoney` from `vat.helper` with the local `const roundMoney = (v: number) => Math.round(v * 100) / 100;`, which already exists in `competitor-prices.service.ts`; export it from `catalog-shape.ts` and import it in all three files.
- [ ] **Step 3: `catalog-shape.ts`**

```ts
import { JoshCatalogProduct } from '../connector/josh/josh-catalog-product.entity';

export const roundMoney = (value: number) => Math.round(value * 100) / 100;

/** josh's ProductInventory field names, so helpers ported from josh stay byte-identical (diffable against josh). */
export type InventoryShape = ReturnType<typeof toInventoryShape>;
export function toInventoryShape(p: JoshCatalogProduct) {
  return {
    product_inventory_id: p.id, product_inventory_sku: p.sku, product_status: p.status,
    brand_code: p.brandCode, brand_name: p.brandName, country_code_source: p.countryCodeSource,
    storage_temperature: p.storageTemperature, packaging_type: p.packagingType, pack_size: p.packSize,
    units_per_box: p.unitsPerBox, weight_per_unit: p.weightPerUnit, selling_unit: p.sellingUnit, vat_type: p.vatType,
    selling_unit_price: p.sellingUnitPrice, ordering_price: p.orderingPrice, order_taking_unit: p.orderTakingUnit,
    translations: p.translations, productCategory: { category_name_th: p.categoryNameTh, category_name_en: p.categoryNameEn },
    image_url: p.imageUrl, updated_at: p.joshUpdatedAt,
  };
}
```

- [ ] **Step 4: Add a fingerprint guard test** to `competitor-prices.spec.ts`: `catalogFingerprint` of a `JoshCatalogProduct` equals a hard-coded hex computed in josh for the same values. Get that hex by running josh's `catalogFingerprint` on the same literal in a josh jest one-off and paste it.
- [ ] **Step 5: Run → PASS. Commit** `feat(competitor-prices): port josh pack-size and offer helpers`

---

### Task 5: commerce — competitor-prices service + controller at josh parity

**Files:**
- Modify: `integration/competitor-prices/competitor-prices.service.ts`, `.controller.ts`, `competitor-price.dto.ts`
- Test: `competitor-prices.spec.ts` (copy josh `origin/main` `competitor-prices.spec.ts` cases for `buildMatchIndex`, `rankSiteCandidates`, `describeOurOffer`, `overview`, `matchQueue`, `match`, `confirm`)

**Interfaces:**
- Consumes: Task 3 entities, Task 4 helpers, and `ScrapingService.itemsStamp/matchableItems/itemByUrl/item/listItems/listSources` (already present, `scraping.service.ts:120–364`).
- Produces (used by Task 6 and Task 8):
  - `product(sku): Promise<JoshCatalogProduct>`, `matchIndex()`, `siteCandidates(sku)`, `matchQueue(after)`;
  - `overview(filters)`, `overviewXlsx(filters): Promise<Buffer>`;
  - `match(catalogItemId, sku, actor, typed?: PackSize)`, `confirm(id, actor, revision, ourProductVersion, …)`;
  - exported functions `describeOurOffer(p: InventoryShape)`, `productView(p: InventoryShape)`, `rankSiteCandidates(...)`, `buildMatchIndex(...)`.

- [ ] **Step 1: Copy the josh spec cases; adapt fixtures to `JoshCatalogProduct` via the field map; run → FAIL.**
- [ ] **Step 2: Port.**
  - Take josh `origin/main` `competitor-prices.service.ts` and keep commerce's existing class shell: constructor deps `CompetitorPrice` repo, `JoshCatalogProduct` repo, `ScrapingService`, `JoshCatalogSyncService`.
  - Bring over every exported function and method listed above.
  - Mechanical edits only:
    - (a) entity / field names per the field map;
    - (b) every `ProductInventory` passed to a helper goes through `toInventoryShape(p)`;
    - (c) `relations: ['translations', 'productCategory']` disappears (they are columns now);
    - (d) josh `CronLockService.withLock('competitor-prices', 3500, fn)` becomes commerce's existing `scheduledRefresh` guard (keep commerce's `@Cron(cronConfig.competitorPricesRefresh…)` and its `CRON_COMPETITOR_PRICES_REFRESH_ENABLED` gate; port only the loop body);
    - (e) active products use `{ status: 'active', removedAt: IsNull() }`.
  - Keep commerce's `catalogFingerprint(product: JoshCatalogProduct)` as is; it is already identical to josh's.
- [ ] **Step 3: Controller.** Add the josh routes missing in commerce, with the same paths and DTOs:
  - `GET review`, `GET review/search`, `POST review/cell`, `POST review/finish` (wired in Task 6);
  - `GET overview`, `GET overview/export` (`@Header('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')`, `@Header('Cache-Control','private, no-store')`, returns `StreamableFile`);
  - `GET match-queue`, `GET sku/:sku/candidates`, `POST match`, `POST :id/confirm`.

  Copy the josh DTO classes (`ReviewGridQueryDto`, `ReviewSearchQueryDto`, `ReviewCellDto`, `ReviewFinishDto`, `CompetitorOverviewQueryDto`, `MatchCompetitorDto`, `ConfirmCompetitorPriceDto`) into `competitor-price.dto.ts`. `actor` = the commerce staff email from the request user, using the same accessor the existing `verify` route uses.
- [ ] **Step 4: Dependency.** `npm i exceljs -w apps/commerce-platform`. This is the same library josh uses for this export, and nothing already installed writes xlsx.
- [ ] **Step 5: Run** `npx jest apps/commerce-platform/src/modules/integration/competitor-prices` → PASS.
- [ ] **Step 6: Commit** `feat(competitor-prices): overview, export, match queue, candidates, match, confirm (josh parity)`

---

### Task 6: commerce — review grid service

**Files:**
- Create: `integration/competitor-prices/competitor-review.service.ts`
- Test: `competitor-review.service.spec.ts`

**Interfaces:**
- Consumes: Task 5 `CompetitorPricesService.product/match/matchIndex`, Task 4 helpers, Task 3 entities.
- Produces: `grid(query)`, `setCell(actor, dto)`, `finish(actor, dto)`, `search(site, text, sku)`, with the same shapes as josh.

- [ ] **Step 1: Tests** (mock repos, same pattern as the commerce `competitor-prices.spec.ts`):

```ts
it('grid groups by category name and counts reviewed', async () => {
  products.find.mockResolvedValue([cat('p1', 'S1', 'ผัก'), cat('p2', 'S2', 'ผัก'), cat('p3', 'S3', null)]);
  reviews.find.mockResolvedValue([{ productId: 'p1' }]);
  const g = await svc.grid({ category: 'ผัก' });
  expect(g.categories).toEqual([{ name: 'ผัก', total: 2, reviewed: 1 }, { name: 'ไม่ระบุหมวด', total: 1, reviewed: 0 }]);
  expect(g.rows.map((r) => r.sku)).toEqual(['S2']);
  expect(g.rows[0].image).toBe('https://img/p2');
});
it('setCell off remembers "not this one"', async () => {
  await svc.setCell('a@x', { sku: 'S1', on: false, itemId: 'i1' });
  expect(rejectionsInsert).toHaveBeenCalledWith(expect.objectContaining({ productId: 'p1', sourceUrl: 'https://site/i1', createdBy: 'a@x' }));
});
it('finish pairs ticked proposals, skips duplicates, marks reviewed', async () => {
  competitor.match.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
  const r = await svc.finish('a@x', { skus: ['S1'], accept: [{ sku: 'S1', itemId: 'i1' }, { sku: 'S1', itemId: 'i2' }] });
  expect(r).toEqual({ saved: 1, reviewed: 1, failed: [] });
});
```

`cat(id, sku, category)` builds a `JoshCatalogProduct` with `status:'active'`, `categoryNameTh: category` and `imageUrl: 'https://img/'+id`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Port** josh `origin/main` `competitor-review.service.ts` (190 lines) with the field map. Two differences:
  - `category(p)` = `p.categoryNameTh || p.categoryNameEn || 'ไม่ระบุหมวด'`;
  - the image comes from `p.imageUrl`, so delete the `ProductMedia` query.

  Register the service in `competitor-prices.module.ts` and wire the four review routes from Task 5.
- [ ] **Step 4: Run → PASS. Commit** `feat(competitor-prices): review grid — proposals, autosave cells, finish batch`

---

### Task 7: commerce — scraping fixes (#454, #455)

**Files:**
- Modify: `platform/scraping/infrastructure/public-web.reader.ts`, `platform/scraping/application/scraping.service.ts`, `platform/scraping/domain/scraping-source.entity.ts` (`progress.catchUp?: number`)
- Test: `public-web.reader.spec.ts`, `scraping.service.spec.ts`

- [ ] **Step 1:** In josh, run `git show d69956702 547bd2b7a -- apps/backend/src/app/competitor-prices apps/backend/src/entities/scraping-source.entity.ts`. Copy the spec hunks from those two commits into the commerce specs, adjusting import paths. Run → FAIL.
- [ ] **Step 2:** Apply the source hunks:
  - `advanceOrRetry` in `public-web.reader.ts` and its use in the paging loop;
  - the `catchUp` lease renewal plus the `catching_up` status in `scraping.service.ts`.

  Commerce's files were ported from josh af81a227, so the hunks apply with path changes only. If `git apply` rejects a hunk, place it by the function name.
- [ ] **Step 3:** Run `npx jest apps/commerce-platform/src/modules/platform/scraping` → PASS. Commit `fix(scraping): keep the lease while catching up; retry "next" before calling it a drop (josh #454, #455)`

---

### Task 8: commerce — research parity (social, AI summary, AI worker)

**Files:**
- Create: `platform/marketing-research/application/research-social.service.ts`, `research-social.config.ts`, `research-ai-summary.service.ts`, `research-ai.worker.ts`
- Modify: `research.types.ts`, `marketing-research.service.ts`, `marketing-research.cron.ts`, `presentation/marketing-research.controller.ts` (`POST runs/:id/summarize`), `marketing-research.module.ts`, `dto/research.dto.ts`
- Test: copy josh specs for the same files

- [ ] **Step 1:** In josh, list what to port: `git show --stat 93d7c517e 1e0e435a7 604534526 ab9dd7256 9748c5a37 -- apps/backend/src/app/marketing-research apps/backend/src/migrations`. For each josh spec file touched, copy it to the matching commerce path. Run → FAIL.
- [ ] **Step 2:** Port the josh `origin/main` versions of the four new files. Merge the josh changes into commerce's `research.types.ts`, `marketing-research.service.ts`, `.cron.ts`, `.controller.ts` and `.module.ts` by diffing the josh file at `origin/main` against commerce's (`diff <(git -C ../josh show origin/main:…) <commerce file>`). Keep commerce's import paths and its staff user model, which `ResearchAccessGuard` already uses.
  - Env flags keep josh's names and defaults: `RESEARCH_AI_ENABLED`, `RESEARCH_SOCIAL_ENABLED`, `RESEARCH_GOOGLE_NEWS_ENABLED`, `RESEARCH_PUBLIC_SOCIAL_RSS_ENABLED`, `RESEARCH_APIFY_ENABLED`, Gemini key pool.
  - Add them to `.env.example` with the josh comments.
  - If one of the josh commits adds a migration, port it with a timestamp of `17942xxxxxxxx` after `1794200000000`.
- [ ] **Step 3:** Run `npx jest apps/commerce-platform/src/modules/platform/marketing-research` → PASS. Commit `feat(marketing-research): social connectors, on-demand AI summary, AI worker (josh parity)`

---

### Task 9: commerce-admin — review grid, overview, export, match queue

**Files:**
- Create: `apps/commerce-admin/src/app/pages/CompetitorReviewGrid.tsx`
- Modify: `apps/commerce-admin/src/app/pages/CompetitorPrices.tsx`, `apps/commerce-admin/src/lib/api*` (the `competitorPricesApi` object imported at `CompetitorPrices.tsx:8`), `apps/commerce-admin/src/app/pages/MarketingResearch.tsx` (summarize button)
- Test: `apps/commerce-admin/e2e/competitor-price-matrix.mjs` (extend)

- [ ] **Step 1:** Port josh `origin/main` `apps/web-admin/src/app/page/marketing/CompetitorReviewGrid.tsx` (210 lines) and the review / overview / match-queue parts of `CompetitorPricesPage.tsx` (304 lines). Swap their `@josh/shared-api` calls for `competitorPricesApi` methods with the same names.
  - Add to `competitorPricesApi`: `reviewGrid`, `reviewSearch`, `reviewCell`, `reviewFinish`, `overview`, `overviewExportUrl`, `matchQueue`, `siteCandidates`, `match`, `confirm`.
  - Each method hits the Task 5 route with the same name. Types come from josh `libs/shared-api/src/lib/competitor-prices/competitor-prices.api.ts`.
- [ ] **Step 2:** Make `CompetitorPrices.tsx` follow josh's 3-step layout: sites → match one SKU at a time / review grid → results overview with export.
- [ ] **Step 3:** In `MarketingResearch.tsx`, the summarize button calls the already-present `summarizeMarketingResearchRun`.
- [ ] **Step 4:** Extend the e2e script so it opens the review grid, ticks one cell, finishes the batch and downloads the export. Run it against local commerce with a seeded catalog (Task 10 Step 2 seeds it). `npm run build -w apps/commerce-admin` must pass.
- [ ] **Step 5: Commit** `feat(commerce-admin): competitor review grid, overview + export, match queue`

---

### Task 10: import, end-to-end check, cutover runbook

**Files:**
- Modify: `apps/commerce-platform/src/cli/import-from-josh.ts`
- Create: `docs/runbooks/stage1-competitor-cutover.md`
- Modify: `docs/event-contract.md` §6 (add `catalog.snapshot` / `catalog.deleted`)

- [ ] **Step 1: Import the review tables.** In `PLANS.competitor`, after `competitor_prices`, add `{ table: 'competitor_match_rejections', emailColumns: ['created_by'] }` and `{ table: 'competitor_match_reviews', emailColumns: ['reviewed_by'] }`.
  - `competitor_match_reviews` has no `id` column, so its upsert needs `ON CONFLICT (product_id)`.
  - Add `conflict?: string` to `Plan` (default `'id'`) and use it in the `ON CONFLICT` clause and in the "skip key column" filter.
- [ ] **Step 2: Local end-to-end** (same setup as stage-0 Task 9: scratch copies of the josh and commerce DBs, commerce on :3199, josh with `JOSH_EVENTS_TO_COMMERCE_ENABLED=true`):
  1. `POST josh /api/internal/commerce/backfill {group:'catalog'}` → every active josh product appears in `josh_catalog_products` with `source_version > 0`.
  2. Rename a product in josh → the new name is in commerce within 5 s. Change only `product_inventory_quantity` → the outbox has no new `catalog` row.
  3. `JOSH_DATABASE_URL=<scratch josh> npm run import-from-josh -- all` → row counts in commerce equal josh for `scraping_sources`, `scraped_items`, `competitor_prices`, `competitor_match_rejections`, `competitor_match_reviews`, `marketing_research_topics`, `marketing_research_runs`.
  4. Parity: for each `competitor_prices` row with `verified_fingerprint`, commerce `catalogFingerprint(josh_catalog_products row)` equals it. Run it as a one-off SQL+node check and expect 0 mismatches. Mismatches mean pairs would show "needs review" after the cutover.
  5. With `COMMERCE_OWNS_COMPETITOR=true` on josh, `POST /api/competitor-prices/match` → 403, `GET /api/competitor-prices/overview` → 200, and the scraping tick logs nothing.
  6. Review grid in commerce-admin works on the imported data.
- [ ] **Step 3: Runbook** `docs/runbooks/stage1-competitor-cutover.md`, in order. Ops does these steps; Claude cannot write to josh prod.
  1. Deploy commerce (migration 1794200000000) and josh (migration 1792320000000), josh flag still off.
  2. `POST /api/internal/commerce/backfill {"group":"catalog"}` via commerce's backfill button (stage-0 `JoshBackfillController`; add `catalog` to its allowed groups). Wait until the josh outbox has no unsent `catalog` rows.
  3. Announce a 15-minute freeze to MER / marketing.
  4. josh: `COMMERCE_OWNS_COMPETITOR=true`, restart. Check that a write answers 403.
  5. Run `JOSH_DATABASE_URL=<josh read-only> npm run import-from-josh -- all` once, from a host that can reach josh's DB. Then unset the URL; commerce prod keeps no josh DB URL.
  6. Run the parity check from Step 2.4 → 0 mismatches.
  7. commerce: `CRON_COMPETITOR_PRICES_REFRESH_ENABLED=true`, `CRON_MARKETING_RESEARCH_ENABLED=true`, `SCRAPING_CRON_DISABLED` unset, scraping automation switch on in commerce-admin; the research worker points at commerce's `/api/marketing-research-worker`.
  8. Rollback:
     - josh flag off;
     - commerce crons off;
     - writes made in commerce in the meantime are NOT copied back, so re-enter them in josh, or re-run the import in reverse only if needed (no tool for that; out of scope).
- [ ] **Step 4:** Add a line to `event-contract.md` §6 for `catalog.snapshot` (data keys from Task 1) and `catalog.deleted`. Add `catalog` to commerce's backfill groups. Run the full commerce suite: `npm test` → all pass.
- [ ] **Step 5: Commit** `docs(stage1): competitor cutover runbook, catalog events; import review tables`

---

## Checklist mapping (artifact `s1-*`)

| item | tasks |
|---|---|
| s1-1 port review / overview / export / match-queue / candidates / match / confirm | 3, 4, 5, 6, 9 |
| s1-2 port #454 / #455 | 7 |
| s1-3 josh flag + cron stop | 2 |
| s1-4 backfill | 1 (catalog via pipe), 10 (one-off import) |
| s1-5 shadow 1 week | replaced by the one-time parity check (Task 10 Step 2.4) — see Deviations |
| s1-6 switch | Task 10 runbook steps 4–7 |
| (not in the spec, added) research social / AI summary parity | 8 |

---

## As built (2026-10-07)

Differences from the tasks above, found while implementing:

- **Task 1:** josh's `product_category` primary-key column is `id` (`category_id_uuid` is only the entity property).
  The trigger and builder use `id`.
- **Task 1 — stage-0 bug fixed here:** `customer.deleted` took its version from the outbox row id. That is a
  different sequence from `commerce_snapshot_seq`, so commerce's guard dropped the delete as stale against
  earlier `customer.snapshot` versions (PDPA). Both `customer.deleted` and `catalog.deleted` now take
  `nextval('commerce_snapshot_seq')`.
- **Task 3 Step 5:** not needed. `CompetitorPricesService.product()` already called `syncSku` only when a
  replica is configured.
- **Task 4:** `pack-order-price.helper.ts` already existed in commerce (`connector/josh/jagota/`), byte-identical
  to josh, so it is reused rather than copied.
- **Task 5:** the service was regenerated from the josh file by a scripted transform (field names kept via
  `InventoryShape`), then josh's unit specs (`our-offer`, `sku-suggestions`, `competitor-overview` with xlsx and
  formula-injection checks) were ported.
- **Task 6:** josh's review-grid integration test was ported as an opt-in DB spec (`competitor-review.db.spec.ts`).
- **Task 8:** applied as the josh diff `1e0e435a7..origin/main` onto commerce's layout. The josh HTTP-spec hunks
  were skipped because commerce never had that spec. There is no `REDIS_CLIENT` in commerce, so the AI/social
  daily caps are per process.
- **Task 9:**
  - Commerce-admin now hosts josh's web-admin competitor/scraping pages verbatim under `/j/marketing/*`.
  - Their shared-api module calls commerce directly through `commerce-client.ts` (`/competitor-scraping` →
    `/scraping`).
  - The older native pages, their API blocks and `e2e/competitor-price-matrix.mjs` were removed; the old URLs
    redirect.
  - The research page gained only the AI-summary action.
- **Task 10:**
  - Parity check is `npm run competitor-parity`.
  - The runbook is `docs/runbooks/stage1-competitor-cutover.md`.
  - Local E2E results:
    - the catalog backfill sent 5,889 products in 15 s;
    - a rename reached commerce in 27 ms;
    - a qty-only write created no event;
    - a delete set `removed_at`;
    - the import copied all groups;
    - parity was 1/1 before and after an event update;
    - a corrupted pack size was caught;
    - josh's UI on commerce rendered the review grid, the overview and a valid xlsx export.
