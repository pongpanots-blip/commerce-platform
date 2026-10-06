# Stage 0 — Two-way event pipe (josh ⇄ commerce) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** josh pushes order and customer snapshots to commerce through a transactional outbox, both sides drop stale events by version, and josh keeps a forward copy of every direct ERP call so commerce can catch up after an outage.

**Architecture:** In josh, Postgres triggers enqueue `(type, aggregate_id)` rows into `commerce_outbox` inside the writing transaction. A timer-driven drainer, active only when `JOSH_EVENTS_TO_COMMERCE_ENABLED=true`, claims rows with `FOR UPDATE SKIP LOCKED`, builds the latest full snapshot plus `nextval('commerce_snapshot_seq')` as the version, and POSTs HMAC-signed JSON to commerce. Commerce verifies the signature over the raw body and upserts into its existing `josh_orders` / `josh_order_lines` tables and a new `josh_customers` table, but only when the version is newer. josh's stock writer `handleQtyChange` gains a `CHANGED_AT` version guard that covers both the direct ERP route and commerce events.

**Tech Stack:** NestJS 10, TypeORM 0.3 (raw SQL migrations), Postgres 16, Jest (ts-jest), native `fetch`, `node:crypto` HMAC-SHA256.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` (§2, §3.1, §3.3, §5 and §6). Executors should read it first.

## Global Constraints

- josh must not get slower. Every josh change is additive and default-off. Triggers do one INSERT per changed row. The drainer runs on a timer, not after every commit.
- josh `/api/erp/*` always accepts ERP calls. Never gate or remove these routes.
- Only the literal `'true'` turns a flag on: `JOSH_EVENTS_TO_COMMERCE_ENABLED === 'true'`.
- Signing: josh signs josh→commerce bodies with `COMMERCE_EVENTS_SECRET`. Commerce verifies them with `JOSH_EVENTS_SECRET`. Ops sets both to the same value. In production, both sides fail closed when the secret is unset.
- Envelope: `{ type, aggregateId, version, occurredAt, data }`. `version` is a decimal string (bigint).
- Never send `users.password` or `users.token_version`.
- Migration names are `<13-digit ms timestamp>-PascalName.ts`, with class `PascalName<ts>` and `name = 'PascalName<ts>'`. The timestamp must be greater than the newest file in that repo. Generate it with `date +%s%3N`.
- Push rule (user): keep commits local and push once at the end of the work round.

## Out of scope (later stages, per spec §4.2)

- `inventory.sellable.snapshot` (commerce→josh aggregate stock) and its josh consumer → stage 3 (stock).
- Turning `erp.fallback.received` into ledger movements in commerce → stage 3. Stage 0 only stores the calls.
- New `COMMERCE_OWNS_*` flags and guards → stages 1–4.
- Backfill for groups other than `order` and `customer` → their stages.
- Commerce-internal domain events for the order copy. No consumer exists yet. Also, any dotted event type is forwarded by `webhook-dispatcher` to `*` subscriptions, which could loop back to josh.

---

## File structure

**josh** (`/Users/pongpanot_s/Documents/dev/josh`, worktree from `origin/main`; all paths under `apps/backend/src/`)

| File | Responsibility |
|---|---|
| `migrations/<ts>-CommerceOutbox.ts` | `commerce_outbox`, `commerce_snapshot_seq`, `commerce_applied_versions`, trigger function and triggers |
| `entities/commerce-outbox.entity.ts` | TypeORM entity (so the table is known; queries are raw SQL) |
| `app/commerce-events/commerce-events.flag.ts` | `isJoshEventsToCommerceEnabled()` |
| `app/commerce-events/commerce-snapshot.builder.ts` | Builds the `order` / `customer` snapshot plus the version from josh's DB |
| `app/commerce-events/commerce-events.client.ts` | Signed POST to commerce |
| `app/commerce-events/commerce-outbox.drainer.ts` | Claims, sends, marks sent / backs off; prunes |
| `app/commerce-events/commerce-outbox.scheduler.ts` | 3 s interval drain plus hourly prune |
| `app/commerce-events/erp-fallback.interceptor.ts` | Records successful direct `/api/erp/*` calls as `erp.fallback` rows |
| `app/commerce-events/commerce-backfill.controller.ts` | `POST /internal/commerce/backfill` (signed): enqueue every order / customer |
| `app/commerce-events/commerce-events.module.ts` | Wires the above |
| `app/erp/applied-version.ts` | `applyIfNewer(manager, type, id, version)` |
| `app/erp/erp-webhook.service.ts` (modify) | `handleQtyChange` uses `applyIfNewer` when `CHANGED_AT` is present |
| `app/erp/erp-webhook.controller.ts` (modify) | `@UseInterceptors(ErpFallbackInterceptor)` |
| `app/app.module.ts` (modify) | import `CommerceEventsModule` |

**commerce** (worktree `.../ec2-pricing-calculation-1bcded`, new branch from `origin/master`; paths under `apps/commerce-platform/src/`)

| File | Responsibility |
|---|---|
| `migrations/<ts>-JoshEventsInbound.ts` | `josh_orders.source_version`, `josh_customers`, `josh_erp_fallback_calls` |
| `modules/integration/connector/josh/events/josh-customer-copy.entity.ts` | `josh_customers` entity |
| `modules/integration/connector/josh/events/josh-erp-fallback-call.entity.ts` | `josh_erp_fallback_calls` entity |
| `modules/integration/connector/josh/events/josh-events.signature.ts` | `verifyJoshSignature(rawBody, signature)` |
| `modules/integration/connector/josh/events/josh-events.service.ts` | Version-guarded apply for each event type |
| `modules/integration/connector/josh/events/josh-events.controller.ts` | `POST /internal/josh-events`, plus the admin `POST /reports/order-copy/backfill` |
| `modules/integration/connector/josh/orders/josh-order-copy.ts` (modify) | export `toHead`, `toLine`, `Row` |
| `modules/integration/connector/josh/orders/josh-order-copy.entity.ts` (modify) | `sourceVersion` column |
| `modules/integration/connector/josh/josh.module.ts` (modify) | register entities, service and controllers |
| `docs/event-contract.md` (modify) | fix the retry line; add the josh→commerce section |

---

### Task 1: josh — worktree and outbox schema

**Files:**
- Create: `apps/backend/src/migrations/<ts>-CommerceOutbox.ts`
- Create: `apps/backend/src/entities/commerce-outbox.entity.ts`
- Test: `apps/backend/src/app/commerce-events/commerce-outbox.trigger.db.spec.ts` (opt-in; real DB)

**Interfaces:**
- Produces:
  - table `commerce_outbox(id bigserial, type varchar(40), aggregate_id uuid, payload jsonb null, created_at, next_attempt_at, claimed_until, attempts int, last_error text, sent_at)`
  - sequence `commerce_snapshot_seq`
  - table `commerce_applied_versions(aggregate_type varchar(40), aggregate_id varchar(100), version timestamptz, PK(aggregate_type, aggregate_id))`
  - Row `type` values: `'order' | 'customer' | 'customer.deleted' | 'erp.fallback'`

- [ ] **Step 1: Create a josh worktree and branch from `origin/main`.** The local checkout is on a stale branch; don't touch it.

```bash
git -C /Users/pongpanot_s/Documents/dev/josh fetch origin
git -C /Users/pongpanot_s/Documents/dev/josh worktree add ../josh-worktrees/commerce-event-pipe -b feat/commerce-event-pipe origin/main
cd /Users/pongpanot_s/Documents/dev/josh-worktrees/commerce-event-pipe && npm ci
ls apps/backend/src/migrations | sort | tail -1   # newest timestamp; yours must be larger
date +%s%3N
```

- [ ] **Step 2: Write the failing DB test** (opt-in, same pattern as `my-orders-summary.scope.spec.ts`)

```ts
// apps/backend/src/app/commerce-events/commerce-outbox.trigger.db.spec.ts
import { DataSource } from 'typeorm';

const url = process.env.JOSH_SCOPE_TEST_DATABASE_URL;
(url ? describe : describe.skip)('commerce_outbox triggers (real DB, migrated)', () => {
  let db: DataSource;
  beforeAll(async () => { db = await new DataSource({ type: 'postgres', url }).initialize(); });
  afterAll(async () => { await db?.destroy(); });
  beforeEach(async () => { await db.query('DELETE FROM commerce_outbox'); });

  it('enqueues an order row when an order status changes, inside the same transaction', async () => {
    const [order] = await db.query(`SELECT orders_id FROM orders LIMIT 1`);
    await db.query(`UPDATE orders SET remark = coalesce(remark,'') WHERE orders_id = $1`, [order.orders_id]);
    const rows = await db.query(`SELECT type, aggregate_id FROM commerce_outbox`);
    expect(rows).toEqual([{ type: 'order', aggregate_id: order.orders_id }]);
  });

  it('enqueues the parent order for an order_items change', async () => {
    const [item] = await db.query(`SELECT id, order_id FROM order_items LIMIT 1`);
    await db.query(`UPDATE order_items SET product_quantity = product_quantity WHERE id = $1`, [item.id]);
    const rows = await db.query(`SELECT type, aggregate_id FROM commerce_outbox`);
    expect(rows).toEqual([{ type: 'order', aggregate_id: item.order_id }]);
  });

  it('enqueues customers only (not internal staff)', async () => {
    const [staff] = await db.query(`SELECT u.id FROM users u JOIN app_roles r ON r.code = u.role WHERE r.user_type = 'internal' LIMIT 1`);
    const [customer] = await db.query(`SELECT u.id FROM users u JOIN app_roles r ON r.code = u.role WHERE r.user_type = 'customer' LIMIT 1`);
    await db.query(`UPDATE users SET nickname = nickname WHERE id = ANY($1)`, [[staff.id, customer.id]]);
    const rows = await db.query(`SELECT type, aggregate_id FROM commerce_outbox`);
    expect(rows).toEqual([{ type: 'customer', aggregate_id: customer.id }]);
  });
});
```

- [ ] **Step 3: Run it against a scratch DB to confirm it fails** (the table doesn't exist yet)

```bash
createdb josh_pipe_test && pg_dump --schema-only "$JOSH_LOCAL_DB" | psql josh_pipe_test   # or restore the seed DB you use locally
JOSH_SCOPE_TEST_DATABASE_URL=postgres:///josh_pipe_test npx nx test backend -- apps/backend/src/app/commerce-events/commerce-outbox.trigger.db.spec.ts
```

Expected: FAIL with `relation "commerce_outbox" does not exist`.

- [ ] **Step 4: Write the migration.** Replace `<TS>` with your timestamp.

```ts
// apps/backend/src/migrations/<TS>-CommerceOutbox.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * josh → commerce event pipe (spec 2026-10-06 §2.2). Triggers enqueue (type, aggregate_id) in the
 * writing transaction: one INSERT per changed row. The drainer sends the latest snapshot later and only
 * when JOSH_EVENTS_TO_COMMERCE_ENABLED=true. commerce_applied_versions guards commerce→josh and direct
 * ERP qty writes against older events (§2.3).
 */
