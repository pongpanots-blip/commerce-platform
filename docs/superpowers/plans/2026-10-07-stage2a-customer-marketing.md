# Stage 2a — commerce owns customer metrics and segments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce computes customer metrics and owns segment definitions and frozen membership, from its own event-fed copies. josh keeps a read copy, so coupons, banners, push campaigns and workflows keep working unchanged. `COMMERCE_OWNS_CUSTOMERS` is narrowed to marketing data only.

**Architecture:**
- **Metrics:** commerce computes them from `josh_orders` (stage-0 `order.snapshot` copy) into its own `customer_metrics` table. It pushes changed rows through josh's existing `/api/internal/customer-metrics`, with a dry-run mode for the shadow week.
- **Segments:**
  - commerce stores the definitions (same ids as josh) and freezes membership with josh's compiler, ported over a commerce base relation built from `josh_customers`.
  - It publishes `segment.upserted` / `segment.deleted` / `segment.members` through its existing webhook outbox into josh `/api/internal/erp-events`.
  - josh writes them into its own `user_segments` / `segment_membership_snapshots`, so every josh consumer reads the same tables as today.
  - Live segments (guest/first_visit/member/staff/role/custype/has_company) keep matching per request inside josh, because commerce is never in the shop's request path.

**Tech Stack:** josh NestJS 10 / TypeORM 0.3 / Postgres 16 · commerce NestJS 10 / TypeORM raw-SQL migrations / jest · commerce-admin React (josh pages hosted under `/j`)

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` (§1 split table, §2.4 `COMMERCE_OWNS_CUSTOMERS` row, §4.1, §4.2 row 2)

**Decided with the user (2026-10-07):**
- Stage 2 splits into 2a (this plan) and 2b (winback CRM, a separate plan). 2b uses the metrics and segments from 2a.
- Segment membership is computed in commerce and sent to josh.

## Global Constraints

- josh changes are additive and default off. Only the literal `'true'` turns a flag on. Turning a flag off is the rollback.
- josh must not get slower. New triggers fire only on the columns they need (`UPDATE OF … WHEN`).
- Commerce is never in the shop's request path. Live segment matching stays in josh.
- No josh DB reads at runtime from commerce (no replica). The one-off cutover import is run once by ops.
- Segment ids are identical in both systems. Coupons (`audience_segment_id`), `segment_promotions` and workflows reference them.
- PDPA: `customer.deleted` must remove the customer from commerce's copy, its metrics and every segment membership.
- Base branches:
  - josh: from `origin/main`. Stage 1, jagota/Webjosh#489, is merged.
  - commerce: from `feat/stage1-competitor-ownership` until pongpanots-blip/commerce-platform#33 merges, then rebase onto `origin/master`.

## Corrections to the spec

- **Consent is not commerce-written.** Customers set `marketing_consent` / `pdpa_consent` themselves (signup `auth.service.ts:748`, profile privacy). It is purchase-path, self-service data, so josh stays the writer. commerce reads it from `customer.snapshot`, which already carries it (stage 0).
- **Tags:** josh has no customer-tag model. Nothing to move.
- **`segment_promotions` (segment → coupon/banner/promotion mapping)** stays in josh until promotions move (stage 4). It is promotion configuration that points at josh promotions.

## File map

**josh** (worktree `josh-worktrees/commerce-event-pipe`, branch `feat/commerce-owns-segments` from `origin/main`):

| File | Change |
|---|---|
| `migrations/1792330000000-CommerceOutboxCustomerExtras.ts` | triggers: `customer_metrics.tier_id` change and `shop` cuisine/company change → enqueue `customer` |
| `app/commerce-events/commerce-snapshot.builder.ts` | `CUSTOMER` select gains `tier_slug`, `cuisine_name`, `cuisine_parent_id` |
| `app/erp/commerce-erp-events.controller.ts` | handlers `segment.upserted`, `segment.deleted`, `segment.members` |
| `app/user-segment/commerce-segments.service.ts` (new) | applies the three events to `user_segments` / `segment_membership_snapshots` |
| `app/user-segment/user-segment.service.ts` | `ensureFrozen` / `freezeSegment` do nothing when commerce owns segments |
| `app/user-segment/user-segment.controller.ts` | create / update / remove → `CommerceOwnedCustomersGuard` |
| `app/user-segment/commerce-segment-counts.controller.ts` (new) | signed `POST internal/commerce/segments/counts` (parity) |
| `app/cs-admin/cs-admin.controller.ts`, `app/company/company.controller.ts`, `app/erp/commerce-ownership.flag.ts` | narrow `COMMERCE_OWNS_CUSTOMERS` |
| `app/customer-metrics/commerce-customer-metrics.controller.ts` + service | `dryRun` batches compare instead of write |

**commerce** (branch `feat/stage2a-customer-marketing`):

| File | Change |
|---|---|
| `migrations/1794300000000-CustomerMarketing.ts` | `customer_metrics`, `segments`, `segment_members`, view `segment_customers` |
| `modules/integration/customers/customer-metrics.entity.ts`, `customer-metrics.service.ts` (new) | compute from `josh_orders`; push off / shadow / on |
| `modules/integration/connector/josh/customer-metrics-offload.job.ts` | removed (replaced) |
| `modules/integration/segments/` (new): `segment-fields.ts`, `segment-definition.compiler.ts`, `legacy-rule.compiler.ts`, `segment.entity.ts`, `segments.service.ts`, `segments.controller.ts`, `segment-events.ts`, `segments.module.ts`, `dto/*` | port of josh `user-segment` onto commerce data |
| `modules/integration/connector/josh/events/josh-events.service.ts` | `customer.deleted` also wipes metrics + memberships |
| `apps/commerce-admin/src/josh-admin/libs/shared-api/lib/api-client/commerce-client.ts`, `user-segment/user-segment.api.ts` | segment definition routes → commerce when it owns them |
| `modules/platform/settings/ownership.controller.ts` (new) | `GET /api/ownership` → `{ segments: boolean }` |
| `cli/import-from-josh.ts`, `cli/segment-parity.ts` (new), `docs/runbooks/stage2a-customer-marketing-cutover.md`, `docs/event-contract.md` | cutover |

---

### Task 1: josh — customer snapshot carries tier and cuisine

Commerce's segment compiler needs `t.slug` (tier) and `cy.cuisine_name` / `cy.parent_id` (the company's first shop cuisine). Today these come from josh-only tables.

**Files:**
- Create: `apps/backend/src/migrations/1792330000000-CommerceOutboxCustomerExtras.ts`
- Modify: `apps/backend/src/app/commerce-events/commerce-snapshot.builder.ts` (`CUSTOMER`)
- Test: `commerce-outbox.trigger.db.spec.ts`, `commerce-snapshot.builder.spec.ts`

**Interfaces:**
- Produces: `customer.snapshot.data` gains `tier_slug: string|null`, `cuisine_name: string|null`, `cuisine_parent_id: string|null`. These are the same values josh's `SEGMENT_BASE_FROM` (`user-segment.service.ts:104-116`) yields for that user.

- [ ] **Step 1: Failing DB tests** (append to the trigger spec, using its existing `inRollback` helper):

```ts
it('a tier change enqueues the customer; a metrics-only change does not', async () => {
  await inRollback(async (q) => {
    const [m] = await q(`SELECT m.user_id FROM customer_metrics m JOIN users u ON u.id = m.user_id JOIN app_roles r ON r.code = u.role
                          WHERE r.user_type = 'customer' LIMIT 1`);
    await q(`UPDATE customer_metrics SET lifetime_spend = lifetime_spend + 1 WHERE user_id = $1`, [m.user_id]);
    expect(await q(`SELECT count(*)::int AS n FROM commerce_outbox WHERE type = 'customer'`)).toEqual([{ n: 0 }]);
    await q(`UPDATE customer_metrics SET tier_id = (SELECT id FROM membership_tiers WHERE id IS DISTINCT FROM customer_metrics.tier_id LIMIT 1) WHERE user_id = $1`, [m.user_id]);
    expect(await q(`SELECT aggregate_id FROM commerce_outbox WHERE type = 'customer'`)).toEqual([{ aggregate_id: m.user_id }]);
  });
});
it('a shop cuisine change enqueues every customer of that company', async () => {
  await inRollback(async (q) => {
    const [s] = await q(`SELECT s.id, s.company_id FROM shop s WHERE s.company_id IS NOT NULL
                          AND EXISTS (SELECT 1 FROM users u WHERE u.company_id = s.company_id) LIMIT 1`);
    await q(`UPDATE shop SET cuisine_id = (SELECT id FROM cuisine WHERE id IS DISTINCT FROM shop.cuisine_id AND level = 2 LIMIT 1) WHERE id = $1`, [s.id]);
    const [{ n }] = await q(`SELECT count(*)::int AS n FROM users u JOIN app_roles r ON r.code = u.role WHERE u.company_id = $1 AND r.user_type = 'customer'`, [s.company_id]);
    expect(await q(`SELECT count(*)::int AS n FROM commerce_outbox WHERE type = 'customer'`)).toEqual([{ n }]);
  });
});
```

- [ ] **Step 2:** Run with `JOSH_SCOPE_TEST_DATABASE_URL=postgres:///josh_pipe_test npx nx test backend --skip-nx-cache -- …trigger.db.spec.ts`. Expect 2 failures. (`--skip-nx-cache` is required; nx caches test results.)

- [ ] **Step 3: Migration.** Before running, confirm the timestamp is free: `git ls-tree origin/main apps/backend/src/migrations | grep 17923300`.

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 2a: tier and shop cuisine feed commerce's segment compiler through customer.snapshot. */
export class CommerceOutboxCustomerExtras1792330000000 implements MigrationInterface {
  name = 'CommerceOutboxCustomerExtras1792330000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE OR REPLACE FUNCTION commerce_outbox_customer_extras() RETURNS trigger AS $$
      BEGIN
        IF TG_TABLE_NAME = 'customer_metrics' THEN
          INSERT INTO commerce_outbox (type, aggregate_id)
            SELECT 'customer', u.id FROM users u JOIN app_roles r ON r.code = u.role
             WHERE u.id = NEW.user_id AND r.user_type = 'customer';
        ELSE -- shop: every customer of the old and the new company
          INSERT INTO commerce_outbox (type, aggregate_id)
            SELECT 'customer', u.id FROM users u JOIN app_roles r ON r.code = u.role
             WHERE r.user_type = 'customer' AND u.company_id IN (NEW.company_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.company_id END);
        END IF;
        RETURN NULL;
      END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_customer_tier AFTER UPDATE OF tier_id ON customer_metrics
      FOR EACH ROW WHEN (OLD.tier_id IS DISTINCT FROM NEW.tier_id) EXECUTE FUNCTION commerce_outbox_customer_extras()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_customer_tier_ins AFTER INSERT ON customer_metrics
      FOR EACH ROW WHEN (NEW.tier_id IS NOT NULL) EXECUTE FUNCTION commerce_outbox_customer_extras()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_customer_shop AFTER INSERT OR UPDATE OF cuisine_id, company_id ON shop
      FOR EACH ROW EXECUTE FUNCTION commerce_outbox_customer_extras()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS commerce_outbox_customer_shop ON shop`);
    await q.query(`DROP TRIGGER IF EXISTS commerce_outbox_customer_tier_ins ON customer_metrics`);
    await q.query(`DROP TRIGGER IF EXISTS commerce_outbox_customer_tier ON customer_metrics`);
    await q.query(`DROP FUNCTION IF EXISTS commerce_outbox_customer_extras()`);
  }
}
```

- [ ] **Step 4: Builder.** In `CUSTOMER`, append the three columns. Copy `ENTRY_TIER_SQL` from `user-segment.service.ts` by importing it: export it there if it is not exported. Do not retype it.

```ts
import { ENTRY_TIER_SQL } from '../user-segment/user-segment.service';
// appended to CUSTOMER:
  (SELECT t.slug FROM customer_metrics m JOIN membership_tiers t ON t.id = COALESCE(m.tier_id, ${ENTRY_TIER_SQL}) WHERE m.user_id = u.id) AS tier_slug,
  sc.cuisine_name, sc.parent_id::text AS cuisine_parent_id
```

Add to the customer `FROM users u` in `build()`:

```sql
LEFT JOIN LATERAL (SELECT cy.cuisine_name, cy.parent_id FROM shop s JOIN cuisine cy ON cy.id = s.cuisine_id
                   WHERE s.company_id = u.company_id ORDER BY s.created_at ASC, s.id ASC LIMIT 1) sc ON true
```

A user with no `customer_metrics` row gets `tier_slug` null. josh's base query falls back to the entry tier in that case. Make the subquery `COALESCE((…), (SELECT slug FROM membership_tiers WHERE id = ${ENTRY_TIER_SQL}))` so both agree. Builder test: the SQL contains `tier_slug` and `cuisine_parent_id`, and the snapshot data exposes them unchanged.

- [ ] **Step 5:** Run the trigger, builder and full commerce-events specs → PASS. Then run the catalog/customer SQL once on `josh_pipe_test` with `psql` (as stage 1 did) to prove the columns exist. Commit: `feat(commerce-events): customer.snapshot carries tier and shop cuisine for commerce segments`.

---

### Task 2: josh — apply segment events from commerce

**Files:**
- Create: `app/user-segment/commerce-segments.service.ts`, `commerce-segments.service.spec.ts`
- Modify: `app/erp/commerce-erp-events.controller.ts` (handler map, around lines 70–90), `app/user-segment/user-segment.module.ts` (export the service), `app/erp/erp.module.ts` (import `UserSegmentModule` if the controller lives there)

**Interfaces:**
- Consumes these event `data` shapes (contract, Task 9 documents them):
  - `segment.upserted`: `{ id, slug, name, description, rule_type, rule_config, definition, priority, is_active, frozen_at: string|null, member_count: number|null }`
  - `segment.deleted`: `{ id }`
  - `segment.members`: `{ segmentId, part: number, parts: number, userIds: string[] }` (parts in order, 1-based, ≤ 5000 ids each)
- Produces: `CommerceSegmentsService.upsert(d)`, `.remove(id)`, `.members(d)`.

- [ ] **Step 1: Failing unit tests** (mock `DataSource.transaction` → manager with `query` recording SQL, the same style as `commerce-snapshot.builder.spec.ts`):

```ts
it('upserts a segment by id with every definition column', async () => {
  await svc.upsert(seg({ id: 'S1', slug: 'vip', frozen_at: '2026-10-07T00:00:00Z', member_count: 2 }));
  expect(sql()[0]).toMatch(/INSERT INTO user_segments .* ON CONFLICT \(id\) DO UPDATE/s);
  expect(params()[0]).toEqual(expect.arrayContaining(['S1', 'vip', 2]));
});
it('members part 1 replaces the snapshot, later parts append, user ids missing in josh are skipped', async () => {
  await svc.members({ segmentId: 'S1', part: 1, parts: 2, userIds: ['u1'] });
  await svc.members({ segmentId: 'S1', part: 2, parts: 2, userIds: ['u2'] });
  expect(sql()).toEqual([
    expect.stringContaining('DELETE FROM segment_membership_snapshots WHERE segment_id = $1'),
    expect.stringMatching(/INSERT INTO segment_membership_snapshots .* SELECT .* FROM users u WHERE u.id = ANY/s),
    expect.stringMatching(/INSERT INTO segment_membership_snapshots/),
  ]);
});
it('delete removes the segment (snapshots cascade or are deleted first)', async () => {
  await svc.remove('S1');
  expect(sql().join(' ')).toMatch(/DELETE FROM segment_membership_snapshots .* DELETE FROM user_segments/s);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**

```ts
@Injectable()
export class CommerceSegmentsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Commerce owns segment definitions (stage 2a): same id, every column, so coupons/banners keep their references. */
  upsert(d: SegmentUpsert) {
    return this.db.query(
      `INSERT INTO user_segments (id, slug, name, description, rule_type, rule_config, definition, priority, is_active, frozen_at, member_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, description = EXCLUDED.description,
         rule_type = EXCLUDED.rule_type, rule_config = EXCLUDED.rule_config, definition = EXCLUDED.definition,
         priority = EXCLUDED.priority, is_active = EXCLUDED.is_active, frozen_at = EXCLUDED.frozen_at,
         member_count = EXCLUDED.member_count, updated_at = now()`,
      [d.id, d.slug, d.name, d.description ?? null, d.rule_type, JSON.stringify(d.rule_config ?? {}),
       d.definition == null ? null : JSON.stringify(d.definition), d.priority ?? 0, d.is_active ?? true, d.frozen_at, d.member_count]);
  }

