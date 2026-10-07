# Stage 2b — winback and sales-rep assignment owned by commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce becomes the writer of winback (the saleactivity app's CRM) and of the company → sales-rep assignment; josh keeps copies fed by commerce events.

**Architecture:** winback is already ported to commerce (`modules/integration/winback`, `WINBACK_OWNER`, `WinbackMirror`); the josh side of that switch exists only on the unmerged branch `origin/feat/commerce-owns-catalog` (commit `88633db2`) — this plan lands it. The sales-rep assignment (`company.assigned_sales_user_id`, written today by josh CS-admin `PATCH /cs-admin/sales-assignment`) moves to a commerce table `company_sales_reps`, published as `company.sales_rep` snapshot events that josh applies to `company`. Reads that winback does on josh's replica (users, orders, company, restaurant_place, erp_sales_history, cuisine, login check) **stay** — cutting the replica is stage 2c.

**Tech Stack:** NestJS 10, TypeORM (raw SQL where the 2a code does), Postgres, BullMQ webhook delivery, class-validator DTOs, Jest; React (commerce-admin hosted josh pages).

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` (§1 ownership table: winback/CRM → commerce; §2.3 version guard; §2.4 flags; §4.1 per-group steps; rule 5 PDPA). Previous stage: `docs/superpowers/plans/2026-10-07-stage2a-customer-marketing.md`.

## Global Constraints

- josh changes are additive and default off (spec rule 4); flags: josh `WINBACK_OWNED_BY_COMMERCE`, `COMMERCE_OWNS_CUSTOMERS` (2a); commerce `WINBACK_OWNER`, `COMMERCE_OWNS_SALES_REPS` (new).
- josh and commerce survive each other's outage (rule 1): the shop never calls commerce; commerce down = sales app down only.
- `/api/erp` on josh is never gated (rule 3).
- PDPA (rule 5): a deleted customer is removed on both sides.
- Tests run light (owner's machine has limited RAM): single specs with `--runInBand`; full suites with `--maxWorkers=2`; one dev server at a time in the E2E task. Always `--skip-nx-cache` with nx and read both `Test Suites:` and `Tests:`.
- Repos / branches:
  - commerce: `/Users/pongpanot_s/Documents/dev/commerce-platform/.claude/worktrees/ec2-pricing-calculation-1bcded`, branch `feat/stage2b-winback` (from `origin/master`, which contains 2a).
  - josh: `/Users/pongpanot_s/Documents/dev/josh-worktrees/commerce-event-pipe`, new branch `feat/commerce-owns-winback` **from `feat/commerce-owns-segments`** (2a, jagota/Webjosh#493 not merged yet — it carries `isCommerceOwningCustomers` and the segment handlers this plan extends).

## File map

| Repo | File | Change |
|---|---|---|
| josh | `apps/backend/src/app/winback/{winback-ownership.ts, commerce-winback-events.service.ts(+spec)}`, `auth/auth.service.ts`, `erp/commerce-erp-events.controller.ts(+spec)`, `erp/erp.module.ts`, winback controller/module/cron/intake/actions, `.env.example`, `docs/commerce-erp-receiver.md` | cherry-pick `88633db2` (Task 1) |
| josh | `apps/backend/src/app/cs-admin/commerce-sales-reps.service.ts(+spec)` | new — apply `company.sales_rep` (Task 2) |
| josh | `apps/backend/src/app/erp/commerce-erp-events.controller.ts`, `erp/erp.module.ts` | handler + provider (Task 2) |
| commerce | `apps/commerce-platform/src/migrations/1794400000000-CompanySalesReps.ts` | new table (Task 3) |
| commerce | `apps/commerce-platform/src/modules/integration/customers/sales-reps.service.ts(+spec)`, `sales-reps.controller.ts`, `customers.module.ts` | new (Task 3) |
| commerce | `modules/integration/segments/ownership.controller.ts`, `connector/josh/josh-actions.controller.ts` | `salesReps` flag; route assign to commerce when owned (Task 3) |
| commerce-admin | `src/josh-admin/libs/shared-api/lib/api-client/commerce-client.ts`, `.../cs-admin/cs-admin.api.ts` | write routing (Task 4) |
| commerce | `cli/import-from-josh.ts`, `connector/josh/events/josh-events.service.ts(+spec)` | `sales-reps` scope; PDPA (Task 5) |
| commerce | `docs/event-contract.md`, `docs/runbooks/stage2b-winback-cutover.md`, `apps/commerce-platform/.env.example` | docs (Task 6) |

---

### Task 1: josh — land the winback switch (`88633db2`)

**Files:** see file map row 1 (all from the commit).

**Interfaces:**
- Produces (josh): `winbackOwnedByCommerce()` and `WinbackOwnedByCommerceGuard` (`app/winback/winback-ownership.ts`); receiver handlers `winback.notify`, `winback.welcome_email`, `winback.row` → `CommerceWinbackEventsService.{notify, welcomeEmail, applyRow}`; promote-on-login POSTs commerce `/v1/storefront/winback/users/:id/logged-in` when the flag is on.
- Consumes (commerce, already on master): `WinbackRowChanged` (`winback.row`), notify/welcome publishers, `WinbackLoginController`.

- [ ] **Step 1: Branch and cherry-pick**

```bash
cd /Users/pongpanot_s/Documents/dev/josh-worktrees/commerce-event-pipe
git checkout -b feat/commerce-owns-winback feat/commerce-owns-segments
git cherry-pick 88633db2
```
Expected: one conflict in `docs/commerce-erp-receiver.md` (both sides added rows to the handler table). Keep both sides' rows, then `git add docs/commerce-erp-receiver.md && git cherry-pick --continue`.

- [ ] **Step 2: Check the merged receiver still has the 2a segment handlers and the winback ones**

```bash
grep -n "'segment\.\|'winback\." apps/backend/src/app/erp/commerce-erp-events.controller.ts
```
Expected: `segment.upserted`, `segment.deleted`, `segment.members`, `winback.notify`, `winback.welcome_email`, `winback.row`.

- [ ] **Step 3: Run the touched specs (light)**

```bash
NODE_OPTIONS=--max-old-space-size=2048 npx jest -c apps/backend/jest.config.cts --runInBand \
  apps/backend/src/app/winback apps/backend/src/app/erp/commerce-erp-events.controller.spec.ts apps/backend/src/app/auth 2>&1 | grep -E "Test Suites:|Tests:|✕"
