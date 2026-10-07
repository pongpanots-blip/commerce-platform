# Stage 2c — winback reads commerce copies, not josh's replica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce's winback (sales app API, intake form, staff sign-in check) works with `JOSH_DATABASE_URL` unset — every josh fact it needs comes from copies fed by josh events or a one-off import.

**Architecture:** josh's commerce outbox (stage 0) gets four more snapshot groups — `company`, `cuisine`, `restaurant_place`, `staff` (non-customer users with `token_version`, decided 2026-10-07) — and `customer.snapshot` gains `legacy_custcode` / `onboarding_completed`. commerce stores them in real-column tables named like josh's columns, plus a `josh_users` view (customers ∪ staff) so winback's existing TypeORM entities just point at copy tables. `erp_sales_history` is a static ERP export: imported once. Deletes leave a tombstone so a late older snapshot cannot bring a row (or a staff login) back. Only `WinbackMirror` still uses the replica (background diff, not a request path).

**Tech Stack:** NestJS 10, TypeORM 0.3, Postgres (plpgsql triggers, views), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` (rule 1: josh and commerce fail independently; §2.2 josh → commerce events; §2.3 versions). Previous: `docs/superpowers/plans/2026-10-07-stage2b-winback-sales-reps.md`.

## Global Constraints

- josh changes additive; the outbox only sends when `JOSH_EVENTS_TO_COMMERCE_ENABLED=true` (stage 0); triggers are cheap inserts.
- `customer.snapshot` stays marketing-safe: no password hash, no `token_version` (spec §2.2). `token_version` travels only in `staff.snapshot`.
- Light tests (owner's RAM): single specs `--runInBand`, full suites `--maxWorkers=2`, no dev servers; real-DB checks on scratch copies (`DB_NAME=…` for josh migrations, never the default DB).
- Branches: josh `feat/commerce-copies-for-winback` from `feat/commerce-owns-winback` (2b, jagota/Webjosh#495 open); commerce `feat/stage2c-winback-copies` from `feat/stage2b-winback` (#37 open).

## File map

| Repo | File | Change |
|---|---|---|
| josh | `apps/backend/src/migrations/1792340000000-CommerceOutboxReference.ts` | triggers: company / cuisine / restaurant_place; users → `staff` for non-customers |
| josh | `app/commerce-events/commerce-snapshot.builder.ts(+spec)` | `company`, `cuisine`, `restaurant_place`, `staff` snapshots; customer extras |
| josh | `app/commerce-events/commerce-outbox.drainer.ts(+spec)` | new snapshot types; any `*.deleted` |
| josh | `app/commerce-events/commerce-backfill.controller.ts` | backfill groups |
| commerce | `migrations/1794500000000-JoshReferenceCopies.ts` | copy tables, tombstones, `josh_users` view, indexes |
| commerce | `connector/josh/events/josh-events.service.ts(+spec)` | apply `<group>.snapshot` / `<group>.deleted` |
| commerce | `winback/josh-replica-tables.ts` → `winback/josh-copies.entity.ts` | entities on copy tables, used columns only |
| commerce | `winback/winback.module.ts`, `connector/josh/josh-replica.ts` | repositories on commerce's DataSource |
| commerce | `winback/shared/admin-write.guard.ts`, `winback-staff-actions.ts`, `lead.service.ts`, `shared/cuisine.service.ts`, `intake.service.ts` | raw SQL on copies |
| commerce | `customers/sales-reps.service.ts(+specs)` | rep must be a josh user (`josh_users`) again |
| commerce | `cli/import-from-josh.ts` | `erp-sales-history` scope, paged |
| commerce | `docs/event-contract.md`, `docs/runbooks/stage2c-winback-copies.md` | docs |

---

### Task 1: josh — triggers for the new groups

**Files:** Create `apps/backend/src/migrations/1792340000000-CommerceOutboxReference.ts`; extend `app/commerce-events/commerce-outbox.trigger.db.spec.ts` if it is the opt-in trigger spec (it is — `COMMERCE_OUTBOX_TEST_DATABASE_URL`).

**Interfaces:** Produces outbox rows `(type, aggregate_id)`: `company` / `company.deleted`, `cuisine` / `cuisine.deleted`, `restaurant_place` / `restaurant_place.deleted`, `staff` / `staff.deleted` (users whose OLD or NEW role is not a customer role).

- [ ] **Step 1: Migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 2c (commerce-platform plan 2026-10-07): commerce's winback stops reading josh's replica. Reference rows it needs
 * — companies, cuisines, restaurant places and staff (non-customer users: sign-in check, rep names) — go through the
 * commerce outbox like customers and orders. Users: a role change between customer and staff sends both groups, so
 * commerce never keeps a demoted staff member as staff.
 */
export class CommerceOutboxReference1792340000000 implements MigrationInterface {
  name = 'CommerceOutboxReference1792340000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE OR REPLACE FUNCTION commerce_outbox_reference() RETURNS trigger AS $$
      DECLARE t text := TG_ARGV[0];
      BEGIN
        IF TG_OP = 'DELETE' THEN INSERT INTO commerce_outbox (type, aggregate_id) VALUES (t || '.deleted', OLD.id);
        ELSE INSERT INTO commerce_outbox (type, aggregate_id) VALUES (t, NEW.id); END IF;
        RETURN NULL;
      END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_company AFTER INSERT OR DELETE ON company
      FOR EACH ROW EXECUTE FUNCTION commerce_outbox_reference('company')`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_company_upd AFTER UPDATE OF name, register_number ON company
      FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name OR OLD.register_number IS DISTINCT FROM NEW.register_number)
      EXECUTE FUNCTION commerce_outbox_reference('company')`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_cuisine AFTER INSERT OR UPDATE OR DELETE ON cuisine
      FOR EACH ROW EXECUTE FUNCTION commerce_outbox_reference('cuisine')`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_restaurant_place AFTER INSERT OR UPDATE OR DELETE ON restaurant_place
      FOR EACH ROW EXECUTE FUNCTION commerce_outbox_reference('restaurant_place')`);
    await q.query(`CREATE OR REPLACE FUNCTION commerce_outbox_staff() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF NOT EXISTS (SELECT 1 FROM app_roles r WHERE r.code = OLD.role AND r.user_type = 'customer') THEN
            INSERT INTO commerce_outbox (type, aggregate_id) VALUES ('staff.deleted', OLD.id);
          END IF;
        ELSIF NOT EXISTS (SELECT 1 FROM app_roles r WHERE r.code = NEW.role AND r.user_type = 'customer')
           OR (TG_OP = 'UPDATE' AND NOT EXISTS (SELECT 1 FROM app_roles r WHERE r.code = OLD.role AND r.user_type = 'customer')) THEN
          INSERT INTO commerce_outbox (type, aggregate_id) VALUES ('staff', NEW.id);
        END IF;
        RETURN NULL;
      END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE OR REPLACE TRIGGER commerce_outbox_staff AFTER INSERT OR UPDATE OR DELETE ON users
      FOR EACH ROW EXECUTE FUNCTION commerce_outbox_staff()`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const [trigger, table] of [['commerce_outbox_staff', 'users'], ['commerce_outbox_restaurant_place', 'restaurant_place'],
      ['commerce_outbox_cuisine', 'cuisine'], ['commerce_outbox_company_upd', 'company'], ['commerce_outbox_company', 'company']]) {
      await q.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
    }
    await q.query(`DROP FUNCTION IF EXISTS commerce_outbox_staff()`);
    await q.query(`DROP FUNCTION IF EXISTS commerce_outbox_reference()`);
  }
}
```