  remove(id: string) {
    return this.db.transaction(async (m) => {
      await m.query(`DELETE FROM segment_membership_snapshots WHERE segment_id = $1`, [id]);
      await m.query(`DELETE FROM user_segments WHERE id = $1`, [id]);
    });
  }

  /** Parts arrive in order (commerce relay is FIFO); part 1 starts a fresh snapshot. Deleted users drop out (join on users). */
  members(d: SegmentMembers) {
    return this.db.transaction(async (m) => {
      if (d.part === 1) await m.query(`DELETE FROM segment_membership_snapshots WHERE segment_id = $1`, [d.segmentId]);
      await m.query(
        `INSERT INTO segment_membership_snapshots (segment_id, user_id, matched_at)
         SELECT $1, u.id, now() FROM users u WHERE u.id = ANY($2::uuid[])`, [d.segmentId, d.userIds]);
    });
  }
}
```

Before writing, check the real columns: `\d user_segments` and `\d segment_membership_snapshots` on `josh_pipe_test`, and whether `matched_at` has a default. Adjust the column lists to match the database, not this plan.

- [ ] **Step 4: Receiver.** Add to the handler map in `commerce-erp-events.controller.ts`, using the same `one(Dto)` pattern with class-validator DTOs `SegmentUpsertDto`, `SegmentDeletedDto`, `SegmentMembersDto` (`@IsUUID` ids, `@ArrayMaxSize(5000)` userIds, `@IsInt() @Min(1)` part/parts) in `app/erp/dto/segment-events.dto.ts`:

```ts
'segment.upserted': { pipe: one(SegmentUpsertDto), run: (c, d) => c.segments.upsert(d) },
'segment.deleted': { pipe: one(SegmentDeletedDto), run: (c, d) => c.segments.remove(d.id) },
'segment.members': { pipe: one(SegmentMembersDto), run: (c, d) => c.segments.members(d) },
```

Extend the controller test that already covers this map with one case per type (signature + dedupe are inherited).

- [ ] **Step 5:** Run `npx nx test backend --skip-nx-cache -- apps/backend/src/app/user-segment apps/backend/src/app/erp` → PASS. Commit: `feat(user-segment): apply segment definitions and frozen members sent by commerce`.

---

### Task 3: josh — narrow `COMMERCE_OWNS_CUSTOMERS`, stop local freezing, counts for parity, metrics dry run

**Files:**
- Modify:
  - `app/erp/commerce-ownership.flag.ts` (doc comment + `isCommerceOwningCustomers()`)
  - `app/cs-admin/cs-admin.controller.ts`: remove the guard from `PATCH users/:userId`, `PATCH branches/:branchId` and `PATCH credit-applications/:applicationId`; keep it on `PATCH sales-assignment` (CRM, moves in 2b)
  - `app/company/company.controller.ts:263`: remove `assertCompanyAdminEditAllowed()` and delete the now-unused function
  - `app/user-segment/user-segment.controller.ts`: `@UseGuards(CommerceOwnedCustomersGuard)` on create / update / remove only (not promotion mappings, not reads)
  - `app/user-segment/user-segment.service.ts`: first line of `ensureFrozen` and `freezeSegment`: `if (isCommerceOwningCustomers()) return;`
  - `app/customer-metrics/commerce-customer-metrics.controller.ts` + `customer-metrics.service.ts`
- Create: `app/user-segment/commerce-segment-counts.controller.ts`
- Test: `customers-ownership.spec.ts` (new, same metadata style as stage 1's `competitor-ownership.spec.ts`), `commerce-customer-metrics.controller.spec.ts`, `commerce-segment-counts.controller.spec.ts`

**Interfaces:**
- Produces:
  - `POST /api/internal/commerce/segments/counts` (signed with `verifyCommerceSignature`), body `{ ids: string[] }` → `{ counts: Record<string, number> }`. Each count is `previewMemberCount(id)`, i.e. what josh would freeze for that definition now.
  - The metrics receiver accepts `dryRun: true`. josh compares the rows with its `customer_metrics` and answers `{ compared, different, sample: [{ user_id, field, josh, commerce }] (≤ 20) }` without writing.

- [ ] **Step 1: Failing tests.**
  - Guard metadata: segment `create`/`update`/`remove` guarded; `resolve`/`findAll`/`preview`/`updatePromotionMapping` not guarded; cs-admin `updateUser`/branch/credit not guarded; `sales-assignment` guarded.
  - `freezeSegment` with the flag on runs no query.
  - Counts controller: bad signature → 401, two ids → two counts from a mocked `previewMemberCount`.
  - Metrics dry run: a row equal to josh's → `different: 0`; a changed `lifetime_spend` → `different: 1`, with the field in `sample`; `applyFromCommerce` not called.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
  - Metrics dry run: in the controller, if `batch.dryRun`, call a new `metrics.compareFromCommerce(rows)`. It selects the same seven columns for those `user_id`s and compares field by field. Compare numbers as `Number`; compare timestamps as the `::text` the commerce side sends (see `CHANGED_METRICS_SQL`'s comment about microseconds). Return early: no heartbeat, no tiers.
  - Counts controller: `@Public() @SkipThrottle() @Controller('internal/commerce/segments')`, the same as `commerce-backfill.controller.ts`.
- [ ] **Step 4:** Run user-segment, cs-admin, company, customer-metrics and erp specs, plus `npx tsc -p apps/backend/tsconfig.app.json --noEmit` → PASS. Commit: `feat(customers): narrow COMMERCE_OWNS_CUSTOMERS to marketing data; commerce-owned segments; metrics dry run`.

Open the josh PR after this task (Tasks 1–3 are the whole josh side).

---

### Task 4: commerce — tables and the segment base relation

**Files:**
- Create: `apps/commerce-platform/src/migrations/1794300000000-CustomerMarketing.ts`
- Create: `modules/integration/customers/customer-metrics.entity.ts`, `modules/integration/segments/segment.entity.ts` (`Segment`, `SegmentMember`)
- Test: apply / revert / apply on a scratch copy (`commerce_stage2_test`)

**Interfaces:**
- Produces:
  - `customer_metrics(user_id uuid pk, lifetime_order_count int, lifetime_spend numeric(14,2), avg_order_value numeric(14,2), first_order_at timestamptz, last_order_at timestamptz, order_count_90d int, spend_90d numeric(14,2), computed_at timestamptz)`
  - `segments`: the same columns as josh `user_segments` (`id uuid pk`, `slug unique`, `name`, `description`, `rule_type`, `rule_config jsonb`, `definition jsonb`, `priority`, `is_active`, `frozen_at`, `member_count`, `created_at`, `updated_at`)
  - `segment_members(segment_id uuid references segments on delete cascade, user_id uuid, matched_at timestamptz default now(), primary key (segment_id, user_id))`
  - view `segment_customers`: columns `id, first_name, last_name, email, company_id, custype, role, created_at, tier_slug, cuisine_name, cuisine_parent_id`, read from `josh_customers.data` where `deleted_at IS NULL`

- [ ] **Step 1: Migration.**

```ts
export class CustomerMarketing1794300000000 implements MigrationInterface {
  name = 'CustomerMarketing1794300000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE customer_metrics (user_id uuid PRIMARY KEY, lifetime_order_count int NOT NULL DEFAULT 0,
      lifetime_spend numeric(14,2) NOT NULL DEFAULT 0, avg_order_value numeric(14,2) NOT NULL DEFAULT 0,
      first_order_at timestamptz, last_order_at timestamptz, order_count_90d int NOT NULL DEFAULT 0,
      spend_90d numeric(14,2) NOT NULL DEFAULT 0, computed_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE segments (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), slug varchar(80) NOT NULL UNIQUE,
      name varchar(155) NOT NULL, description text, rule_type varchar(40) NOT NULL, rule_config jsonb NOT NULL DEFAULT '{}',
      definition jsonb, priority int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, frozen_at timestamptz,
      member_count int, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE segment_members (segment_id uuid NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      user_id uuid NOT NULL, matched_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (segment_id, user_id))`);
    await q.query(`CREATE INDEX ix_segment_members_user ON segment_members (user_id)`);
    // The compiler's `u` alias (josh: FROM users u). Customers only — staff live segments are matched in josh.
    await q.query(`CREATE VIEW segment_customers AS SELECT c.id,
      c.data->>'first_name' AS first_name, c.data->>'last_name' AS last_name, c.data->>'email' AS email,
      (c.data->>'company_id')::uuid AS company_id, c.data->>'custype' AS custype, c.data->>'role' AS role,
      (c.data->>'created_at')::timestamptz AS created_at, c.data->>'tier_slug' AS tier_slug,
      c.data->>'cuisine_name' AS cuisine_name, (c.data->>'cuisine_parent_id')::uuid AS cuisine_parent_id
      FROM josh_customers c WHERE c.deleted_at IS NULL`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP VIEW segment_customers`);
    await q.query(`DROP TABLE segment_members`);
    await q.query(`DROP TABLE segments`);
    await q.query(`DROP TABLE customer_metrics`);
  }
}
```

Check `josh_customers` column names (`id`, `data`, `deleted_at`) against `josh-customer-copy.entity.ts` before running.

- [ ] **Step 2:** Write the entities with column-for-column decorators and register them in the new modules (Tasks 5–6).
- [ ] **Step 3:** Copy the dev DB to a scratch DB (`createdb commerce_stage2_test && pg_dump --no-owner --no-acl commerce_db | psql -q -d commerce_stage2_test`). Then run `COMMERCE_DATABASE_URL=postgres:///commerce_stage2_test npm run migration:run`, `migration:revert`, `migration:run` → all succeed. Commit: `feat(customers): customer_metrics, segments, segment_members and the segment base view`.