export class CommerceOutbox<TS> implements MigrationInterface {
  name = 'CommerceOutbox<TS>';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS commerce_outbox (
      id BIGSERIAL PRIMARY KEY,
      type varchar(40) NOT NULL,
      aggregate_id uuid NOT NULL,
      payload jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      claimed_until timestamptz NULL,
      attempts int NOT NULL DEFAULT 0,
      last_error text NULL,
      sent_at timestamptz NULL)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_commerce_outbox_due ON commerce_outbox (next_attempt_at, id) WHERE sent_at IS NULL`);
    await q.query(`CREATE SEQUENCE IF NOT EXISTS commerce_snapshot_seq`);
    await q.query(`CREATE TABLE IF NOT EXISTS commerce_applied_versions (
      aggregate_type varchar(40) NOT NULL,
      aggregate_id varchar(100) NOT NULL,
      version timestamptz NOT NULL,
      PRIMARY KEY (aggregate_type, aggregate_id))`);
    await q.query(`CREATE OR REPLACE FUNCTION commerce_outbox_enqueue() RETURNS trigger AS $$
      DECLARE agg uuid; t text := 'order';
      BEGIN
        IF TG_TABLE_NAME = 'orders' THEN
          agg := NEW.orders_id;
        ELSIF TG_TABLE_NAME IN ('order_items', 'payment_transaction_orders') THEN
          agg := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
        ELSIF TG_TABLE_NAME = 'payment_transactions' THEN
          agg := NEW.order_id;
          -- batch payments link orders through payment_transaction_orders
          INSERT INTO commerce_outbox (type, aggregate_id)
            SELECT 'order', pto.order_id FROM payment_transaction_orders pto WHERE pto.transaction_id = NEW.id;
        ELSIF TG_TABLE_NAME = 'users' THEN
          IF TG_OP = 'DELETE' THEN
            IF NOT EXISTS (SELECT 1 FROM app_roles r WHERE r.code = OLD.role AND r.user_type = 'customer') THEN RETURN NULL; END IF;
            t := 'customer.deleted'; agg := OLD.id;
          ELSE
            IF NOT EXISTS (SELECT 1 FROM app_roles r WHERE r.code = NEW.role AND r.user_type = 'customer') THEN RETURN NULL; END IF;
            t := 'customer'; agg := NEW.id;
          END IF;
        END IF;
        IF agg IS NOT NULL THEN INSERT INTO commerce_outbox (type, aggregate_id) VALUES (t, agg); END IF;
        RETURN NULL;
      END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_orders AFTER INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION commerce_outbox_enqueue()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_order_items AFTER INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION commerce_outbox_enqueue()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_payment_tx AFTER INSERT OR UPDATE ON payment_transactions FOR EACH ROW EXECUTE FUNCTION commerce_outbox_enqueue()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_payment_tx_orders AFTER INSERT ON payment_transaction_orders FOR EACH ROW EXECUTE FUNCTION commerce_outbox_enqueue()`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_users AFTER INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION commerce_outbox_enqueue()`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const [trg, tbl] of [['commerce_outbox_users', 'users'], ['commerce_outbox_payment_tx_orders', 'payment_transaction_orders'],
      ['commerce_outbox_payment_tx', 'payment_transactions'], ['commerce_outbox_order_items', 'order_items'], ['commerce_outbox_orders', 'orders']]) {
      await q.query(`DROP TRIGGER IF EXISTS ${trg} ON ${tbl}`);
    }
    await q.query(`DROP FUNCTION IF EXISTS commerce_outbox_enqueue()`);
    await q.query(`DROP TABLE IF EXISTS commerce_applied_versions`);
    await q.query(`DROP SEQUENCE IF EXISTS commerce_snapshot_seq`);
    await q.query(`DROP TABLE IF EXISTS commerce_outbox`);
  }
}
```

- [ ] **Step 5: Add the entity** (mirrors `order-settled-outbox.entity.ts`; the app only uses raw SQL against it)

```ts
// apps/backend/src/entities/commerce-outbox.entity.ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** josh → commerce outbox, filled by DB triggers (migration CommerceOutbox). Partial index is SQL-only. */
@Entity('commerce_outbox')
export class CommerceOutbox {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: string;
  @Column({ type: 'varchar', length: 40 }) type: string;
  @Column({ type: 'uuid' }) aggregate_id: string;
  @Column({ type: 'jsonb', nullable: true }) payload: unknown;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamptz', default: () => 'now()' }) next_attempt_at: Date;
  @Column({ type: 'timestamptz', nullable: true }) claimed_until: Date | null;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @Column({ type: 'text', nullable: true }) last_error: string | null;
  @Column({ type: 'timestamptz', nullable: true }) sent_at: Date | null;
}
```

- [ ] **Step 6: Migrate the scratch DB and run the test**

```bash
DATABASE_URL=postgres:///josh_pipe_test npm run migration:run
JOSH_SCOPE_TEST_DATABASE_URL=postgres:///josh_pipe_test npx nx test backend -- apps/backend/src/app/commerce-events/commerce-outbox.trigger.db.spec.ts
```

Expected: PASS (3 tests). Then revert it once to confirm `down` works, and migrate again:

```bash
DATABASE_URL=postgres:///josh_pipe_test npm run migration:revert && DATABASE_URL=postgres:///josh_pipe_test npm run migration:run
```

- [ ] **Step 7: Measure the trigger cost** (spec §6: josh must not get slower)

```bash
psql josh_pipe_test -c "EXPLAIN (ANALYZE, BUFFERS) UPDATE orders SET remark = remark WHERE orders_id IN (SELECT orders_id FROM orders LIMIT 200)"
```

Expected: trigger time is listed under `Trigger commerce_outbox_orders` and stays well under 1 ms per row. Paste the number into the commit message.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/migrations/*-CommerceOutbox.ts apps/backend/src/entities/commerce-outbox.entity.ts apps/backend/src/app/commerce-events/commerce-outbox.trigger.db.spec.ts
git commit -m "feat(commerce-events): commerce_outbox + triggers on orders/items/payments/customers, applied-versions table"
```

---

### Task 2: josh — snapshot builder

**Files:**
- Create: `apps/backend/src/app/commerce-events/commerce-snapshot.builder.ts`
- Test: `apps/backend/src/app/commerce-events/commerce-snapshot.builder.spec.ts`

**Interfaces:**
- Consumes: `commerce_snapshot_seq` (Task 1)
- Produces:

```ts
export type SnapshotType = 'order' | 'customer';
export interface Snapshot { type: 'order.snapshot' | 'customer.snapshot'; aggregateId: string; version: string; occurredAt: string; data: unknown }
export class CommerceSnapshotBuilder { build(type: SnapshotType, ids: string[]): Promise<Snapshot[]> }
```

  `order.snapshot` `data` is `{ order: OrderHeadRow, items: OrderItemRow[] }`. Its column aliases match commerce's `HEAD` / `save()` SQL in `josh-order-copy.ts` exactly, so commerce's `toHead` / `toLine` work unchanged. A missing aggregate (deleted) yields no snapshot.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/app/commerce-events/commerce-snapshot.builder.spec.ts
import { CommerceSnapshotBuilder } from './commerce-snapshot.builder';

function makeBuilder(results: unknown[][]) {
  const query = jest.fn();
  results.forEach((r) => query.mockResolvedValueOnce(r));
  return { builder: new CommerceSnapshotBuilder({ query } as never), query };
}