- [ ] **Step 2: Run on a scratch copy** — `createdb -T josh_commerce_local josh_2c_test; DB_NAME=josh_2c_test npm run migration:run`, then in psql: update a company name, a cuisine, a restaurant place, a staff user's `token_version`, and a customer's name → `SELECT type FROM commerce_outbox ORDER BY id DESC LIMIT 5` shows `customer`, `staff`, `restaurant_place`, `cuisine`, `company`; a customer update adds no `staff` row.
- [ ] **Step 3: Commit** `feat(commerce-events): outbox triggers for company, cuisine, restaurant place and staff (stage 2c)`

### Task 2: josh — snapshots, drainer, backfill

**Files:** `app/commerce-events/commerce-snapshot.builder.ts(+spec)`, `commerce-outbox.drainer.ts(+spec)`, `commerce-backfill.controller.ts(+spec)`.

**Interfaces:** Produces envelopes `{ type: '<group>.snapshot', aggregateId, version, occurredAt, data }` with `data` columns:
- `company`: `id, name, register_number`
- `cuisine`: `id, parent_id, cuisine_name, cuisine_name_th, level, is_active`
- `restaurant_place`: `to_jsonb(p)` (every column; commerce keeps the ones it has)
- `staff`: `id, email, first_name, last_name, role, user_type, is_active, token_version, company_id, created_at, last_app_login_at`
- `customer` adds `legacy_custcode, onboarding_completed`.
`<group>.deleted`: `{ id }`, version from `commerce_snapshot_seq`.