---

### Task 5: commerce — customer metrics from the order copy

**Files:**
- Create: `modules/integration/customers/customer-metrics.service.ts`, `customer-metrics.service.spec.ts`, `customers.module.ts`
- Delete: `modules/integration/connector/josh/customer-metrics-offload.job.ts` (+ its spec and its provider in `josh.module.ts`). `JOSH_ACTIVE_ORDER_STATUSES` moves to the new service.
- Modify: `config/cron.config.ts` (`joshCustomerMetrics` keeps its name and env, so ops change nothing), `.env.example` (`CUSTOMER_METRICS_TO_JOSH=off`)

**Interfaces:**
- Produces:
  - `CustomerMetricsService.recompute(): Promise<{ changed: string[] }>`: writes commerce `customer_metrics` and returns the user ids whose row changed.
  - `.push(mode: 'shadow'|'on'): Promise<{ sent: number; different?: number }>`
  - Env `CUSTOMER_METRICS_TO_JOSH = off | shadow | on` (default `off`).

- [ ] **Step 1: Failing tests**, against a real DB, opt-in with `CUSTOMERS_TEST_DATABASE_URL`, like `competitor-review.db.spec.ts`:
  - Seed `josh_customers` with 2 customers and `josh_orders` with 3 orders: one `cancelled`, one 120 days old, one 5 days old.
  - `recompute()` expects lifetime count 2 (cancelled excluded), `order_count_90d` 1, `first_order_at` = the 120-day order, and `changed` containing the user.
  - A second `recompute()` → `changed: []`.
  - A deleted customer (`josh_customers.deleted_at` set) gets no row.
  - Unit test with a mocked `postToJosh`: `push('shadow')` sends `dryRun: true` and never `done`; `push('on')` sends rows then `done: true` with `statuses: JOSH_ACTIVE_ORDER_STATUSES`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** The SQL is the old `CHANGED_METRICS_SQL` moved onto commerce tables:
  - `orders` → `josh_orders o JOIN segment_customers c ON c.id = o.user_id::uuid`
  - columns: `status`, `user_id`, `total_price`, `create_date`; check the names in `josh-order-copy.entity.ts`; `toHead` maps josh's columns
  - the diff target is commerce's own `customer_metrics`
  - writes with `INSERT … ON CONFLICT (user_id) DO UPDATE … RETURNING user_id`
  - users present in `customer_metrics` but gone from `segment_customers` are deleted

  `push` sends the changed rows (text timestamps, as before) in batches of 1000 through `postToJosh('/internal/customer-metrics', …)`. The cron:

```ts
@Cron(cronConfig.joshCustomerMetrics.expression, { timeZone: cronConfig.joshCustomerMetrics.timeZone, disabled: !cronConfig.joshCustomerMetrics.enabled })
async scheduled() {
  if (this.running) return;
  this.running = true;
  try {
    const { changed } = await this.recompute();
    const mode = process.env.CUSTOMER_METRICS_TO_JOSH;
    if ((mode === 'shadow' || mode === 'on') && joshApiConfigured()) this.logger.log(`customer metrics → josh (${mode}): ${JSON.stringify(await this.push(mode))}`);
    else this.logger.log(`customer metrics recomputed: ${changed.length} changed`);
  } catch (error) {
    this.logger.error(`customer metrics failed — josh's own cron runs: ${error instanceof Error ? error.message : error}`);
  } finally { this.running = false; }
}
```

  `push` sends all rows on the first `on` run after a `shadow` period. Track `pushed_at` in a `settings` row (`scope 'customers', key 'metrics_pushed_at'`; read the existing settings table helper used by scraping automation). On later runs send only rows with `computed_at > pushed_at`.
- [ ] **Step 4:** Run the DB spec (`CUSTOMERS_TEST_DATABASE_URL=postgres:///commerce_stage2_test`) and the unit spec → PASS. Commit: `feat(customers): customer metrics computed from the josh order copy; push off/shadow/on`.