```
Expected: all suites pass. A failure in a winback spec that asserts a 2xx on a write is the guard working only if the spec sets `WINBACK_OWNED_BY_COMMERCE=true`; otherwise it is a real regression — fix before going on.

- [ ] **Step 4: Typecheck**

```bash
npx tsc -p apps/backend/tsconfig.app.json --noEmit 2>&1 | head -20
```
Expected: no output.

- [ ] **Step 5: Commit** (the cherry-pick already committed; amend only if Step 3/4 needed fixes)

```bash
git commit --amend --no-edit   # only if files changed after the cherry-pick
```

---

### Task 2: josh — apply `company.sales_rep`

**Files:**
- Create: `apps/backend/src/app/cs-admin/commerce-sales-reps.service.ts`
- Create: `apps/backend/src/app/cs-admin/commerce-sales-reps.service.spec.ts`
- Modify: `apps/backend/src/app/erp/commerce-erp-events.controller.ts` (handler map near line 99, constructor near line 126)
- Modify: `apps/backend/src/app/erp/erp.module.ts` (providers near line 83)

**Interfaces:**
- Consumes: `applyIfNewer(runner, type, id, version: Date): Promise<boolean>` from `app/erp/applied-version.ts`; `isCommerceOwningCustomers()` from `app/erp/commerce-ownership.flag.ts`.
- Produces: event `company.sales_rep`, payload `{ companyId: uuid, salesUserId: uuid | null, assignedAt: ISO-8601 }` (commerce Task 3 publishes exactly this).

- [ ] **Step 1: Write the failing spec**

```ts
// apps/backend/src/app/cs-admin/commerce-sales-reps.service.spec.ts
import { ConflictException } from '@nestjs/common';
import { CommerceSalesRepsService } from './commerce-sales-reps.service';

function setup(applied = true) {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const manager = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push([sql, params]);
      return sql.includes('commerce_applied_versions') ? (applied ? [{ applied: true }] : []) : [];
    }),
  };
  const db = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)) };
  return { svc: new CommerceSalesRepsService(db as never), calls };
}
const dto = { companyId: '11111111-1111-4111-8111-111111111111', salesUserId: '22222222-2222-4222-8222-222222222222', assignedAt: '2026-10-07T01:00:00.000Z' };