- [ ] **Step 1: Failing builder spec** (existing spec style: fake `db.query` returning rows; assert type, aggregateId, data keys and that `staff` SQL selects `token_version` while the `customer` SQL does not).
- [ ] **Step 2: Builder**

```ts
export type SnapshotType = 'order' | 'customer' | 'catalog' | 'company' | 'cuisine' | 'restaurant_place' | 'staff';
/** Reference rows commerce's winback reads (stage 2c). staff carries token_version for the sign-in check — never in customer.snapshot. */
const REFERENCE: Record<'company' | 'cuisine' | 'restaurant_place' | 'staff', string> = {
  company: `SELECT c.id::text AS id, c.name, c.register_number, nextval('commerce_snapshot_seq')::text AS version FROM company c WHERE c.id = ANY($1::uuid[])`,
  cuisine: `SELECT c.id::text AS id, c.parent_id::text AS parent_id, c.cuisine_name, c.cuisine_name_th, c.level, c.is_active,
    nextval('commerce_snapshot_seq')::text AS version FROM cuisine c WHERE c.id = ANY($1::uuid[])`,
  restaurant_place: `SELECT to_jsonb(p) AS row, p.id::text AS id, nextval('commerce_snapshot_seq')::text AS version FROM restaurant_place p WHERE p.id = ANY($1::uuid[])`,
  staff: `SELECT u.id::text AS id, u.email, u.first_name, u.last_name, u.role, r.user_type, u.is_active, u.token_version,
    u.company_id::text AS company_id, u.created_at, u.last_app_login_at, nextval('commerce_snapshot_seq')::text AS version
    FROM users u LEFT JOIN app_roles r ON r.code = u.role WHERE u.id = ANY($1::uuid[])`,
};
```
In `build()`, before the order branch:
```ts
    if (type in REFERENCE) {
      const rows = await this.db.query<Row[]>(REFERENCE[type as keyof typeof REFERENCE], [ids]);
      return rows.map(({ version, row, ...data }) => ({
        type: `${type}.snapshot` as Snapshot['type'], aggregateId: data.id as string, version: version as string, occurredAt,
        data: row ?? data,
      }));
    }
```
(`Snapshot['type']` widens to `` `${SnapshotType}.snapshot` ``.) `CUSTOMER` gains `u.legacy_custcode, u.onboarding_completed`.
- [ ] **Step 3: Drainer** — `SNAPSHOT_TYPES = ['order', 'customer', 'catalog', 'company', 'cuisine', 'restaurant_place', 'staff']`; the deleted branch becomes `if (row.type.endsWith('.deleted'))` (same nextval version, `data: { id }`). Spec: a `staff.deleted` row is sent with a snapshot-sequence version.
- [ ] **Step 4: Backfill groups**