---

### Task 6: commerce — segment compiler and service (port of josh `user-segment`)

**Files:**
- Create under `modules/integration/segments/`:
  - `segment-fields.ts`: copy of josh `app/user-segment/segment-fields.ts`, unchanged; the aliases stay `u`, `m`, `t`, `cy`
  - `segment-definition.compiler.ts`, `legacy-rule.compiler.ts`, `dto/segment-definition.dto.ts`, `dto/user-segment.dto.ts`, `dto/preview-segment.dto.ts`, `dto/list-members-query.dto.ts`, `dto/resolve-segment-users.dto.ts`, `segment.types.ts`: copies from josh `origin/main`, with only import paths changed
  - `segments.service.ts`, `segment-events.ts`, `segments.controller.ts`, `segments.module.ts`
- Test: copy josh's specs for the compilers (`segment-definition.compiler.spec.ts`, `legacy-rule.compiler.spec.ts`), unchanged; plus `segments.service.db.spec.ts` (opt-in DB)

**Interfaces:**
- Consumes: Task 4 tables and view; Task 5 `customer_metrics`.
- Produces:
  - `SEGMENT_BASE_FROM` (commerce):

```ts
/** josh's SEGMENT_BASE_FROM over commerce's copies: same aliases, so josh's field SQL and compilers run unchanged. */
export const SEGMENT_BASE_FROM = `
  FROM segment_customers u
  LEFT JOIN customer_metrics m ON m.user_id = u.id
  LEFT JOIN LATERAL (SELECT u.tier_slug AS slug) t ON true
  LEFT JOIN LATERAL (SELECT u.cuisine_name AS cuisine_name, u.cuisine_parent_id AS parent_id) cy ON true`;
```

  - `SegmentsService`: `findAll()`, `findOne(id)`, `create(dto, actor)`, `update(id, dto, actor)`, `remove(id)`, `previewCount(definition)`, `previewMemberCount(id)`, `listMembers(id, query)`, `resolveUsers(dto)`.
  - Josh's JSON shapes and `{ status, data, message }` envelope under `/api/user-segments/*`, so the josh admin page works unchanged.
  - Domain events `SegmentUpserted`, `SegmentDeleted`, `SegmentMembers` (types `segment.upserted|deleted|members`, `snapshot: false`).