describe('CommerceSalesRepsService (sales-rep assignment owned by commerce, stage 2b)', () => {
  afterEach(() => { delete process.env.COMMERCE_OWNS_CUSTOMERS; });

  it('refuses while josh still owns the assignment', async () => {
    await expect(setup().svc.apply(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('sets the company rep (an unknown user becomes null) when the event is newer', async () => {
    process.env.COMMERCE_OWNS_CUSTOMERS = 'true';
    const { svc, calls } = setup();
    expect(await svc.apply(dto)).toEqual({ applied: true });
    expect(calls[0][1]).toEqual(['company.sales_rep', dto.companyId, new Date(dto.assignedAt)]);
    expect(calls[1][0].replace(/\s+/g, ' ').trim()).toBe(
      'UPDATE company SET assigned_sales_user_id = (SELECT u.id FROM users u WHERE u.id = $2) WHERE id = $1');
    expect(calls[1][1]).toEqual([dto.companyId, dto.salesUserId]);
  });

  it('drops an older event', async () => {
    process.env.COMMERCE_OWNS_CUSTOMERS = 'true';
    const { svc, calls } = setup(false);
    expect(await svc.apply(dto)).toEqual({ applied: false });
    expect(calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module not found)**

```bash
npx jest -c apps/backend/jest.config.cts --runInBand apps/backend/src/app/cs-admin/commerce-sales-reps.service.spec.ts 2>&1 | grep -E "Test Suites:|Tests:|Cannot find"
```

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/app/cs-admin/commerce-sales-reps.service.ts
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsISO8601, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { DataSource } from 'typeorm';
import { applyIfNewer } from '../erp/applied-version';
import { isCommerceOwningCustomers } from '../erp/commerce-ownership.flag';

/** `company.sales_rep` — commerce assigned (or cleared) a company's sales rep. */
export class CompanySalesRepDto {
  @IsUUID() companyId!: string;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsUUID() salesUserId!: string | null;
  @IsISO8601() assignedAt!: string;
}

/**
 * company.assigned_sales_user_id written by commerce-platform (stage 2b, COMMERCE_OWNS_CUSTOMERS): josh's CS-admin
 * route is locked and this copy follows commerce. Latest assignment wins (commerce_applied_versions); a rep id josh
 * does not know (deleted meanwhile) clears the field instead of failing the delivery forever.
 */
@Injectable()
export class CommerceSalesRepsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  apply(d: CompanySalesRepDto): Promise<{ applied: boolean }> {
    if (!isCommerceOwningCustomers()) throw new ConflictException('josh still assigns sales reps (COMMERCE_OWNS_CUSTOMERS is not true)');
    return this.db.transaction(async (m) => {
      if (!(await applyIfNewer(m, 'company.sales_rep', d.companyId, new Date(d.assignedAt)))) return { applied: false };
      await m.query(
        `UPDATE company SET assigned_sales_user_id = (SELECT u.id FROM users u WHERE u.id = $2) WHERE id = $1`,
        [d.companyId, d.salesUserId ?? null],
      );
      return { applied: true };
    });
  }
}
```

- [ ] **Step 4: Run the spec — expect PASS (3 tests)**

Same command as Step 2.

- [ ] **Step 5: Wire the handler**

In `commerce-erp-events.controller.ts`:

```ts
import { CommerceSalesRepsService, CompanySalesRepDto } from '../cs-admin/commerce-sales-reps.service';
// next to SEGMENT_HANDLERS:
HANDLERS['company.sales_rep'] = { pipe: one(CompanySalesRepDto), input: 'data', run: (c, d) => c.ownedSalesReps().apply(d) };
// constructor, after `@Optional() private readonly segments?: CommerceSegmentsService,`:
    @Optional() private readonly salesReps?: CommerceSalesRepsService,
// next to ownedSegments():
  ownedSalesReps(): CommerceSalesRepsService {
    if (!this.salesReps) throw new Error('CommerceSalesRepsService not wired'); // 5xx → commerce retries
    return this.salesReps;
  }
```

In `erp.module.ts` add `CommerceSalesRepsService` to `providers` next to `CommerceSegmentsService` (and its import).

Add to `commerce-erp-events.controller.spec.ts`, beside the segment handler cases, one case: a `company.sales_rep` envelope with `data: dto` calls `salesReps.apply` with `dto` (copy the `segment.upserted` case and change type, DTO and mock).

- [ ] **Step 6: Run receiver + service specs, typecheck**

```bash
npx jest -c apps/backend/jest.config.cts --runInBand apps/backend/src/app/cs-admin/commerce-sales-reps.service.spec.ts apps/backend/src/app/erp/commerce-erp-events.controller.spec.ts 2>&1 | grep -E "Test Suites:|Tests:|✕"
npx tsc -p apps/backend/tsconfig.app.json --noEmit 2>&1 | head
```
Expected: pass; no tsc output.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/app/cs-admin/commerce-sales-reps.service* apps/backend/src/app/erp/commerce-erp-events.controller* apps/backend/src/app/erp/erp.module.ts
git commit -m "feat(cs-admin): apply company.sales_rep from commerce (stage 2b, COMMERCE_OWNS_CUSTOMERS)"
```

---

### Task 3: commerce — `company_sales_reps`, service, endpoint, ownership

**Files:**
- Create: `apps/commerce-platform/src/migrations/1794400000000-CompanySalesReps.ts`
- Create: `apps/commerce-platform/src/modules/integration/customers/sales-reps.service.ts`
- Create: `apps/commerce-platform/src/modules/integration/customers/sales-reps.service.spec.ts`
- Create: `apps/commerce-platform/src/modules/integration/customers/sales-reps.controller.ts`
- Modify: `apps/commerce-platform/src/modules/integration/customers/customers.module.ts`
- Modify: `apps/commerce-platform/src/modules/integration/segments/ownership.controller.ts`
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/josh-actions.controller.ts:164-167`

**Interfaces:**
- Consumes: `EVENT_BUS`/`IEventBus` (`shared-kernel/interfaces/event-bus.interface`), `DomainEvent`, `StaffRoles`.
- Produces: `ownsSalesReps(): boolean`; `SalesRepsService.assign(companyId: string, salesUserId: string | null): Promise<{ status: true; statusCode: 200; message: string; data: { id: string; assigned_sales_user_id: string | null } }>` (josh's CS-admin answer shape); route `PATCH /api/cs-admin/sales-assignment` body `{ company_id, sales_user_id? }`; `GET /api/ownership` → `{ segments, salesReps }`; event `company.sales_rep` `{ companyId, salesUserId, assignedAt }`.

- [ ] **Step 1: Migration** (column names match josh's `company` so the import copies them as-is)

```ts
// apps/commerce-platform/src/migrations/1794400000000-CompanySalesReps.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stage 2b: the company → sales rep assignment, owned here (josh `company.assigned_sales_user_id` follows). id = josh company id. */
export class CompanySalesReps1794400000000 implements MigrationInterface {
  name = 'CompanySalesReps1794400000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE company_sales_reps (
      id uuid PRIMARY KEY, assigned_sales_user_id uuid NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX "IDX_company_sales_reps_user" ON company_sales_reps (assigned_sales_user_id)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE company_sales_reps`);
  }
}
```

- [ ] **Step 2: Write the failing service spec**

```ts
// apps/commerce-platform/src/modules/integration/customers/sales-reps.service.spec.ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SalesRepsService } from './sales-reps.service';

const CO = '11111111-1111-4111-8111-111111111111', REP = '22222222-2222-4222-8222-222222222222';
function setup({ company = true, rep = true } = {}) {
  const published: Array<{ type: string; payload: unknown; metadata: unknown }> = [];
  const m = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('company_id')) return company ? [{}] : [];
      if (sql.startsWith('SELECT 1 FROM josh_customers WHERE id')) return rep ? [{}] : [];
      return [];
    }),
  };
  const db = { transaction: jest.fn(async (fn: (x: unknown) => unknown) => fn(m)) };
  const events = { publish: jest.fn(async (e: { type: string; payload: unknown; metadata: unknown }) => { published.push(e); }) };
  return { svc: new SalesRepsService(db as never, events as never), m, published };
}

describe('SalesRepsService (stage 2b)', () => {
  beforeEach(() => { process.env.COMMERCE_OWNS_SALES_REPS = 'true'; });
  afterEach(() => { delete process.env.COMMERCE_OWNS_SALES_REPS; });

  it('refuses until commerce owns the assignment', async () => {
    process.env.COMMERCE_OWNS_SALES_REPS = 'false';
    await expect(setup().svc.assign(CO, REP)).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s an unknown company or rep, like josh', async () => {
    await expect(setup({ company: false }).svc.assign(CO, REP)).rejects.toThrow('ไม่พบบริษัท');
    await expect(setup({ rep: false }).svc.assign(CO, REP)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('upserts the assignment and publishes company.sales_rep as a snapshot', async () => {
    const { svc, m, published } = setup();
    const answer = await svc.assign(CO, REP);
    expect(answer).toEqual({ status: true, statusCode: 200, message: 'กำหนดพนักงานขายสำเร็จ', data: { id: CO, assigned_sales_user_id: REP } });
    expect(m.query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO company_sales_reps'))).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ type: 'company.sales_rep', payload: { companyId: CO, salesUserId: REP }, metadata: { snapshot: true } });
  });

  it('clearing the rep skips the rep check', async () => {
    const { svc, published } = setup({ rep: false });
    await svc.assign(CO, null);
    expect(published[0]).toMatchObject({ payload: { salesUserId: null } });
  });
});
```

- [ ] **Step 3: Run — expect FAIL (module not found)**

```bash
npx jest -c apps/commerce-platform/jest.config.cts --runInBand sales-reps.service 2>&1 | grep -E "Test Suites:|Tests:|Cannot find"
```

- [ ] **Step 4: Implement the service**

```ts
// apps/commerce-platform/src/modules/integration/customers/sales-reps.service.ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DomainEvent } from '../../../shared-kernel/domain/domain-event';
import { EVENT_BUS, IEventBus } from '../../../shared-kernel/interfaces/event-bus.interface';

export const ownsSalesReps = () => process.env.COMMERCE_OWNS_SALES_REPS === 'true';

export interface CompanySalesRepPayload { companyId: string; salesUserId: string | null; assignedAt: string }
/** josh sets company.assigned_sales_user_id; latest wins (snapshot + josh's version guard on assignedAt). */
export class CompanySalesRepAssigned extends DomainEvent<CompanySalesRepPayload> {
  readonly type = 'company.sales_rep';
  constructor(payload: CompanySalesRepPayload) { super(payload.companyId, payload, { snapshot: true }); }
}

/**
 * Company → sales rep, owned by commerce from stage 2b (COMMERCE_OWNS_SALES_REPS, with josh COMMERCE_OWNS_CUSTOMERS).
 * josh CS-admin's assignSalesRep rules: the company and the rep must exist (here: in the import or the customer copy,
 * which holds every josh user, staff included); null clears. Answers in josh's shape so the hosted CS page is unchanged.
 */
@Injectable()
export class SalesRepsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(EVENT_BUS) private readonly events: IEventBus,
  ) {}

  assign(companyId: string, salesUserId: string | null) {
    if (!ownsSalesReps()) throw new ConflictException('sales reps are still assigned in josh (COMMERCE_OWNS_SALES_REPS is not true)');
    return this.db.transaction(async (m) => {
      const [company] = await m.query(
        `SELECT 1 FROM company_sales_reps WHERE id::text = $1
         UNION ALL SELECT 1 FROM josh_customers WHERE data->>'company_id' = $1 AND deleted_at IS NULL LIMIT 1`, [companyId]);
      if (!company) throw new NotFoundException('ไม่พบบริษัท');
      if (salesUserId) {
        const [rep] = await m.query(`SELECT 1 FROM josh_customers WHERE id = $1 AND deleted_at IS NULL`, [salesUserId]);
        if (!rep) throw new NotFoundException('ไม่พบพนักงานขาย');
      }
      await m.query(
        `INSERT INTO company_sales_reps (id, assigned_sales_user_id, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET assigned_sales_user_id = EXCLUDED.assigned_sales_user_id, updated_at = now()`,
        [companyId, salesUserId]);
      await this.events.publish(new CompanySalesRepAssigned({ companyId, salesUserId, assignedAt: new Date().toISOString() }), m);
      return { status: true as const, statusCode: 200 as const, message: 'กำหนดพนักงานขายสำเร็จ', data: { id: companyId, assigned_sales_user_id: salesUserId } };
    });
  }
}
```

Note: the spec's mock matches the company query by `company_id`; it contains `data->>'company_id'`, so it does.

- [ ] **Step 5: Run the spec — expect PASS (4 tests)**

Same command as Step 3.

- [ ] **Step 6: Controller, module, ownership, josh-actions route**

```ts
// apps/commerce-platform/src/modules/integration/customers/sales-reps.controller.ts
import { Body, Controller, Patch } from '@nestjs/common';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { StaffRoles } from '../../../shared-kernel/presentation/auth.decorators';
import { SalesRepsService } from './sales-reps.service';

class AssignSalesDto {
  @IsUUID() company_id!: string;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsUUID() sales_user_id?: string | null;
}

/** josh CS-admin's PATCH /cs-admin/sales-assignment (admin only), here — commerce-admin's hosted CS page calls the same path. */
@Controller('cs-admin')
@StaffRoles('admin')
export class SalesRepsController {
  constructor(private readonly reps: SalesRepsService) {}
  @Patch('sales-assignment')
  assign(@Body() dto: AssignSalesDto) { return this.reps.assign(dto.company_id, dto.sales_user_id ?? null); }
}
```

`customers.module.ts`: add `SalesRepsController` to `controllers` and `SalesRepsService` to `providers` + `exports` (the event bus provider is global as in 2a's `SegmentsService`; if the module test fails to resolve `EVENT_BUS`, import the same module `segments.module.ts` imports for it).

`ownership.controller.ts`:

```ts
import { ownsSalesReps } from '../customers/sales-reps.service';
// ...
  @Get() get() { return { segments: ownsSegments(), salesReps: ownsSalesReps() }; }
```

`josh-actions.controller.ts` `assignSales` (line ~165): inject `SalesRepsService` and route when owned:

```ts
  assignSales(@Param('id', ParseUUIDPipe) id: string, @Body() b: { salesUserId?: string | null }, @Req() req: StaffRequest) {
    if (ownsSalesReps()) return this.salesReps.assign(id, b?.salesUserId ?? null);
    return this.josh.run('customers', 'assign_sales', { companyId: id, salesUserId: b?.salesUserId ?? null }, this.as(req), 'admin');
  }
```
(`josh-actions.controller` is guarded for admin already — the `'admin'` argument; keep that guard. Import `CustomersModule` into the josh connector module if `SalesRepsService` is not resolvable there.)

- [ ] **Step 7: Run customers + segments + josh connector specs, typecheck**

```bash
npx jest -c apps/commerce-platform/jest.config.cts --runInBand customers segments josh-actions 2>&1 | grep -E "Test Suites:|Tests:|✕"
npx tsc -p apps/commerce-platform/tsconfig.app.json --noEmit 2>&1 | head
```
Expected: pass (DB specs skip without env); no tsc output.

- [ ] **Step 8: Commit**

```bash
git add apps/commerce-platform/src/migrations/1794400000000-CompanySalesReps.ts apps/commerce-platform/src/modules/integration/customers apps/commerce-platform/src/modules/integration/segments/ownership.controller.ts apps/commerce-platform/src/modules/integration/connector/josh/josh-actions.controller.ts
git commit -m "feat(customers): company sales-rep assignment owned by commerce, sent to josh as company.sales_rep"
```

---

### Task 4: commerce-admin — CS page sends the assignment to the owner

**Files:**
- Modify: `apps/commerce-admin/src/josh-admin/libs/shared-api/lib/api-client/commerce-client.ts:48-49`
- Modify: `apps/commerce-admin/src/josh-admin/libs/shared-api/lib/cs-admin/cs-admin.api.ts:43-46`

**Interfaces:** Consumes `GET /api/ownership` → `{ segments: boolean; salesReps: boolean }` (Task 3).

- [ ] **Step 1: Ownership type**

```ts
type Ownership = { segments: boolean; salesReps: boolean };
let owned: Promise<Ownership> | null = null;
/** Which josh features commerce owns right now (GET /api/ownership), fetched once per page load; josh if unknown. */
export const ownership = () => (owned ??= request<Ownership>('/ownership').catch(() => ({ segments: false, salesReps: false })));
```

- [ ] **Step 2: Route the write**

```ts
import { commerceClient, ownership } from '../api-client/commerce-client';
// ...
export const assignCsSalesRep = async (body: { company_id: string; sales_user_id?: string | null }) =>
  ((await ownership()).salesReps ? commerceClient : apiClient).patch('/cs-admin/sales-assignment', body);
```
(Match the relative import path `user-segment.api.ts` uses for `commerce-client`.)

- [ ] **Step 3: Typecheck + build the admin app**

```bash
npx tsc -p apps/commerce-admin/tsconfig.app.json --noEmit 2>&1 | head
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/commerce-admin/src/josh-admin/libs/shared-api/lib
git commit -m "feat(commerce-admin): CS sales-rep assignment goes to commerce once it owns it"
```

---

### Task 5: commerce — import from josh, PDPA

**Files:**
- Modify: `apps/commerce-platform/src/cli/import-from-josh.ts` (Scope type, PLANS, header comment)
- Modify: `apps/commerce-platform/src/modules/integration/connector/josh/events/josh-events.service.ts` (`customer.deleted`, ~line 33)
- Modify: its spec (`josh-events.service.spec.ts`, the `customer.deleted` case)

- [ ] **Step 1: Import scope**

```ts
type Scope = 'research' | 'scraping' | 'competitor' | 'segments' | 'sales-reps';
// in PLANS:
  // stage 2b: every josh company's rep (same ids; only the columns both tables have: id, assigned_sales_user_id, updated_at).
  'sales-reps': [{ table: 'company', target: 'company_sales_reps' }],
```
Add a header line: ` *   JOSH_DATABASE_URL=… npm run import-from-josh -- sales-reps   (stage 2b; re-run on switch day)`. If `all` enumerates scopes explicitly, add `'sales-reps'` there.

- [ ] **Step 2: Failing PDPA expectation** — in the `customer.deleted` spec case add:

```ts
expect(queries).toContain('UPDATE company_sales_reps SET assigned_sales_user_id = NULL, updated_at = now() WHERE assigned_sales_user_id = $1');
expect(queries).toContain('UPDATE winback_account SET josh_user_id = NULL WHERE josh_user_id = $1');
```
(`queries` = the SQL strings the case already collects for `customer_metrics` / `segment_members`; use the same variable the case uses.)

Run: `npx jest -c apps/commerce-platform/jest.config.cts --runInBand josh-events.service` → FAIL.

- [ ] **Step 3: Implement** — after `DELETE FROM segment_members …`:

```ts
          // A deleted rep leaves their companies unassigned here; a deleted customer's winback account loses its user
          // link. josh's company column has no FK and josh never cleared it on delete either, so no event is sent for it;
          // the winback change reaches josh through the mirror once commerce owns winback.
          await m.query('UPDATE company_sales_reps SET assigned_sales_user_id = NULL, updated_at = now() WHERE assigned_sales_user_id = $1', [e.aggregateId]);
          await m.query('UPDATE winback_account SET josh_user_id = NULL WHERE josh_user_id = $1', [e.aggregateId]);
```

- [ ] **Step 4: Run — PASS**; then commit

```bash
git add apps/commerce-platform/src/cli/import-from-josh.ts apps/commerce-platform/src/modules/integration/connector/josh/events
git commit -m "feat(customers): import josh sales reps; PDPA delete clears rep and winback user links"
```

---

### Task 6: docs — contract, env, runbook

**Files:**
- Modify: `docs/event-contract.md` (§3 commerce → platform events: add `company.sales_rep`; §5 josh handlers: add `company.sales_rep`, `winback.notify`, `winback.welcome_email`, `winback.row` if missing)
- Modify: `apps/commerce-platform/.env.example` (after `COMMERCE_OWNS_SEGMENTS`)
- Create: `docs/runbooks/stage2b-winback-cutover.md`

- [ ] **Step 1: Contract rows**

```md
| `company.sales_rep` | company id | `{ companyId, salesUserId \| null, assignedAt }` — snapshot, latest `assignedAt` wins | josh sets `company.assigned_sales_user_id` (needs `COMMERCE_OWNS_CUSTOMERS=true`, else 409) |
```

- [ ] **Step 2: Env**

```bash
# Sales-rep assignment (stage 2b): true together with josh COMMERCE_OWNS_CUSTOMERS — CS "assign sales rep" writes here
# and josh's company.assigned_sales_user_id follows (company.sales_rep). Import first: npm run import-from-josh -- sales-reps
COMMERCE_OWNS_SALES_REPS=false
```

- [ ] **Step 3: Runbook** — `docs/runbooks/stage2b-winback-cutover.md`, Thai, same shape as the 2a runbook:
  - ก่อน shadow: merge + deploy josh (`feat/commerce-owns-winback`) และ commerce (migration `1794400000000-CompanySalesReps`), flag ปิดทั้งหมด
  - shadow ~1 สัปดาห์: commerce `CRON_WINBACK_MIRROR_ENABLED=true` (josh → commerce); ทุกวันเทียบจำนวนแถว 6 ตาราง winback สองฝั่ง (SQL ในไฟล์) = เท่ากัน; `import-from-josh -- sales-reps` แล้วเทียบ `SELECT count(*) FROM company WHERE assigned_sales_user_id IS NOT NULL` กับ `company_sales_reps` = เท่ากัน
  - วันสลับ (หลังขั้น 2a สลับแล้ว เพราะใช้ `COMMERCE_OWNS_CUSTOMERS`): แจ้งทีมขาย ~15 นาที → mirror รอบสุดท้าย → josh subscription เพิ่ม `winback.notify`, `winback.welcome_email`, `winback.row`, `company.sales_rep` → josh `WINBACK_OWNED_BY_COMMERCE=true` restart → commerce `WINBACK_OWNER=commerce`, `COMMERCE_OWNS_SALES_REPS=true`, cron แจ้งเตือน 3 ตัว (`CRON_WINBACK_APPOINTMENTS_DUE_ENABLED`, `CRON_WINBACK_DAILY_DIGEST_ENABLED`, `CRON_WINBACK_AGING_LEADS_ENABLED`) restart → `import-from-josh -- sales-reps` อีกรอบ → nginx `/api/winback/*` → commerce
  - ทดสอบ: แอปขาย login (ยังที่ josh) สร้าง lead ทดสอบ → แถวขึ้นใน josh ภายใน 5 นาที; มอบหมาย sales ใน CS page → josh `company.assigned_sales_user_id` เปลี่ยน; login ลูกค้าที่มี TMP lead → lifecycle เป็น lead
  - rollback: josh เอา `WINBACK_OWNED_BY_COMMERCE` ออก, commerce `WINBACK_OWNER=josh`, `COMMERCE_OWNS_SALES_REPS=false`, nginx กลับ — ข้อมูลที่เขียนใน commerce อยู่ใน josh แล้วผ่าน `winback.row` / `company.sales_rep`
  - ข้อจำกัด: winback ยังอ่าน users / orders / company / ร้าน / ERP sales / cuisine และตรวจ login ผ่าน replica ของ josh (`JOSH_DATABASE_URL`) — ตัดในขั้น 2c

- [ ] **Step 4: Commit**

```bash
git add docs/event-contract.md docs/runbooks/stage2b-winback-cutover.md apps/commerce-platform/.env.example
git commit -m "docs(stage2b): company.sales_rep in the contract; winback + sales-rep cutover runbook"
```

---

### Task 7: end to end on scratch DBs (light), as built

One server at a time; stop each before starting the next.

- [ ] **Step 1: Scratch DBs** — `createdb -T <local josh dev db> josh_2b_test`, `createdb -T <local commerce dev db> commerce_2b_test`; run both repos' migrations against them.
- [ ] **Step 2: Sales reps** — `JOSH_DATABASE_URL=postgres:///josh_2b_test npm run import-from-josh -- sales-reps` → `company_sales_reps` count = josh companies; non-null reps equal.
- [ ] **Step 3: Assign through commerce** — start commerce (`COMMERCE_OWNS_SALES_REPS=true`, pointing at `commerce_2b_test`), `PATCH /api/cs-admin/sales-assignment` as an admin staff → `outbox_messages` has one `company.sales_rep`; stop commerce. Start josh (`COMMERCE_OWNS_CUSTOMERS=true`), POST that envelope signed to `/api/internal/erp-events` (the 2a E2E harness) → `company.assigned_sales_user_id` updated; replay an older `assignedAt` → unchanged; stop josh.
- [ ] **Step 4: Winback row + notify** — commerce `WINBACK_OWNER=commerce`: create a lead through `WinbackStaffActions` (assign) → `winback.row` in outbox; josh `WINBACK_OWNED_BY_COMMERCE=true` applies it → same row in josh `winback_account`; a josh winback write answers 409; `winback.notify` envelope → a notification row for the rep.
- [ ] **Step 5: PDPA** — `customer.deleted` for the rep → `company_sales_reps` cleared; for a lead's user → `winback_account.josh_user_id` null.
- [ ] **Step 6: Suites** — commerce `npx jest -c apps/commerce-platform/jest.config.cts --maxWorkers=2`; josh `npx nx test backend --skip-nx-cache -- --maxWorkers=2`; read `Test Suites:` and `Tests:`.
- [ ] **Step 7: As built** — append an "As built" section to this plan (differences + results), drop `josh_2b_test` / `commerce_2b_test`, commit in each repo.

## Checklist mapping

| Item | Tasks |
|---|---|
| winback written by commerce, josh keeps a copy | 1, 7 step 4, runbook |
| sales-rep assignment owned by commerce | 2, 3, 4, 5 |
| PDPA both sides | 5, 7 step 5 |
| shadow then switch | 6 (runbook), 7 |

**2c (next):** winback reads commerce copies instead of josh's replica (company / restaurant_place / erp_sales_history / cuisine copies; staff sign-in through commerce instead of josh tokens).