```ts
  company: `INSERT INTO commerce_outbox (type, aggregate_id) SELECT 'company', c.id FROM company c`,
  cuisine: `INSERT INTO commerce_outbox (type, aggregate_id) SELECT 'cuisine', c.id FROM cuisine c`,
  restaurant_place: `INSERT INTO commerce_outbox (type, aggregate_id) SELECT 'restaurant_place', p.id FROM restaurant_place p`,
  staff: `INSERT INTO commerce_outbox (type, aggregate_id) SELECT 'staff', u.id FROM users u LEFT JOIN app_roles r ON r.code = u.role WHERE r.user_type IS DISTINCT FROM 'customer'`,
```
Error message lists all groups.
- [ ] **Step 5:** commerce-events specs + tsc; real-DB check on `josh_2c_test`: `new CommerceSnapshotBuilder(ds).build(t, [id])` for each group returns one envelope with the listed keys (temporary spec, not committed).
- [ ] **Step 6: Commit** `feat(commerce-events): company, cuisine, restaurant place and staff snapshots; customer legacy code and onboarding (stage 2c)`

### Task 3: commerce — copy tables and the users view

**Files:** Create `apps/commerce-platform/src/migrations/1794500000000-JoshReferenceCopies.ts`.

- [ ] **Step 1: Migration**

```ts
/**
 * Stage 2c: josh reference rows winback reads, copied from josh events (columns named as in josh), so winback runs
 * without josh's replica. A delete leaves a tombstone (josh_reference_tombstones) so an older snapshot delivered late
 * cannot bring the row — or a staff sign-in — back. josh_users = customers (customer.snapshot) ∪ staff (staff.snapshot).
 */
up:
CREATE TABLE josh_companies (id uuid PRIMARY KEY, name varchar(255), register_number varchar(50), source_version bigint NOT NULL DEFAULT 0);
CREATE TABLE josh_cuisines (id uuid PRIMARY KEY, parent_id uuid NULL, cuisine_name varchar(255) NOT NULL, cuisine_name_th varchar(255),
  level int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, source_version bigint NOT NULL DEFAULT 0);
CREATE TABLE josh_restaurant_places (<every column of josh restaurant_place, same names and types, generated from information_schema on
  josh_commerce_local>, source_version bigint NOT NULL DEFAULT 0);
CREATE TABLE josh_staff (id uuid PRIMARY KEY, email varchar(255), first_name varchar(100), last_name varchar(100), role varchar(50),
  user_type varchar(20), is_active boolean NOT NULL DEFAULT true, token_version int NOT NULL DEFAULT 0, company_id uuid NULL,
  created_at timestamptz, last_app_login_at timestamptz, source_version bigint NOT NULL DEFAULT 0);
CREATE TABLE josh_erp_sales_history (id bigint PRIMARY KEY, cust_code varchar(16) NOT NULL, inv_date date NOT NULL,
  total numeric(14,4), del_province varchar(64));
CREATE INDEX "IDX_josh_esh_code_date" ON josh_erp_sales_history (upper(trim(cust_code)), inv_date);
CREATE TABLE josh_reference_tombstones (tbl varchar(40) NOT NULL, id uuid NOT NULL, source_version bigint NOT NULL, PRIMARY KEY (tbl, id));
CREATE INDEX "IDX_josh_orders_customer_code" ON josh_orders (upper(trim(customer_code)));
CREATE VIEW josh_users AS
  SELECT c.id, c.data->>'email' AS email, c.data->>'first_name' AS first_name, c.data->>'last_name' AS last_name, c.data->>'role' AS role,
    COALESCE((c.data->>'is_active')::boolean, true) AS is_active, NULLIF(c.data->>'company_id', '')::uuid AS company_id,
    c.data->>'custcode' AS custcode, c.data->>'legacy_custcode' AS legacy_custcode,
    (c.data->>'created_at')::timestamptz AS created_at, (c.data->>'last_app_login_at')::timestamptz AS last_app_login_at,
    COALESCE((c.data->>'onboarding_completed')::boolean, false) AS onboarding_completed, false AS internal
  FROM josh_customers c WHERE c.deleted_at IS NULL
  UNION ALL
  SELECT s.id, s.email, s.first_name, s.last_name, s.role, s.is_active, s.company_id, NULL, NULL, s.created_at, s.last_app_login_at,
    true, s.user_type = 'internal'
  FROM josh_staff s WHERE s.user_type IS DISTINCT FROM 'customer';
down: drop in reverse.
```
(`total` / column types: copy `erp_sales_history.total` type from `scripts/create-erp-sales-history.sql` in josh.)
- [ ] **Step 2:** migrate `commerce_2c_test` (copy of `commerce_db`) up / down / up.
- [ ] **Step 3: Commit** `feat(winback): copy tables for josh companies, cuisines, restaurant places, staff and ERP sales history (stage 2c)`