- [ ] **Step 1:** Copy the josh compiler specs; run → FAIL (modules missing).
- [ ] **Step 2: Port.** Bring the josh files over with only import changes, then run the specs → PASS.
- [ ] **Step 3: `SegmentsService` port.** Take josh `user-segment.service.ts` methods `findAll`, `findOne`, `create`, `update`, `remove`, `previewCount`, `previewMemberCount`, `listMembers`, `listMembersForSegment`, `resolveUsers`, `freezeSegment`, `matchesRule` (with `countOrdersWithinDays`, `sumOrderValueWithinDays`) and `isLiveSegment` / `isDeviceLevelSegment`. Mechanical edits:
  1. `UserSegment` → `Segment`; `segment_membership_snapshots` → `segment_members`; `users u` base → commerce `SEGMENT_BASE_FROM`.
  2. Order history in `matchesRule` reads `josh_orders` (columns as in Task 5) with the active statuses list from Task 5.
  3. Drop everything about banners, coupons and promotions (`listBannerTargeting`, `addPromotion`, `removePromotion`, `updatePromotionMapping`, `resolveForUser`, `userMatchesSegment`). Those stay in josh.
  4. PII masking: reuse commerce's `winback/pii.helper.ts` `maskPersonName` / `maskEmail` if present, else copy josh's two helpers into `segments/pii.ts`. Full names only for `admin`/`marketing` staff roles.
  5. Wrap `create`, `update` and `remove` in one transaction that also publishes events through `EventEmitterBus.publish(event, manager)`:
     - `create`/`update`: `SegmentUpserted` with the row first. If the segment is non-live and now frozen, follow it with `SegmentMembers` parts of 5000 ids (`part` 1..n).
     - Order matters: josh's snapshot rows may reference `user_segments`, so the segment must exist before its members. The relay is FIFO, so josh sees an empty frozen segment only for the milliseconds between the events.
     - `remove`: `SegmentDeleted`.
     - Writes answer `409 'segment ยังเป็นของ josh — เปิด COMMERCE_OWNS_SEGMENTS'` unless commerce env `COMMERCE_OWNS_SEGMENTS === 'true'`.