describe('CommerceSnapshotBuilder', () => {
  it('builds one order snapshot per existing order with its items and a sequence version', async () => {
    const { builder, query } = makeBuilder([
      [{ orders_id: 'o1', status: 'paid', version: '42' }],           // heads + nextval
      [{ id: 'i1', order_id: 'o1', sku: 'A' }, { id: 'i2', order_id: 'o1', sku: 'B' }],
    ]);
    const out = await builder.build('order', ['o1', 'gone']);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'order.snapshot', aggregateId: 'o1', version: '42' });
    expect(out[0].data).toEqual({ order: { orders_id: 'o1', status: 'paid' }, items: [{ id: 'i1', order_id: 'o1', sku: 'A' }, { id: 'i2', order_id: 'o1', sku: 'B' }] });
    expect(query.mock.calls[0][0]).toContain("nextval('commerce_snapshot_seq')");
  });

  it('never selects password or token_version for customers', async () => {
    const { builder, query } = makeBuilder([[{ id: 'u1', email: 'a@b.c', version: '7' }]]);
    const out = await builder.build('customer', ['u1']);
    expect(out[0]).toMatchObject({ type: 'customer.snapshot', aggregateId: 'u1', version: '7' });
    expect(query.mock.calls[0][0]).not.toMatch(/password|token_version/);
    expect(out[0].data).not.toHaveProperty('version');
  });

  it('returns nothing for no ids without querying', async () => {
    const { builder, query } = makeBuilder([]);
    expect(await builder.build('order', [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx nx test backend -- apps/backend/src/app/commerce-events/commerce-snapshot.builder.spec.ts`
Expected: FAIL with `Cannot find module './commerce-snapshot.builder'`.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/app/commerce-events/commerce-snapshot.builder.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type SnapshotType = 'order' | 'customer';
export interface Snapshot { type: 'order.snapshot' | 'customer.snapshot'; aggregateId: string; version: string; occurredAt: string; data: unknown }
type Row = Record<string, unknown>;

/** Same paid test as commerce's josh-insights paidOrderSql. */
const PAID = (o: string) => `(EXISTS (SELECT 1 FROM payment_transactions pt_ WHERE pt_.order_id = ${o}.orders_id AND pt_.status::text = 'success' AND NOT pt_.is_test)
  OR EXISTS (SELECT 1 FROM payment_transaction_orders pl_ JOIN payment_transactions pt_ ON pt_.id = pl_.transaction_id
             WHERE pl_.order_id = ${o}.orders_id AND pt_.status::text = 'success' AND NOT pt_.is_test))`;

/** Column aliases = commerce josh-order-copy.ts HEAD, so commerce's toHead() maps them unchanged. */
const ORDER_HEAD = `o.orders_id::text AS orders_id, o.order_number, o.status::text AS status, o.payment_type, ${PAID('o')} AS paid, o.fulfillment_type,
  o.user_id::text AS user_id, o.company_id::text AS company_id, o.branch_id::text AS branch_id, o.customer_code, o.checkout_batch_id::text AS checkout_batch_id,
  o.total_price, o.subtotal_ex_vat, o.vat_amount, o.delivery_fee, o.discount_amount, o.discount_inc_vat, o.product_discount_ex_vat, o.gross_ex_vat,
  o.delivery_date::text AS delivery_date, o.po_number, o.document_no, o.remark, o.create_date, o.end_date`;

const ORDER_ITEMS = `SELECT oi.id::text AS id, oi.order_id::text AS order_id, oi.product_inventory_id::text AS product_inventory_id,
    pi.product_inventory_sku AS sku, oi.product_price, oi.product_quantity, oi.status::text AS status, oi.fulfillment_type, oi.price_source,
    oi.promotion_mechanic_id::text AS promotion_mechanic_id, oi.unit_list_price_inc_vat, oi.line_revenue, oi.shipment_id::text AS shipment_id
  FROM order_items oi LEFT JOIN product_inventory pi ON pi.product_inventory_id = oi.product_inventory_id WHERE oi.order_id = ANY($1::uuid[])`;

/** Marketing-safe customer columns only — never password / token_version (spec §2.2). */
const CUSTOMER = `u.id::text AS id, u.first_name, u.last_name, u.email, u.mobile_phone, u.nickname, u.company_id::text AS company_id, u.role,
  u.account_type, u.custype, u.custcode, u.is_active, u.marketing_consent, u.pdpa_consent, u.pdpa_consent_at, u.preferred_language,
  u.created_at, u.first_app_login_at, u.last_app_login_at,
  COALESCE((SELECT array_agg(ub.branch_id::text) FROM user_branches ub WHERE ub.user_id = u.id), '{}') AS branch_ids`;

@Injectable()
export class CommerceSnapshotBuilder {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Latest state of each id, one sequence version per aggregate (taken with the read). */
  async build(type: SnapshotType, ids: string[]): Promise<Snapshot[]> {
    if (!ids.length) return [];
    const occurredAt = new Date().toISOString();
    if (type === 'customer') {
      const rows = await this.db.query<Row[]>(
        `SELECT ${CUSTOMER}, nextval('commerce_snapshot_seq')::text AS version FROM users u WHERE u.id = ANY($1::uuid[])`, [ids]);
      return rows.map(({ version, ...data }) => ({ type: 'customer.snapshot', aggregateId: data.id as string, version: version as string, occurredAt, data }));
    }
    const heads = await this.db.query<Row[]>(
      `SELECT ${ORDER_HEAD}, nextval('commerce_snapshot_seq')::text AS version FROM orders o WHERE o.orders_id = ANY($1::uuid[])`, [ids]);
    if (!heads.length) return [];
    const items = await this.db.query<Row[]>(ORDER_ITEMS, [heads.map((h) => h.orders_id)]);
    return heads.map(({ version, ...order }) => ({
      type: 'order.snapshot', aggregateId: order.orders_id as string, version: version as string, occurredAt,
      data: { order, items: items.filter((i) => i.order_id === order.orders_id) },
    }));
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx nx test backend -- apps/backend/src/app/commerce-events/commerce-snapshot.builder.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/commerce-events/commerce-snapshot.builder*.ts
git commit -m "feat(commerce-events): order/customer snapshot builder with sequence versions"
```

---

### Task 3: josh — signed client and drainer

**Files:**
- Create: `apps/backend/src/app/commerce-events/commerce-events.flag.ts`
- Create: `apps/backend/src/app/commerce-events/commerce-events.client.ts`
- Create: `apps/backend/src/app/commerce-events/commerce-outbox.drainer.ts`
- Test: `apps/backend/src/app/commerce-events/commerce-outbox.drainer.spec.ts`

**Interfaces:**
- Consumes: `CommerceSnapshotBuilder.build` (Task 2)
- Produces:

```ts
export function isJoshEventsToCommerceEnabled(): boolean;
export interface CommerceEnvelope { type: string; aggregateId: string; version: string; occurredAt: string; data: unknown }
export class CommerceEventsClient { send(envelope: CommerceEnvelope): Promise<void> }   // throws on non-2xx
export class CommerceOutboxDrainer { drain(): Promise<{ sent: number; failed: number }>; prune(): Promise<number> }
```

  Delivery id is `${type}:${aggregateId}:${version}`. It is stable per snapshot, so a retry is deduplicated by version on commerce. `erp.fallback` rows send `{ type: 'erp.fallback.received', aggregateId: row.aggregate_id, version: row.id, occurredAt: row.created_at, data: row.payload }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/app/commerce-events/commerce-outbox.drainer.spec.ts
import { CommerceOutboxDrainer } from './commerce-outbox.drainer';

type Claimed = { id: string; type: string; aggregate_id: string; payload: unknown; created_at: Date; attempts: number };

function makeDrainer(claimed: Claimed[], snapshots: unknown[] = [], sendFails = false) {
  const query = jest.fn()
    .mockResolvedValueOnce([claimed, claimed.length])   // claim UPDATE ... RETURNING
    .mockResolvedValue([[], 0]);                         // mark sent / backoff
  const builder = { build: jest.fn(async (type: string) => snapshots.filter((s: any) => s.type.startsWith(type))) };
  const client = { send: jest.fn(async () => { if (sendFails) throw new Error('commerce 503'); }) };
  const drainer = new CommerceOutboxDrainer({ query } as never, builder as never, client as never);
  return { drainer, query, builder, client };
}

describe('CommerceOutboxDrainer', () => {
  const OLD = process.env.JOSH_EVENTS_TO_COMMERCE_ENABLED;
  afterEach(() => { process.env.JOSH_EVENTS_TO_COMMERCE_ENABLED = OLD; });

  it('does nothing when the flag is not exactly "true"', async () => {
    process.env.JOSH_EVENTS_TO_COMMERCE_ENABLED = 'yes';
    const { drainer, query } = makeDrainer([]);
    expect(await drainer.drain()).toEqual({ sent: 0, failed: 0 });
    expect(query).not.toHaveBeenCalled();
  });

  it('claims with SKIP LOCKED, collapses duplicate rows of one order into one send, marks all rows sent', async () => {
    process.env.JOSH_EVENTS_TO_COMMERCE_ENABLED = 'true';
    const rows = [1, 2].map((i) => ({ id: String(i), type: 'order', aggregate_id: 'o1', payload: null, created_at: new Date(), attempts: 0 }));
    const { drainer, query, client } = makeDrainer(rows, [{ type: 'order.snapshot', aggregateId: 'o1', version: '9', occurredAt: 'x', data: {} }]);
    expect(await drainer.drain()).toEqual({ sent: 1, failed: 0 });
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1][0]).toContain('SET sent_at = now()');
    expect(query.mock.calls[1][1]).toEqual([['1', '2']]);
  });

  it('marks rows of a vanished aggregate as sent (nothing left to say)', async () => {
    process.env.JOSH_EVENTS_TO_COMMERCE_ENABLED = 'true';
    const { drainer, query, client } = makeDrainer([{ id: '5', type: 'order', aggregate_id: 'gone', payload: null, created_at: new Date(), attempts: 0 }]);
    await drainer.drain();
    expect(client.send).not.toHaveBeenCalled();
    expect(query.mock.calls[1][1]).toEqual([['5']]);
  });

  it('backs off on failure instead of dropping', async () => {
    process.env.JOSH_EVENTS_TO_COMMERCE_ENABLED = 'true';
    const { drainer, query } = makeDrainer(
      [{ id: '3', type: 'customer', aggregate_id: 'u1', payload: null, created_at: new Date(), attempts: 2 }],
      [{ type: 'customer.snapshot', aggregateId: 'u1', version: '1', occurredAt: 'x', data: {} }], true);
    expect(await drainer.drain()).toEqual({ sent: 0, failed: 1 });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('attempts = attempts + 1');
    expect(sql).toContain('claimed_until = NULL');
    expect(params).toEqual([['3'], 'commerce 503']);
  });

  it('sends customer.deleted and erp.fallback rows without a snapshot read', async () => {
    process.env.JOSH_EVENTS_TO_COMMERCE_ENABLED = 'true';
    const { drainer, client, builder } = makeDrainer([
      { id: '7', type: 'customer.deleted', aggregate_id: 'u9', payload: null, created_at: new Date('2026-10-06T00:00:00Z'), attempts: 0 },
      { id: '8', type: 'erp.fallback', aggregate_id: 'e1', payload: { path: 'products/qty', body: [] }, created_at: new Date('2026-10-06T00:00:00Z'), attempts: 0 },
    ]);
    await drainer.drain();
    expect(builder.build).not.toHaveBeenCalledWith('customer', expect.anything());
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'customer.deleted', aggregateId: 'u9', version: '7' }));
    expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'erp.fallback.received', aggregateId: 'e1', version: '8', data: { path: 'products/qty', body: [] } }));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx nx test backend -- apps/backend/src/app/commerce-events/commerce-outbox.drainer.spec.ts`
Expected: FAIL with `Cannot find module './commerce-outbox.drainer'`.

- [ ] **Step 3: Implement the flag, the client and the drainer**

```ts
// apps/backend/src/app/commerce-events/commerce-events.flag.ts
/** josh → commerce event delivery. Default OFF; only the literal 'true' turns it on. Triggers always record. */
export function isJoshEventsToCommerceEnabled(): boolean {
  return process.env.JOSH_EVENTS_TO_COMMERCE_ENABLED === 'true';
}
```

```ts
// apps/backend/src/app/commerce-events/commerce-events.client.ts
import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

export interface CommerceEnvelope { type: string; aggregateId: string; version: string; occurredAt: string; data: unknown }

/** Signed POST to commerce /internal/josh-events. HMAC-SHA256 hex of the exact body with COMMERCE_EVENTS_SECRET. */
@Injectable()
export class CommerceEventsClient {
  async send(envelope: CommerceEnvelope): Promise<void> {
    const base = process.env.COMMERCE_PLATFORM_BASE_URL?.trim().replace(/\/$/, '');
    const secret = process.env.COMMERCE_EVENTS_SECRET?.trim();
    if (!base || !secret) throw new Error('COMMERCE_PLATFORM_BASE_URL / COMMERCE_EVENTS_SECRET not set');
    const body = JSON.stringify(envelope);
    const res = await fetch(`${base}/internal/josh-events`, {
      method: 'POST', body, signal: AbortSignal.timeout(10_000),
      headers: {
        'content-type': 'application/json',
        'x-event-type': envelope.type,
        'x-delivery-id': `${envelope.type}:${envelope.aggregateId}:${envelope.version}`,
        'x-signature': createHmac('sha256', secret).update(body).digest('hex'),
      },
    });
    if (!res.ok) throw new Error(`commerce ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
```

```ts
// apps/backend/src/app/commerce-events/commerce-outbox.drainer.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CommerceEnvelope, CommerceEventsClient } from './commerce-events.client';
import { isJoshEventsToCommerceEnabled } from './commerce-events.flag';
import { CommerceSnapshotBuilder, SnapshotType } from './commerce-snapshot.builder';

const BATCH = 200;
const LEASE = '60 seconds';
const RETENTION = '7 days';
type Claimed = { id: string; type: string; aggregate_id: string; payload: unknown; created_at: Date; attempts: number };

/**
 * At-least-once delivery of commerce_outbox. Rows are leased (claimed_until), not consumed, so a crash
 * mid-send leaves them due again after LEASE. Two josh instances share the work via SKIP LOCKED.
 */
@Injectable()
export class CommerceOutboxDrainer {
  private readonly logger = new Logger(CommerceOutboxDrainer.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly snapshots: CommerceSnapshotBuilder,
    private readonly client: CommerceEventsClient,
  ) {}

  async drain(): Promise<{ sent: number; failed: number }> {
    if (!isJoshEventsToCommerceEnabled()) return { sent: 0, failed: 0 };
    const [rows] = await this.db.query<[Claimed[], number]>(`
      UPDATE commerce_outbox SET claimed_until = now() + interval '${LEASE}'
      WHERE id IN (
        SELECT id FROM commerce_outbox
        WHERE sent_at IS NULL AND next_attempt_at <= now() AND (claimed_until IS NULL OR claimed_until < now())
        ORDER BY id LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, type, aggregate_id, payload, created_at, attempts`);
    let sent = 0;
    let failed = 0;
    for (const [key, group] of this.groups(rows)) {
      const ids = group.map((r) => r.id);
      try {
        const envelope = await this.envelope(key, group);
        if (envelope) { await this.client.send(envelope); sent++; }
        await this.db.query(`UPDATE commerce_outbox SET sent_at = now(), claimed_until = NULL, last_error = NULL WHERE id = ANY($1::bigint[])`, [ids]);
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        await this.db.query(`UPDATE commerce_outbox SET claimed_until = NULL, attempts = attempts + 1, last_error = $2,
            next_attempt_at = now() + least(interval '60 seconds', interval '1 second' * power(2, attempts))
          WHERE id = ANY($1::bigint[])`, [ids, message.slice(0, 500)]);
        this.logger.warn(`commerce event ${key} not delivered: ${message}`);
      }
    }
    return { sent, failed };
  }

  /** Sent rows after RETENTION; unsent rows too (flag was off that long — backfill repairs). */
  async prune(): Promise<number> {
    const [, deleted] = await this.db.query<[unknown[], number]>(
      `DELETE FROM commerce_outbox WHERE created_at < now() - interval '${RETENTION}'`);
    return deleted ?? 0;
  }

  /** order/customer rows of one aggregate collapse into one snapshot; other rows go one by one. */
  private groups(rows: Claimed[]): Map<string, Claimed[]> {
    const out = new Map<string, Claimed[]>();
    for (const r of rows) {
      const key = r.type === 'order' || r.type === 'customer' ? `${r.type}:${r.aggregate_id}` : `${r.type}:${r.id}`;
      out.set(key, [...(out.get(key) ?? []), r]);
    }
    return out;
  }

  private async envelope(key: string, group: Claimed[]): Promise<CommerceEnvelope | null> {
    const row = group[group.length - 1];
    if (row.type === 'order' || row.type === 'customer') {
      const [snap] = await this.snapshots.build(row.type as SnapshotType, [row.aggregate_id]);
      return snap ?? null; // vanished: nothing to send
    }
    const occurredAt = new Date(row.created_at).toISOString();
    if (row.type === 'customer.deleted') return { type: 'customer.deleted', aggregateId: row.aggregate_id, version: row.id, occurredAt, data: { id: row.aggregate_id } };
    if (row.type === 'erp.fallback') return { type: 'erp.fallback.received', aggregateId: row.aggregate_id, version: row.id, occurredAt, data: row.payload };
    this.logger.warn(`unknown commerce_outbox type ${row.type} (${key}) — dropped`);
    return null;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx nx test backend -- apps/backend/src/app/commerce-events/commerce-outbox.drainer.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/commerce-events/commerce-events.flag.ts apps/backend/src/app/commerce-events/commerce-events.client.ts apps/backend/src/app/commerce-events/commerce-outbox.drainer*.ts
git commit -m "feat(commerce-events): leased at-least-once drainer + signed client, default off"
```

---

### Task 4: josh — scheduler, ERP fallback recording, backfill endpoint, module wiring

**Files:**
- Create: `apps/backend/src/app/commerce-events/commerce-outbox.scheduler.ts`
- Create: `apps/backend/src/app/commerce-events/erp-fallback.interceptor.ts`
- Create: `apps/backend/src/app/commerce-events/commerce-backfill.controller.ts`
- Create: `apps/backend/src/app/commerce-events/commerce-events.module.ts`
- Modify: `apps/backend/src/app/erp/erp-webhook.controller.ts` (class decorators)
- Modify: `apps/backend/src/app/app.module.ts` (imports)
- Test: `apps/backend/src/app/commerce-events/erp-fallback.interceptor.spec.ts`, `apps/backend/src/app/commerce-events/commerce-backfill.controller.spec.ts`

**Interfaces:**
- Consumes: `CommerceOutboxDrainer` (Task 3); `verifyCommerceSignature(body, signature)` from `app/erp/commerce-signature.ts`
- Produces:
  - `POST /api/internal/commerce/backfill` with body `{ group: 'order' | 'customer' }` and header `x-signature`. Returns `{ enqueued: number }`.
  - `erp.fallback` outbox rows with payload `{ method, path, body, receivedAt }`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/backend/src/app/commerce-events/erp-fallback.interceptor.spec.ts
import { lastValueFrom, of, throwError } from 'rxjs';
import { ErpFallbackInterceptor } from './erp-fallback.interceptor';

const ctx = (req: object) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as never;

describe('ErpFallbackInterceptor', () => {
  it('records a successful direct ERP write as an erp.fallback row', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const i = new ErpFallbackInterceptor({ query } as never);
    await lastValueFrom(i.intercept(ctx({ method: 'PUT', path: '/api/erp/products/qty', body: [{ PRODUCT_CODE: 'A', QUANTITY: 3 }] }), { handle: () => of({ received: true }) }));
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`INSERT INTO commerce_outbox (type, aggregate_id, payload) VALUES ('erp.fallback', gen_random_uuid(), $1)`);
    expect(JSON.parse(params[0])).toMatchObject({ method: 'PUT', path: '/api/erp/products/qty', body: [{ PRODUCT_CODE: 'A', QUANTITY: 3 }] });
  });

  it('does not record GET probes or failed calls, and never fails the ERP call itself', async () => {
    const query = jest.fn().mockRejectedValue(new Error('db down'));
    const i = new ErpFallbackInterceptor({ query } as never);
    await lastValueFrom(i.intercept(ctx({ method: 'GET', path: '/api/erp/products', body: {} }), { handle: () => of([]) }));
    await expect(lastValueFrom(i.intercept(ctx({ method: 'POST', path: '/api/erp/products', body: {} }), { handle: () => throwError(() => new Error('bad')) }))).rejects.toThrow('bad');
    expect(query).not.toHaveBeenCalled();
    await expect(lastValueFrom(i.intercept(ctx({ method: 'POST', path: '/api/erp/customers', body: {} }), { handle: () => of({ ok: 1 }) }))).resolves.toEqual({ ok: 1 });
  });
});
```

```ts
// apps/backend/src/app/commerce-events/commerce-backfill.controller.spec.ts
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { CommerceBackfillController } from './commerce-backfill.controller';

describe('CommerceBackfillController', () => {
  const OLD = { ...process.env };
  beforeEach(() => { process.env.COMMERCE_EVENTS_SECRET = 's3cret'; });
  afterEach(() => { process.env = { ...OLD }; });
  const sign = (b: object) => createHmac('sha256', 's3cret').update(JSON.stringify(b)).digest('hex');

  it('enqueues every order with one INSERT ... SELECT', async () => {
    const query = jest.fn().mockResolvedValue([[], 1234]);
    const c = new CommerceBackfillController({ query } as never);
    expect(await c.backfill({ group: 'order' }, sign({ group: 'order' }))).toEqual({ enqueued: 1234 });
    expect(query.mock.calls[0][0]).toContain(`INSERT INTO commerce_outbox (type, aggregate_id) SELECT 'order', o.orders_id FROM orders o`);
  });

  it('enqueues customers only', async () => {
    const query = jest.fn().mockResolvedValue([[], 5]);
    const c = new CommerceBackfillController({ query } as never);
    await c.backfill({ group: 'customer' }, sign({ group: 'customer' }));
    expect(query.mock.calls[0][0]).toContain(`r.user_type = 'customer'`);
  });

  it('rejects bad signatures and unknown groups', async () => {
    const c = new CommerceBackfillController({ query: jest.fn() } as never);
    await expect(c.backfill({ group: 'order' }, 'nope')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(c.backfill({ group: 'stock' as never }, sign({ group: 'stock' }))).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx nx test backend -- apps/backend/src/app/commerce-events/erp-fallback.interceptor.spec.ts apps/backend/src/app/commerce-events/commerce-backfill.controller.spec.ts`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the interceptor, the backfill controller, the scheduler and the module**

```ts
// apps/backend/src/app/commerce-events/erp-fallback.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Observable, tap } from 'rxjs';
import { DataSource } from 'typeorm';

/**
 * Spec §3.3: every ERP write that reached josh directly (nginx fallback while commerce was down) is
 * forwarded to commerce later as erp.fallback.received. Recording never affects the ERP call: it runs
 * after success and its errors are only logged. GET probes are not recorded.
 */
@Injectable()
export class ErpFallbackInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErpFallbackInterceptor.name);
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method: string; path: string; body: unknown }>();
    if (req.method === 'GET') return next.handle();
    return next.handle().pipe(tap(() => {
      const payload = JSON.stringify({ method: req.method, path: req.path, body: req.body, receivedAt: new Date().toISOString() });
      void this.db.query(`INSERT INTO commerce_outbox (type, aggregate_id, payload) VALUES ('erp.fallback', gen_random_uuid(), $1)`, [payload])
        .catch((e: unknown) => this.logger.warn(`erp.fallback not recorded: ${e instanceof Error ? e.message : e}`));
    }));
  }
}
```

```ts
// apps/backend/src/app/commerce-events/commerce-backfill.controller.ts
import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { SkipThrottle } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { Public } from '../../shared/common/decorators/public.decorator';
import { verifyCommerceSignature } from '../erp/commerce-signature';

const GROUPS = {
  order: `INSERT INTO commerce_outbox (type, aggregate_id) SELECT 'order', o.orders_id FROM orders o`,
  customer: `INSERT INTO commerce_outbox (type, aggregate_id) SELECT 'customer', u.id FROM users u JOIN app_roles r ON r.code = u.role WHERE r.user_type = 'customer'`,
} as const;

/** Spec §2.5: commerce asks josh to (re)send every aggregate of a group through the normal outbox. */
@SkipThrottle()
@Public()
@Controller('internal/commerce/backfill')
export class CommerceBackfillController {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async backfill(@Body() body: { group: keyof typeof GROUPS }, @Headers('x-signature') signature: string | undefined) {
    verifyCommerceSignature(body, signature);
    const sql = GROUPS[body?.group];
    if (!sql) throw new BadRequestException(`unknown group ${body?.group} (order | customer)`);
    const [, enqueued] = await this.db.query<[unknown[], number]>(sql);
    return { enqueued };
  }
}
```

Before you write the import: confirm the `Public` decorator path with `git grep -n "export const Public" apps/backend/src`, and use the path `commerce-erp-events.controller.ts` imports it from.

```ts
// apps/backend/src/app/commerce-events/commerce-outbox.scheduler.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { CommerceOutboxDrainer } from './commerce-outbox.drainer';

/**
 * Timer, not after-commit: an after-commit hook runs on every commit in the app (see
 * OrderSettledSubscriber) — josh must not get slower. 3 s polling hits the partial index
 * idx_commerce_outbox_due only; the drainer returns at once while the flag is off.
 */
@Injectable()
export class CommerceOutboxScheduler {
  private readonly logger = new Logger(CommerceOutboxScheduler.name);
  private running = false;
  constructor(private readonly drainer: CommerceOutboxDrainer) {}

  @Interval(3000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // drain until a batch comes back short, so a backlog clears without waiting 3 s per batch
      for (let i = 0; i < 50; i++) {
        const { sent, failed } = await this.drainer.drain();
        if (sent + failed < 200) break;
      }
    } catch (e) {
      this.logger.error(`commerce outbox drain failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  @Cron('17 * * * *')
  async prune(): Promise<void> {
    const n = await this.drainer.prune().catch(() => 0);
    if (n) this.logger.log(`commerce outbox pruned ${n} row(s)`);
  }
}
```

```ts
// apps/backend/src/app/commerce-events/commerce-events.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommerceOutbox } from '../../entities/commerce-outbox.entity';
import { CommerceBackfillController } from './commerce-backfill.controller';
import { CommerceEventsClient } from './commerce-events.client';
import { CommerceOutboxDrainer } from './commerce-outbox.drainer';
import { CommerceOutboxScheduler } from './commerce-outbox.scheduler';
import { CommerceSnapshotBuilder } from './commerce-snapshot.builder';
import { ErpFallbackInterceptor } from './erp-fallback.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([CommerceOutbox])],
  controllers: [CommerceBackfillController],
  providers: [CommerceSnapshotBuilder, CommerceEventsClient, CommerceOutboxDrainer, CommerceOutboxScheduler, ErpFallbackInterceptor],
  exports: [ErpFallbackInterceptor],
})
export class CommerceEventsModule {}
```

Wire it in:
- `app.module.ts`: add `CommerceEventsModule` to `imports`.
- `erp.module.ts`: import `CommerceEventsModule` so the interceptor resolves in that module.
- `erp-webhook.controller.ts`: add `@UseInterceptors(ErpFallbackInterceptor)` under `@UseGuards(ErpKeyGuard)` on the class.

```ts
// erp-webhook.controller.ts — class decorators become:
@SkipThrottle()
@Public()
@UseGuards(ErpKeyGuard)
@UseInterceptors(ErpFallbackInterceptor)
@Controller('erp')
export class ErpWebhookController {
```

Check that `ScheduleModule.forRoot()` is already registered: `git grep -n "ScheduleModule.forRoot" apps/backend/src`. It should be, because the existing crons use `@Cron`.

- [ ] **Step 4: Run the tests, the typecheck and lint**

```bash
npx nx test backend -- apps/backend/src/app/commerce-events
npx tsc --noEmit -p apps/backend/tsconfig.app.json
npx nx lint backend
```

Expected: all commerce-events specs PASS; tsc and lint clean.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/app/commerce-events apps/backend/src/app/erp/erp-webhook.controller.ts apps/backend/src/app/erp/erp.module.ts apps/backend/src/app/app.module.ts
git commit -m "feat(commerce-events): 3s drain scheduler, erp.fallback recording on /api/erp, signed backfill endpoint"
```

---

### Task 5: josh — version guard on stock writes

**Files:**
- Create: `apps/backend/src/app/erp/applied-version.ts`
- Modify: `apps/backend/src/app/erp/erp-webhook.service.ts` (`handleQtyChange`, ~:1566-1600)
- Test: `apps/backend/src/app/erp/applied-version.spec.ts`

**Interfaces:**
- Consumes: `commerce_applied_versions` (Task 1)
- Produces: `applyIfNewer(runner: { query: DataSource['query'] }, type: string, id: string, version: Date): Promise<boolean>`. It returns true when the version was recorded, which means "go ahead and write". It returns false when the stored version is newer or equal. It must run in the same transaction as the write.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/src/app/erp/applied-version.spec.ts
import { applyIfNewer } from './applied-version';

describe('applyIfNewer', () => {
  it('upserts only when the incoming version is newer, in one statement', async () => {
    const query = jest.fn().mockResolvedValue([{ applied: true }]);
    expect(await applyIfNewer({ query } as never, 'stock', 'SKU-1', new Date('2026-10-06T10:00:00Z'))).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (aggregate_type, aggregate_id) DO UPDATE SET version = EXCLUDED.version');
    expect(sql).toContain('WHERE commerce_applied_versions.version < EXCLUDED.version');
    expect(params).toEqual(['stock', 'SKU-1', new Date('2026-10-06T10:00:00Z')]);
  });

  it('returns false when nothing was written (stored version is newer or equal)', async () => {
    const query = jest.fn().mockResolvedValue([]);
    expect(await applyIfNewer({ query } as never, 'stock', 'SKU-1', new Date())).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx nx test backend -- apps/backend/src/app/erp/applied-version.spec.ts`
Expected: FAIL with `Cannot find module './applied-version'`.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/app/erp/applied-version.ts
type Runner = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Spec §2.3: records `version` for (type, id) only if it is newer than what is stored. Call inside the
 * transaction that writes the data; false = an equal-or-newer change already landed, skip the write.
 * Shared by the direct ERP route and commerce events, so both sides compare on the source time.
 */
export async function applyIfNewer(runner: Runner, type: string, id: string, version: Date): Promise<boolean> {
  const rows = (await runner.query(
    `INSERT INTO commerce_applied_versions (aggregate_type, aggregate_id, version) VALUES ($1, $2, $3)
     ON CONFLICT (aggregate_type, aggregate_id) DO UPDATE SET version = EXCLUDED.version
     WHERE commerce_applied_versions.version < EXCLUDED.version
     RETURNING true AS applied`, [type, id, version])) as unknown[];
  return rows.length > 0;
}
```

- [ ] **Step 4: Use it in `handleQtyChange`.** Read the method first:

```bash
sed -n 1560,1610p apps/backend/src/app/erp/erp-webhook.service.ts
```

Wrap the per-item write in a transaction. When `CHANGED_AT` parses to a valid date and `applyIfNewer` returns false, count the item as `stale` and skip the save, `setErpQty` and the restock notify. Items without `CHANGED_AT` keep today's behaviour, so ERP payloads without it don't break.

```ts
// inside the per-item loop of handleQtyChange, replacing the findOne → save block:
const changedAt = item.CHANGED_AT ? new Date(item.CHANGED_AT) : null;
const applied = await this.inventoryRepo.manager.transaction(async (m) => {
  const inventory = await m.findOne(ProductInventory, { where: { product_inventory_sku: item.PRODUCT_CODE }, lock: { mode: 'pessimistic_write' } });
  if (!inventory) return null;
  if (changedAt && !Number.isNaN(changedAt.getTime()) && !(await applyIfNewer(m, 'stock', item.PRODUCT_CODE, changedAt))) return 'stale' as const;
  const previousQty = inventory.product_inventory_quantity ?? 0;
  inventory.product_inventory_quantity = Math.max(0, Math.floor(item.QUANTITY));
  await m.save(inventory);
  return { previousQty, inventory };
});
if (applied === null) { failed.push(item.PRODUCT_CODE); continue; }
if (applied === 'stale') { stale++; continue; }
await this.sellableStock.setErpQty(item.PRODUCT_CODE, applied.inventory.product_inventory_quantity);
await this.notifyRestockIfBackInStock(applied.previousQty, applied.inventory.product_inventory_quantity, applied.inventory.product_inventory_id, item.PRODUCT_CODE);
updated++;
```

Make these changes as well:
- Declare `let stale = 0;` next to `updated`.
- Return `{ updated, stale, failed }`. Callers spread the result into the response, and `failed` keeps its meaning.
- Remove the "no event-ordering guard yet" NOTE comment.
- Use whatever name the entity class is imported under in that file (`ProductInventory` or similar). Check the existing `inventoryRepo` type.

- [ ] **Step 5: Extend the existing `handleQtyChange` spec** (find it with `git grep -ln "handleQtyChange" apps/backend/src -- '*.spec.ts'`). Add one test that sends two items for one SKU with CHANGED_AT `10:05` then `10:00`, mocks `applyIfNewer`'s query to return a row the first time and `[]` the second, and expects `{ updated: 1, stale: 1 }`, with `setErpQty` called once.

- [ ] **Step 6: Run the ERP specs, the typecheck and lint**

```bash
npx nx test backend -- apps/backend/src/app/erp
npx tsc --noEmit -p apps/backend/tsconfig.app.json && npx nx lint backend
```

Expected: PASS; clean.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/app/erp/applied-version*.ts apps/backend/src/app/erp/erp-webhook.service.ts apps/backend/src/app/erp/*.spec.ts
git commit -m "fix(erp): stale qty guard on CHANGED_AT for both direct ERP and commerce events"
```

---

### Task 6: commerce — inbound schema and signature check

**Files:**
- Create: `apps/commerce-platform/src/migrations/<ts>-JoshEventsInbound.ts`
- Create: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-customer-copy.entity.ts`
- Create: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-erp-fallback-call.entity.ts`
- Create: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.signature.ts`
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/orders/josh-order-copy.entity.ts` (add `sourceVersion`)
- Test: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.signature.spec.ts`

**Interfaces:**
- Produces:
  - `josh_orders.source_version bigint NOT NULL DEFAULT 0`. Rows written by the old replica copy stay at 0, so the first event always wins.
  - Table `josh_customers(id uuid PK, data jsonb, source_version bigint, deleted_at timestamptz null, updated_at)`
  - Table `josh_erp_fallback_calls(josh_outbox_id bigint PK, method, path, body jsonb, received_at timestamptz, created_at)`
  - `verifyJoshSignature(rawBody: string, signature: string | undefined): void`. It throws `UnauthorizedException`.

- [ ] **Step 1: Create the commerce branch**

```bash
cd /Users/pongpanot_s/Documents/dev/commerce-platform/.claude/worktrees/ec2-pricing-calculation-1bcded
git fetch -q origin && git checkout -b feat/josh-events-inbound origin/master
ls apps/commerce-platform/src/migrations | sort | tail -1 && date +%s%3N
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.signature.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { verifyJoshSignature } from './josh-events.signature';

describe('verifyJoshSignature', () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });
  const body = '{"type":"order.snapshot","aggregateId":"o1"}';

  it('accepts the HMAC of the exact raw body', () => {
    process.env.JOSH_EVENTS_SECRET = 'k';
    expect(() => verifyJoshSignature(body, createHmac('sha256', 'k').update(body).digest('hex'))).not.toThrow();
  });

  it('rejects a wrong or missing signature', () => {
    process.env.JOSH_EVENTS_SECRET = 'k';
    expect(() => verifyJoshSignature(body, 'ab')).toThrow(UnauthorizedException);
    expect(() => verifyJoshSignature(body, undefined)).toThrow(UnauthorizedException);
  });

  it('fails closed in production without a secret', () => {
    delete process.env.JOSH_EVENTS_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => verifyJoshSignature(body, 'x')).toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx jest -c apps/commerce-platform/jest.config.cts josh-events.signature`
Expected: FAIL with `Cannot find module './josh-events.signature'`.

- [ ] **Step 4: Implement the signature check, the entities and the migration**

```ts
// apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.signature.ts
import { Logger, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

const logger = new Logger('JoshEventsSignature');

/** josh signs the exact body text (HMAC-SHA256 hex, JOSH_EVENTS_SECRET = josh's COMMERCE_EVENTS_SECRET). */
export function verifyJoshSignature(rawBody: string, signature: string | undefined): void {
  const secret = process.env.JOSH_EVENTS_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new UnauthorizedException('josh events not configured');
    logger.warn('JOSH_EVENTS_SECRET not set — accepting unsigned josh events (non-production only)');
    return;
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const presented = Buffer.from(signature ?? '', 'hex');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) throw new UnauthorizedException('invalid x-signature');
}
```

```ts
// apps/commerce-platform/src/modules/integration/connector/josh/events/josh-customer-copy.entity.ts
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Commerce's copy of josh customers (spec 2026-10-06 §2.2): marketing-safe columns only, fed by
 * customer.snapshot. deleted_at = PDPA delete: data wiped, row kept so an older snapshot can't revive it.
 */
@Entity('josh_customers')
export class JoshCustomerCopy {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ type: 'jsonb', default: {} }) data: Record<string, unknown>;
  @Column({ name: 'source_version', type: 'bigint', default: 0 }) sourceVersion: string;
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt: Date | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
```

```ts
// apps/commerce-platform/src/modules/integration/connector/josh/events/josh-erp-fallback-call.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** ERP calls that hit josh directly while commerce was down (erp.fallback.received). Turned into ledger moves in stage 3. */
@Entity('josh_erp_fallback_calls')
export class JoshErpFallbackCall {
  @PrimaryColumn({ name: 'josh_outbox_id', type: 'bigint' }) joshOutboxId: string;
  @Column({ type: 'varchar', length: 10 }) method: string;
  @Column({ type: 'varchar', length: 200 }) path: string;
  @Column({ type: 'jsonb', nullable: true }) body: unknown;
  @Column({ name: 'received_at', type: 'timestamptz' }) receivedAt: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
```

Add this to `JoshOrderCopy` in `josh-order-copy.entity.ts`, next to the other columns:

```ts
  /** josh commerce_snapshot_seq of the snapshot this row came from; 0 = old replica copy. */
  @Column({ name: 'source_version', type: 'bigint', default: 0 }) sourceVersion: string;
```

```ts
// apps/commerce-platform/src/migrations/<TS>-JoshEventsInbound.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class JoshEventsInbound<TS> implements MigrationInterface {
  name = 'JoshEventsInbound<TS>';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "josh_orders" ADD COLUMN IF NOT EXISTS "source_version" bigint NOT NULL DEFAULT 0`);
    await queryRunner.query(`CREATE TABLE "josh_customers" ("id" uuid NOT NULL, "data" jsonb NOT NULL DEFAULT '{}', "source_version" bigint NOT NULL DEFAULT 0,
      "deleted_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_josh_customers" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "josh_erp_fallback_calls" ("josh_outbox_id" bigint NOT NULL, "method" character varying(10) NOT NULL,
      "path" character varying(200) NOT NULL, "body" jsonb, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_josh_erp_fallback_calls" PRIMARY KEY ("josh_outbox_id"))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "josh_erp_fallback_calls"`);
    await queryRunner.query(`DROP TABLE "josh_customers"`);
    await queryRunner.query(`ALTER TABLE "josh_orders" DROP COLUMN "source_version"`);
  }
}
```

- [ ] **Step 5: Run the test, apply the migration locally, typecheck**

```bash
npx jest -c apps/commerce-platform/jest.config.cts josh-events.signature
npm run migration:run && npm run migration:revert && npm run migration:run
npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json
```

Expected: PASS; the migration goes up, down and up cleanly; tsc is clean.

- [ ] **Step 6: Commit**

```bash
git add apps/commerce-platform/src/migrations/*-JoshEventsInbound.ts apps/commerce-platform/src/modules/integration/connector/josh/events apps/commerce-platform/src/modules/integration/connector/josh/orders/josh-order-copy.entity.ts
git commit -m "feat(josh-events): inbound tables (source_version, josh_customers, erp fallback calls) + HMAC check"
```

---

### Task 7: commerce — apply service (version-guarded)

**Files:**
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/orders/josh-order-copy.ts` (export `toHead`, `toLine`, `Row`)
- Create: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service.ts`
- Test: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service.spec.ts`

**Interfaces:**
- Consumes: `toHead(r: Row): Partial<JoshOrderCopy>`, `toLine(r: Row): Partial<JoshOrderLineCopy>`, `JoshCustomerCopy`, `JoshErpFallbackCall`
- Produces:

```ts
export interface JoshEnvelope { type: string; aggregateId: string; version: string; occurredAt: string; data: any }
export type ApplyResult = 'applied' | 'stale';
export class JoshEventsService { apply(e: JoshEnvelope): Promise<ApplyResult> }   // throws BadRequestException on unknown type / bad payload
```

- [ ] **Step 1: Export the mappers.** In `josh-order-copy.ts`, change `type Row`, `const toHead` and `const toLine` to `export type Row`, `export const toHead` and `export const toLine`. Nothing else changes.

- [ ] **Step 2: Write the failing test**

```ts
// apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { JoshEventsService } from './josh-events.service';

function makeService(storedVersion: string | null) {
  const calls: Array<[string, unknown[]?]> = [];
  const repo = { upsert: jest.fn(), delete: jest.fn(), insert: jest.fn(), save: jest.fn(), findOne: jest.fn() };
  const manager = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push([sql, params]);
      if (sql.includes('SELECT source_version')) return storedVersion === null ? [] : [{ source_version: storedVersion }];
      return [];
    }),
    getRepository: jest.fn(() => repo),
  };
  const dataSource = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)) };
  return { svc: new JoshEventsService(dataSource as never), manager, repo, calls };
}

const order = (version: string) => ({
  type: 'order.snapshot', aggregateId: '11111111-1111-1111-1111-111111111111', version, occurredAt: '2026-10-06T00:00:00Z',
  data: { order: { orders_id: '11111111-1111-1111-1111-111111111111', status: 'paid', total_price: '10.00' }, items: [{ id: 'i1', order_id: '11111111-1111-1111-1111-111111111111', product_quantity: 2 }] },
});

describe('JoshEventsService', () => {
  it('applies a newer order snapshot: locks the aggregate, upserts head with source_version, replaces lines', async () => {
    const { svc, calls, repo } = makeService('5');
    expect(await svc.apply(order('6'))).toBe('applied');
    expect(calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(repo.upsert).toHaveBeenCalledWith([expect.objectContaining({ ordersId: '11111111-1111-1111-1111-111111111111', status: 'paid', sourceVersion: '6' })], ['ordersId']);
    expect(repo.delete).toHaveBeenCalled();
    expect(repo.insert).toHaveBeenCalledWith([expect.objectContaining({ id: 'i1', productQuantity: 2 })]);
  });

  it('drops an equal or older order snapshot', async () => {
    const { svc, repo } = makeService('6');
    expect(await svc.apply(order('6'))).toBe('stale');
    expect(await svc.apply(order('3'))).toBe('stale');
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('customer.deleted wipes data and keeps a tombstone that blocks older snapshots', async () => {
    const { svc, repo } = makeService(null);
    expect(await svc.apply({ type: 'customer.deleted', aggregateId: 'u1', version: '9', occurredAt: 'x', data: { id: 'u1' } })).toBe('applied');
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', data: {}, sourceVersion: '9', deletedAt: expect.any(Date) }));
  });

  it('stores erp.fallback.received once per josh outbox id', async () => {
    const { svc, calls } = makeService(null);
    await svc.apply({ type: 'erp.fallback.received', aggregateId: 'e1', version: '77', occurredAt: '2026-10-06T01:00:00Z',
      data: { method: 'PUT', path: '/api/erp/products/qty', body: [{ PRODUCT_CODE: 'A' }], receivedAt: '2026-10-06T01:00:00Z' } });
    const insert = calls.find(([s]) => s.includes('josh_erp_fallback_calls'));
    expect(insert?.[0]).toContain('ON CONFLICT (josh_outbox_id) DO NOTHING');
  });

  it('rejects unknown types', async () => {
    const { svc } = makeService(null);
    await expect(svc.apply({ type: 'nope', aggregateId: 'x', version: '1', occurredAt: 'x', data: {} })).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx jest -c apps/commerce-platform/jest.config.cts josh-events.service`
Expected: FAIL with `Cannot find module './josh-events.service'`.

- [ ] **Step 4: Implement**

```ts
// apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JoshOrderCopy, JoshOrderLineCopy } from '../orders/josh-order-copy.entity';
import { Row, toHead, toLine } from '../orders/josh-order-copy';
import { JoshCustomerCopy } from './josh-customer-copy.entity';

export interface JoshEnvelope { type: string; aggregateId: string; version: string; occurredAt: string; data: any }
export type ApplyResult = 'applied' | 'stale';

/**
 * Applies josh → commerce events (spec 2026-10-06 §2.2–2.3). Snapshots win only when their version
 * (josh commerce_snapshot_seq) is newer than the stored one; an advisory lock per aggregate makes the
 * check-then-write safe for two concurrent deliveries of a brand-new aggregate.
 */
@Injectable()
export class JoshEventsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async apply(e: JoshEnvelope): Promise<ApplyResult> {
    if (!e?.aggregateId || !/^\d+$/.test(String(e.version ?? ''))) throw new BadRequestException('aggregateId and numeric version required');
    switch (e.type) {
      case 'order.snapshot': return this.guarded('josh_orders', 'orders_id', e, (m) => this.saveOrder(m, e));
      case 'customer.snapshot': return this.guarded('josh_customers', 'id', e, (m) =>
        m.getRepository(JoshCustomerCopy).save({ id: e.aggregateId, data: e.data ?? {}, sourceVersion: e.version, deletedAt: null }));
      case 'customer.deleted': return this.guarded('josh_customers', 'id', e, (m) =>
        m.getRepository(JoshCustomerCopy).save({ id: e.aggregateId, data: {}, sourceVersion: e.version, deletedAt: new Date() }));
      case 'erp.fallback.received': return this.saveFallback(e);
      default: throw new BadRequestException(`unsupported josh event ${e.type}`);
    }
  }

  private guarded(table: 'josh_orders' | 'josh_customers', pk: string, e: JoshEnvelope, write: (m: EntityManager) => Promise<unknown>): Promise<ApplyResult> {
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${table}:${e.aggregateId}`]);
      const [row] = await m.query(`SELECT source_version FROM ${table} WHERE ${pk} = $1`, [e.aggregateId]);
      if (row && BigInt(row.source_version) >= BigInt(e.version)) return 'stale';
      await write(m);
      return 'applied';
    });
  }

  private async saveOrder(m: EntityManager, e: JoshEnvelope) {
    const head = e.data?.order as Row | undefined;
    const items = (e.data?.items ?? []) as Row[];
    if (!head || head.orders_id !== e.aggregateId) throw new BadRequestException('order.snapshot needs data.order with the aggregate id');
    await m.getRepository(JoshOrderCopy).upsert([{ ...toHead(head), sourceVersion: e.version }], ['ordersId']);
    // Lines are replaced per order: josh can remove or split lines after checkout (claims, shipments).
    await m.getRepository(JoshOrderLineCopy).delete({ ordersId: e.aggregateId });
    if (items.length) await m.getRepository(JoshOrderLineCopy).insert(items.map(toLine));
  }

  private async saveFallback(e: JoshEnvelope): Promise<ApplyResult> {
    const d = e.data ?? {};
    await this.db.transaction((m) => m.query(`INSERT INTO josh_erp_fallback_calls (josh_outbox_id, method, path, body, received_at) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (josh_outbox_id) DO NOTHING`, [e.version, String(d.method ?? ''), String(d.path ?? ''), JSON.stringify(d.body ?? null), d.receivedAt ?? e.occurredAt]));
    return 'applied';
  }
}
```

- [ ] **Step 5: Run the tests and the typecheck**

```bash
npx jest -c apps/commerce-platform/jest.config.cts josh-events.service josh-order-copy
npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json
```

Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service*.ts apps/commerce-platform/src/modules/integration/connector/josh/orders/josh-order-copy.ts
git commit -m "feat(josh-events): version-guarded apply for order/customer snapshots, PDPA tombstone, erp fallback store"
```

---

### Task 8: commerce — receiver, backfill trigger, wiring, contract doc

**Files:**
- Create: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.controller.ts`
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/josh.module.ts`
- Modify: `docs/event-contract.md`
- Test: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.controller.spec.ts`

**Interfaces:**
- Consumes: `verifyJoshSignature` (Task 6), `JoshEventsService.apply` (Task 7), `postToJosh` (`connector/josh/josh-api.ts`)
- Produces:
  - `POST /api/internal/josh-events`. It returns 200 `{ received: true, result }`, 401 on a bad signature, and 400 on a bad payload. 4xx is not retried by josh; it backs off and keeps the row, so the row is visible in `last_error`.
  - `POST /api/reports/order-copy/backfill` (staff, guard default) with body `{ group: 'order' | 'customer' }`. It calls josh `/internal/commerce/backfill`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.controller.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { JoshEventsController } from './josh-events.controller';

describe('JoshEventsController', () => {
  const OLD = { ...process.env };
  beforeEach(() => { process.env.JOSH_EVENTS_SECRET = 'k'; });
  afterEach(() => { process.env = { ...OLD }; });
  const env = { type: 'order.snapshot', aggregateId: 'o1', version: '2', occurredAt: 'x', data: {} };
  const raw = JSON.stringify(env);
  const sig = createHmac('sha256', 'k').update(raw).digest('hex');

  it('verifies the raw body, then applies', async () => {
    const service = { apply: jest.fn().mockResolvedValue('applied') };
    const c = new JoshEventsController(service as never);
    expect(await c.receive({ rawBody: Buffer.from(raw), body: env } as never, sig)).toEqual({ received: true, result: 'applied' });
    expect(service.apply).toHaveBeenCalledWith(env);
  });

  it('rejects a body that does not match its signature', async () => {
    const service = { apply: jest.fn() };
    const c = new JoshEventsController(service as never);
    await expect(c.receive({ rawBody: Buffer.from(raw + ' '), body: env } as never, sig)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(service.apply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest -c apps/commerce-platform/jest.config.cts josh-events.controller`
Expected: FAIL with `Cannot find module './josh-events.controller'`.

- [ ] **Step 3: Implement the controllers**

```ts
// apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.controller.ts
import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post, Req, ServiceUnavailableException } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../../../../shared-kernel/presentation/auth.decorators';
import { joshApiConfigured, postToJosh } from '../josh-api';
import { JoshEnvelope, JoshEventsService } from './josh-events.service';
import { verifyJoshSignature } from './josh-events.signature';

/** josh → commerce events (spec 2026-10-06 §2.2). HMAC over the raw body; replays are harmless (version guard). */
@Public()
@Controller('internal/josh-events')
export class JoshEventsController {
  constructor(private readonly service: JoshEventsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-signature') signature: string | undefined) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    verifyJoshSignature(raw, signature);
    return { received: true, result: await this.service.apply(req.body as JoshEnvelope) };
  }
}

/** Staff (guard default): ask josh to resend every order or customer through its outbox (spec §2.5). */
@Controller('reports/order-copy')
export class JoshBackfillController {
  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  backfill(@Body() body: { group?: string }) {
    if (body?.group !== 'order' && body?.group !== 'customer') throw new BadRequestException('group: order | customer');
    if (!joshApiConfigured()) throw new ServiceUnavailableException('JOSH_API_URL / JOSH_EVENTS_SECRET not set');
    return postToJosh<{ enqueued: number }>('/internal/commerce/backfill', { group: body.group });
  }
}
```

Note: the global `ValidationPipe({ whitelist: true })` only strips properties when a DTO class is declared. The receiver reads `req.body` directly, so the envelope arrives intact. The backfill body is a plain type, not a class, so it is not stripped either.

- [ ] **Step 4: Wire them into `josh.module.ts`**
- Add `JoshCustomerCopy` and `JoshErpFallbackCall` to `TypeOrmModule.forFeature([...])`.
- Add `JoshEventsService` to `providers`.
- Add `JoshEventsController` and `JoshBackfillController` to `controllers`.

Check that `JoshOrderCopyReportController` has no conflicting `POST backfill` route on `reports/order-copy`. It has only `summary` and `run`, so there's no conflict.

- [ ] **Step 5: Update `docs/event-contract.md`**
- In §2, replace the line that says "5 retries 30s→4m" so it matches the code: `200 ครั้ง backoff 1s·2^n สูงสุด 60s (≈3 ชม.) แล้วเข้า dead-letter`.
- Append a new section:

```markdown
## 6. ทาง josh → commerce

josh ส่ง event จาก `commerce_outbox` (trigger บน orders / order_items / payment_transactions /
payment_transaction_orders / users ที่เป็นลูกค้า) — เปิดด้วย `JOSH_EVENTS_TO_COMMERCE_ENABLED=true` ฝั่ง josh

- `POST {COMMERCE_PLATFORM_BASE_URL}/internal/josh-events` · header `x-event-type`, `x-delivery-id`
  (`<type>:<aggregateId>:<version>`), `x-signature` = HMAC-SHA256 hex ของ body ด้วย `COMMERCE_EVENTS_SECRET`
  (josh) = `JOSH_EVENTS_SECRET` (commerce)
- body `{ type, aggregateId, version, occurredAt, data }` · `version` = `commerce_snapshot_seq` (ตัวเลข string)
- commerce รับเฉพาะ version ที่ใหม่กว่าที่เก็บไว้ ตัวเก่า/ซ้ำตอบ 200 แล้วทิ้ง
- josh ส่งซ้ำเมื่อไม่ได้ 2xx (backoff 1s·2^n สูงสุด 60s ไม่ทิ้ง) · แถวเก่ากว่า 7 วันถูก prune → ซ่อมด้วย backfill

| type | data |
|---|---|
| `order.snapshot` | `{ order, items }` — คอลัมน์เดียวกับ `josh_orders` / `josh_order_lines` |
| `customer.snapshot` | คอลัมน์ลูกค้าที่ไม่อ่อนไหว (ไม่มี password / token_version) + `branch_ids` |
| `customer.deleted` | `{ id }` — commerce ลบข้อมูล เก็บ tombstone |
| `erp.fallback.received` | `{ method, path, body, receivedAt }` — ERP ยิงตรงเข้า josh ระหว่าง commerce ล่ม |

Backfill: `POST /api/reports/order-copy/backfill {group: order|customer}` (commerce staff) → josh
`POST /internal/commerce/backfill` (ลงลายเซ็นแบบ commerce → josh)
```

- [ ] **Step 6: Run the commerce test suite for josh, the typecheck and the build**

```bash
npx jest -c apps/commerce-platform/jest.config.cts connector/josh
npx tsc --noEmit -p apps/commerce-platform/tsconfig.app.json
npx nx build commerce-platform
```

Expected: PASS; clean; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/commerce-platform/src/modules/integration/connector/josh docs/event-contract.md
git commit -m "feat(josh-events): signed /internal/josh-events receiver + staff backfill trigger; contract §6"
```

---

### Task 9: End-to-end check (local, both apps)

**Files:** none (verification only)

- [ ] **Step 1: Run both apps locally against local DBs with the shared secret**

```bash
# commerce (this repo): JOSH_EVENTS_SECRET=dev-pipe JOSH_API_URL=http://localhost:3000/api ./scripts/commerce.sh start
# josh (worktree): COMMERCE_PLATFORM_BASE_URL=http://localhost:3100/api COMMERCE_EVENTS_SECRET=dev-pipe JOSH_EVENTS_TO_COMMERCE_ENABLED=true npm run start backend
```

- [ ] **Step 2: Place or update an order on josh, then check commerce within 5 seconds**

```bash
psql "$JOSH_LOCAL_DB" -c "UPDATE orders SET remark = 'pipe test ' || now() WHERE orders_id = (SELECT orders_id FROM orders ORDER BY create_date DESC LIMIT 1) RETURNING orders_id"
sleep 5; psql "$COMMERCE_LOCAL_DB" -c "SELECT orders_id, remark, source_version FROM josh_orders ORDER BY copied_at DESC LIMIT 1"
```

Expected: same `orders_id`, the new remark, and `source_version > 0`.

- [ ] **Step 3: Simulate a commerce outage.** Stop commerce, update 3 orders, wait 30 s, start commerce. Then:

```bash
psql "$JOSH_LOCAL_DB" -c "SELECT count(*) FILTER (WHERE sent_at IS NULL) AS pending, max(attempts) FROM commerce_outbox"
```

Expected: `pending` drops to 0 within about 60 s after commerce is back, and every update shows in `josh_orders`.

- [ ] **Step 4: Check the stale guard on stock.**

```bash
curl -s -X PUT localhost:3000/api/erp/products/qty -H "X-ERP-Key: $ERP_WEBHOOK_KEY" -H 'content-type: application/json' \
  -d '[{"PRODUCT_CODE":"<a real sku>","QUANTITY":9,"CHANGED_AT":"2026-10-06T10:05:00Z"}]'
curl -s -X PUT localhost:3000/api/erp/products/qty -H "X-ERP-Key: $ERP_WEBHOOK_KEY" -H 'content-type: application/json' \
  -d '[{"PRODUCT_CODE":"<a real sku>","QUANTITY":1,"CHANGED_AT":"2026-10-06T10:00:00Z"}]'
```

Expected: the second response has `stale: 1`, and the quantity stays 9. A `commerce_outbox` row of type `erp.fallback` exists for each call, and after draining, `josh_erp_fallback_calls` in commerce has both.

- [ ] **Step 5: Run backfill.** `POST /api/reports/order-copy/backfill {"group":"customer"}` as a commerce admin. Expected: `{ enqueued: N }`, and `josh_customers` fills to N rows with no `password` key in `data`.

- [ ] **Step 6: Record the results** in the PR descriptions for both repos: latency seen, outage recovery time, and the trigger cost from Task 1 Step 7.

---

## Rollout (ops — user runs these on prod; Claude cannot change josh prod)

1. Deploy commerce first: run the migration (deploy runs it), and set the GitHub secret `JOSH_EVENTS_SECRET`. It already exists and is shared with commerce→josh.
2. Run josh's DB migration through the `db-migrate.yml` workflow, then deploy josh. The flag is still off, so triggers record and nothing is sent.
3. Set josh env `COMMERCE_PLATFORM_BASE_URL=https://commerce.joshapp.io/api`, and make `COMMERCE_EVENTS_SECRET` equal commerce's `JOSH_EVENTS_SECRET`. Then set `JOSH_EVENTS_TO_COMMERCE_ENABLED=true` and restart josh backend.
4. Commerce admin: run backfill `customer`, then `order`.
5. Rollback: set `JOSH_EVENTS_TO_COMMERCE_ENABLED=false`. Triggers keep recording for 7 days; run backfill after re-enabling.