### Task 4: commerce — apply the new events

**Files:** `connector/josh/events/josh-events.service.ts(+spec)`.

**Interfaces:** Consumes Task 2 envelopes. Table map: `company → josh_companies`, `cuisine → josh_cuisines`, `restaurant_place → josh_restaurant_places`, `staff → josh_staff`.

- [ ] **Step 1: Failing spec cases** — `company.snapshot` upserts with `jsonb_populate_record` and `source_version`; an older version than the tombstone is `stale`; `staff.deleted` deletes the row, writes a tombstone and clears `company_sales_reps` for that rep.
- [ ] **Step 2: Implement**

```ts
const REFERENCE_TABLES = { company: 'josh_companies', cuisine: 'josh_cuisines', restaurant_place: 'josh_restaurant_places', staff: 'josh_staff' } as const;
// in apply(), default branch:
      default: {
        const [group, kind] = e.type.split('.') as [keyof typeof REFERENCE_TABLES, string];
        const table = REFERENCE_TABLES[group];
        if (table && kind === 'snapshot') return this.reference(table, e, (m) => this.saveReference(m, table, e));
        if (table && kind === 'deleted') return this.reference(table, e, async (m) => {
          await m.query(`DELETE FROM ${table} WHERE id = $1`, [e.aggregateId]);
          await m.query(`INSERT INTO josh_reference_tombstones (tbl, id, source_version) VALUES ($1, $2, $3)
            ON CONFLICT (tbl, id) DO UPDATE SET source_version = EXCLUDED.source_version`, [table, e.aggregateId, e.version]);
          if (group === 'staff') await m.query(`UPDATE company_sales_reps SET assigned_sales_user_id = NULL, updated_at = now() WHERE assigned_sales_user_id = $1`, [e.aggregateId]);
        });
        throw new BadRequestException(`unsupported josh event ${e.type}`);
      }

  /** guarded() for reference copies: also stale against a tombstone. */
  private reference(table: string, e: JoshEnvelope, write: (m: EntityManager) => Promise<unknown>): Promise<ApplyResult> {
    return this.db.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${table}:${e.aggregateId}`]);
      const [row] = await m.query(`SELECT GREATEST((SELECT source_version FROM ${table} WHERE id = $1),
        (SELECT source_version FROM josh_reference_tombstones WHERE tbl = $2 AND id = $1)) AS v`, [e.aggregateId, table]);
      if (row?.v != null && BigInt(row.v) >= BigInt(e.version)) return 'stale';
      await write(m);
      return 'applied';
    });
  }

  /** Columns both sides have, as josh sent them (jsonb_populate_record casts), plus the version. */
  private async saveReference(m: EntityManager, table: string, e: JoshEnvelope) {
    if (e.data?.id !== e.aggregateId) throw new BadRequestException(`${e.type} data.id must equal the aggregate id`);
    const cols = (await this.columns(table)).filter((c) => c !== 'source_version' && c in e.data);
    const list = cols.map((c) => `"${c}"`).join(', ');
    await m.query(`INSERT INTO ${table} (${list}, source_version) SELECT ${list}, $2 FROM jsonb_populate_record(NULL::${table}, $1::jsonb)
      ON CONFLICT (id) DO UPDATE SET ${[...cols.filter((c) => c !== 'id'), 'source_version'].map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`,
      [JSON.stringify(e.data), e.version]);
  }