- [ ] **Step 4: DB spec** (opt-in, `commerce_stage2_test`):
  - Seed 3 customers (`josh_customers.data` with `custype`, `role`, `company_id`, `created_at`, `tier_slug`, `cuisine_name`) and metrics.
  - (a) `previewCount({ all: [{ field: 'lifetime_spend', op: '>=', value: 1000 }] })` equals the hand count.
  - (b) With `COMMERCE_OWNS_SEGMENTS=true`, `create` of a non-live definition writes `segment_members`, sets `frozen_at` / `member_count`, and leaves outbox rows `segment.upserted` then `segment.members` (part 1/1), in that order.
  - (c) A live `rule_type: 'custype'` segment is not frozen: no members, no members event.
  - (d) `remove` → `segment.deleted` and the members are gone.
  - (e) The flag off → `create` rejects 409.
- [ ] **Step 5: Controller.** Routes as josh's `user-segment.controller.ts`: `GET /`, `GET :id`, `POST /`, `PATCH :id`, `DELETE :id`, `POST preview`, `GET :id/preview`, `GET :id/members`, `POST resolve-users`. Use `@StaffRoles('marketing')` like `competitor-prices.controller.ts`, and the same `result()` envelope helper as there. Run all segment specs → PASS. Commit: `feat(segments): commerce owns segment definitions and frozen members (port of josh user-segment)`.

---

### Task 7: commerce — PDPA and the admin page switch

**Files:**
- Modify: `modules/integration/connector/josh/events/josh-events.service.ts` (`customer.deleted`), its spec
- Create: `modules/platform/settings/ownership.controller.ts` (+ spec), registered in the existing settings or platform module
- Modify: `apps/commerce-admin/src/josh-admin/libs/shared-api/lib/api-client/commerce-client.ts`, `user-segment/user-segment.api.ts`

- [ ] **Step 1: PDPA test.** `customer.deleted` for `u1` also runs `DELETE FROM customer_metrics WHERE user_id = $1` and `DELETE FROM segment_members WHERE user_id = $1`. Recompute `member_count` of the affected segments: `UPDATE segments SET member_count = (SELECT count(*) FROM segment_members WHERE segment_id = segments.id) WHERE id IN (…)`. Do it all inside the same guarded transaction. Run → FAIL → implement → PASS. Josh drops the user from its own snapshots through its own user delete; Task 10 verifies both sides end to end.
- [ ] **Step 2: Ownership endpoint.** `GET /api/ownership` (any signed-in staff) → `{ segments: process.env.COMMERCE_OWNS_SEGMENTS === 'true' }`. One test.
- [ ] **Step 3: Admin switch.** In `commerce-client.ts`, export:

```ts
let owned: Promise<{ segments: boolean }> | null = null;
/** Which josh features commerce owns right now (GET /api/ownership), fetched once per page load. */
export const ownership = () => (owned ??= request<{ segments: boolean }>('/ownership').catch(() => ({ segments: false })));
```

  In `user-segment.api.ts`, route the definition calls with `const client = async () => ((await ownership()).segments ? commerceClient : apiClient);`. The definition calls are list, get, create, update, delete, preview, `:id/preview`, members and resolve-users. Fields, banner-targeting and promotion-mapping calls keep `apiClient`, because that data is josh-owned. Change each call site from `apiClient.x(...)` to `(await client()).x(...)`. Make the functions async where they are not already.
- [ ] **Step 4:** `npx tsc -p apps/commerce-admin/tsconfig.app.json --noEmit` and `npx nx build commerce-admin --skip-nx-cache` → pass. Commit: `feat(segments): PDPA delete wipes commerce metrics and memberships; admin segment pages follow ownership`.

---

### Task 8: commerce — one-off import and parity

**Files:**
- Modify: `cli/import-from-josh.ts`. Add scope `segments`: plans `{ table: 'user_segments' → target 'segments' }` and `{ table: 'segment_membership_snapshots' → 'segment_members', key: 'segment_id,user_id' }`. Extend `Plan` with `target?: string` (default = `table`) and allow a composite `key`. Copy only snapshot rows whose `user_id` exists in `josh_customers`.
- Create: `cli/segment-parity.ts`, `package.json` script `segment-parity`
- Test: run against scratch DBs (Task 10)