```
`columns(table)` caches `information_schema.columns` per table (same as josh's `CommerceWinbackEventsService.tableColumns`).
- [ ] **Step 3:** spec + opt-in DB spec on `commerce_2c_test` (`JOSH_EVENTS_TEST_DATABASE_URL`): snapshot → row; older → stale; deleted → gone + tombstone; older snapshot after delete → stale.
- [ ] **Step 4: Commit** `feat(josh-events): apply company, cuisine, restaurant place and staff snapshots with delete tombstones (stage 2c)`

### Task 5: commerce — winback on the copies

**Files:** rename `winback/josh-replica-tables.ts` → `winback/josh-copies.entity.ts` (picked up by commerce's `*.entity.ts` glob); update every import; `winback.module.ts`; `connector/josh/josh-replica.ts` (no entities); raw SQL in `shared/admin-write.guard.ts`, `winback-staff-actions.ts`, `lead.service.ts` (`listSalesUsers`), `shared/cuisine.service.ts`, `intake.service.ts`.

- [ ] **Step 1: Entities** — keep class names (`JoshUser`, …) and enums; table names `josh_users` / `josh_orders` / `josh_companies` / `josh_restaurant_places` / `josh_erp_sales_history`; keep only the columns the copy has (users: id, email, first_name, last_name, role, is_active, company_id, custcode, legacy_custcode, created_at, last_app_login_at, onboarding_completed, internal; orders: orders_id, customer_code, create_date, status, total_price, user_id, company_id; company: id, name, register_number; restaurant place: all; ERP history: id, cust_code, inv_date, total, del_province). `tsc` lists any property a service still uses that the copy lacks — add it to the copy or drop the use.
- [ ] **Step 2: Module** — replace the `replicaRepository` providers with `TypeOrmModule.forFeature(JOSH_COPY_TABLES)`; delete `replicaRepository` and the start-up replica connect.
- [ ] **Step 3: Raw SQL** —
  - guard: `SELECT token_version, is_active, internal FROM josh_users u JOIN josh_staff s USING (id) WHERE u.id = $1` → simplified to `SELECT token_version, is_active, user_type = 'internal' AS internal FROM josh_staff WHERE id = $1`; inject `DataSource`; error text `JOSH_DATABASE_URL` → `JOSH_JWT_SECRET` only.
  - staff actions actor: `SELECT id, role FROM josh_users WHERE internal AND is_active AND lower(email) = lower($1) LIMIT 1`.
  - `listSalesUsers`: drop the `app_roles` join, add `.andWhere('u.internal = true')`.
  - cuisine / intake: `cuisine` → `josh_cuisines`; inject `DataSource` instead of `JoshReplica`.
- [ ] **Step 4:** winback specs (`--runInBand`) — update mocks that stubbed `JoshReplica.query` to stub `DataSource.query`; tsc.
- [ ] **Step 5: Sales rep check back** — `SalesRepsService.assign`: `SELECT 1 FROM josh_users WHERE id = $1 AND internal` → 404 'ไม่พบพนักงานขาย' (josh: the rep must exist); specs updated.
- [ ] **Step 6: Commit** `feat(winback): read josh users, orders, companies, places, cuisines and ERP history from commerce copies (stage 2c)`

### Task 6: commerce — ERP sales history import, docs, runbook

- [ ] **Step 1: Import** — `Plan.pageBy?: string`: read `WHERE pageBy > $last ORDER BY pageBy LIMIT 5000` and insert each page with one multi-row `INSERT … SELECT * FROM unnest(...)`-free VALUES list; scope `'erp-sales-history': [{ table: 'erp_sales_history', target: 'josh_erp_sales_history', pageBy: 'id' }]`.
- [ ] **Step 2: Docs** — event contract §6 (josh → commerce): the four groups + customer extras; `.env.example`: `JOSH_DATABASE_URL` now only for `WinbackMirror` and one-off imports; runbook `docs/runbooks/stage2c-winback-copies.md` (josh deploy → `JOSH_EVENTS_TO_COMMERCE_ENABLED` already on → backfill `customer`, `company`, `cuisine`, `restaurant_place`, `staff` → import `erp-sales-history` → counts equal josh → deploy commerce → winback pages / sign-in work → unset `JOSH_DATABASE_URL` except where the mirror runs; rollback = previous commerce release).
- [ ] **Step 3: Commit** `docs(stage2c): reference events, ERP history import, cutover runbook`

### Task 7: verification (light) and as built

- [ ] josh: migration + builder on `josh_2c_test` (Task 1/2 checks).
- [ ] commerce: migrations on `commerce_2c_test`; apply real envelopes built by josh (company / cuisine / place / staff, customer with extras) through `JoshEventsService`; then a smoke spec (temporary) that boots TypeORM with the entity glob on `commerce_2c_test` and runs one `find({ take: 1 })` per copy entity plus `listSalesUsers`, the guard query, the pool count query, and the sync aggregation — proves the column mapping.
- [ ] Full suites `--maxWorkers=2`; As built; drop scratch DBs; commit.

## As built (2026-10-07)

- **Sign-in check:** `AdminWriteGuard` reads `token_version, is_active, (user_type = 'internal' AND role = <token role>)` from
  `josh_staff`. josh checks the token's role against `app_roles`; the copy only knows the user's current role, so a token
  whose role is no longer the user's is refused (re-login) — stricter, never looser. A customer (in `josh_users`, not in
  `josh_staff`) still gets josh's 403. New `admin-write.guard.spec.ts` covers ok / bumped token_version / suspended /
  non-internal / customer / unknown.
- **2b fix carried here:** in 2b the rep check had to go (no staff in the customer copy); it is back against
  `josh_users.internal`. `staff.deleted` unassigns the rep from companies.
- **Receiver:** reference events go through one generic path (`jsonb_populate_record` over the columns both sides have);
  `GREATEST(row version, tombstone version)` decides stale. No opt-in DB spec — verified with real envelopes instead
  (below).
- **Backfill:** commerce's `/api/reports/order-copy/backfill` also had a group allowlist; it now accepts the four new groups.
- **Pool fix (side effect):** the "place not yet a lead" check now runs on commerce's own `winback_account`; on the replica
  it checked josh's copy, which only follows commerce through the mirror.
- **Still on the replica:** `WinbackMirror` (by design), and outside winback `connector/josh/restaurant-places.ts`
  (restaurant report / MCP), `connector/josh/winback/*` (josh-side winback reports) and other connectors.

**Verification (scratch copies, no servers):**
- josh: migration on a copy of the dev DB; triggers enqueue `company` (only when name / register number change), `cuisine`,
  `restaurant_place`, `staff` (token_version bump) and nothing extra for a customer update; the builder produced 161 real
  envelopes (1 company, 80 cuisines, 50 places, 17 staff, 13 customers with the new fields).
- commerce: migrations up / down / up; all 161 envelopes applied; replay → stale; delete then a later-built older snapshot
  → stale (tombstone); `josh_users` = 13 customers + 16 internal staff. Smoke run of the real services on the copies
  (seeded with 15 winback accounts, 1639 orders, 90 ERP lines): every copy entity loads, `listSalesUsers`, `findPool`
  (both tabs), `getAccount`, `getCounts`, `getDashboard`, `getTeamStats`, cuisine hierarchy (67) and `syncFromJosh`
  (15 accounts updated from ERP history) all ran. Paged ERP import: 12,345 synthetic rows twice → same count and sum as
  the source.
- Full suites (`--maxWorkers=2`): commerce 1280 passed (14 opt-in skipped); josh 6709 passed, only the known `pii-leak.spec` fails (pre-existing). Scratch DBs dropped.