- [ ] **Step 1:** Implement the import changes and keep `npm run import-from-josh -- all` working. Scopes run in the order research, scraping, competitor, segments.
- [ ] **Step 2: `segment-parity`.**
  - For every active segment that is not device-level, compute commerce `previewMemberCount(id)`.
  - Fetch josh's counts with `postToJosh('/internal/commerce/segments/counts', { ids })`.
  - Print `{ segments, same, different: [{ id, slug, josh, commerce }] }`.
  - Staff-only live types (`staff`, `role` matching internal roles) are listed but not counted as different, because commerce copies customers only. Exit code 1 if `different` is non-empty.
- [ ] **Step 3:** Commit: `feat(segments): import josh segments and members; segment-parity check`.

---

### Task 9: docs and runbook

**Files:**
- Modify: `docs/event-contract.md`:
  - §3: rows for `segment.upserted` / `segment.deleted` / `segment.members` (data shapes from Task 2); not `snapshot`; parts in order
  - §5: josh handlers
  - §6: `customer.snapshot` new fields
- Create: `docs/runbooks/stage2a-customer-marketing-cutover.md`:
  1. Deploy commerce (migration `1794300000000`) and josh (migration `1792330000000`), flags off.
  2. `POST /api/reports/order-copy/backfill {"group":"customer"}`, so every customer gets `tier_slug` / cuisine.
  3. Shadow week, metrics: commerce `CUSTOMER_METRICS_TO_JOSH=shadow`. Each night josh logs `different` (expect 0 after the first night). Fix before going on.
  4. Shadow week, segments: run `JOSH_DATABASE_URL=<read-only> npm run import-from-josh -- segments`, then `npm run segment-parity` daily. Expect only explained differences.
  5. Switch day:
     - Announce a 15-minute freeze on segment edits.
     - Set josh `COMMERCE_OWNS_CUSTOMERS=true`. This locks segment writes and sales assignment, and unlocks CS user/branch/credit/company edits.
     - Re-run `import-from-josh -- segments`.
     - Set commerce `COMMERCE_OWNS_SEGMENTS=true` and `CUSTOMER_METRICS_TO_JOSH=on`.
     - Add `segment.upserted`, `segment.deleted`, `segment.members` to josh's webhook subscription `eventTypes` in commerce-admin → Webhooks.
     - Create one test segment in commerce-admin → it appears in josh admin with the same id and member count.
  6. Rollback: josh flag off (josh edits and freezes again), commerce `COMMERCE_OWNS_SEGMENTS=false`, `CUSTOMER_METRICS_TO_JOSH=off`, remove the three event types from the subscription. Segments created in commerce in the meantime are already in josh (same ids).
- Modify: the plan's checklist mapping (below).
- [ ] **Step 1:** Write both docs. Commit: `docs(stage2a): segment events in the contract; cutover runbook`.

---

### Task 10: end to end on scratch databases

Use the same setup as stage 1:
- `josh_pipe_test` and `commerce_stage2_test` copied from the local dev DBs;
- commerce built and running on :3199 with `JOSH_EVENTS_SECRET=dev-pipe`;
- a josh harness script run with `ts-node` (template: stage 1's `stage1-e2e.tmp.ts`, recorded in the stage-1 plan's As-built notes);
- for commerce → josh delivery, a webhook subscription in `commerce_stage2_test` pointing at a josh harness receiver. Alternatively, call `CommerceSegmentsService` directly with the outbox payloads read from `outbox_messages`.

- [ ] **Step 1:** Customer backfill → commerce `segment_customers` has `tier_slug` for every customer who has metrics in josh.
- [ ] **Step 2:** Metrics:
  - order backfill, then `recompute()`;
  - shadow push → josh `different` count;
  - investigate until 0, or until each difference is explained, e.g. an order not yet copied.
- [ ] **Step 3:** Segments:
  - `import-from-josh -- segments`, then `segment-parity` → `different: []` apart from staff-only live segments;
  - create a frozen segment in commerce → apply its outbox events to josh → josh `user_segments` row + snapshots match, and josh coupon `generateFromSegment` resolves the same user ids (call `UserSegmentService.resolveUserIdsForSegment` in the harness).
- [ ] **Step 4:** PDPA: delete a customer in josh → drain → commerce `josh_customers.deleted_at` set, the `customer_metrics` row gone, `segment_members` rows gone, `member_count` lowered; josh's own snapshot rows for the user gone.
- [ ] **Step 5:** Flags: josh `COMMERCE_OWNS_CUSTOMERS=true` → segment create 403, CS user edit 200, sales assignment 403, `freezeSegment` makes no query.
- [ ] **Step 6:** Full suites (commerce `npx jest -c apps/commerce-platform/jest.config.cts`, josh `npx nx test backend --skip-nx-cache`) → only the known `pii-leak.spec.ts` failure. Record the results in an "As built" section of this plan. Drop the scratch DBs. Commit.

---

## Checklist mapping (artifact `s2-*`)

| item | tasks |
|---|---|
| s2-1 narrow `COMMERCE_OWNS_CUSTOMERS` | 3 |
| s2-2 segment / tag / consent / CRM screens in commerce-admin | 6, 7. Segment pages follow ownership. Tags don't exist. Consent stays customer-written in josh (read in commerce). CRM = 2b |
| s2-3 commerce → josh tag / segment the shop uses | 2, 6 (definitions + frozen members → josh tables the shop already reads) |
| s2-4 PDPA both sides | 7, 10 step 4 |
| s2-5 shadow 1 week then switch | 5 (metrics shadow), 8 (segment parity), runbook |
| (new) customer metrics owned by commerce | 4, 5 |

**2b (separate plan, next):** winback CRM (leads, contacts, activities, diary, pool, scorecards, sales assignment) on commerce data. It replaces `modules/integration/winback/*`'s replica reads.
