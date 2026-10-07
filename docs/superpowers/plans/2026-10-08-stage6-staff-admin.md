# Stage 6 — staff / admin owned by commerce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** commerce is the home of every employee account — admin, MER, CS, marketing (spec §1 ownership table:
"พนักงาน (admin, MER, CS, marketing) → commerce, อีกฝั่ง –"). MER and CS staff sign in to commerce-admin with their
own role instead of borrowing `admin`; and the josh staff accounts that still have to exist (sales app login, CS chat,
josh-only CMS pages) get their **role / active / sign-out** written by commerce, not by josh.

**Architecture:**
- Sign-in was decided 2026-10-06 (`docs/headless-split-plan.md` §6 "การยืนยันตัวตน"): commerce staff use commerce
  accounts (`users`, `StaffAuthGuard`), josh trusts commerce as a system (service account
  `commerce-platform@system.josh.internal`). Stage 6 does **not** change that — it widens the role set.
- Roles: `StaffRole` gains `merchandising` and `cs` (josh's own codes). The guard stays default-deny (admin + roles
  listed with `@StaffRoles`), so a new role reaches nothing until a route lists it.
- josh staff: commerce already holds a copy (`josh_staff`, from `staff.snapshot`, stage 2c). New commerce table
  `josh_staff_access (id PK, email, role, is_active, min_token_version, updated_at, updated_by)` — the commerce-written state
  of a josh internal account. Each change publishes `staff.access` (snapshot, whole state) in the same transaction.
  josh (follow-up, not in this repo) applies it to `users.role` / `users.is_active` and raises `token_version` to at least
  `minTokenVersion` (sign out everywhere); its own trigger then echoes `staff.snapshot` back into `josh_staff` (no loop: commerce
  never republishes on `staff.snapshot`).
- Switch: commerce `COMMERCE_OWNS_STAFF` (default off → writes answer 409); josh `COMMERCE_OWNS_STAFF` (follow-up).
  `GET /api/ownership` → `staff`.

**Tech Stack:** NestJS 10, TypeORM (raw SQL like the 2b/2c code), Postgres, outbox → webhook delivery, React
(commerce-admin), Jest.

**Spec:** `docs/superpowers/specs/2026-10-06-josh-to-commerce-ownership-move-design.md` §1 (ownership table: staff),
§2.3 (version guard), §2.4 (flag pattern), §4.1 (per-group steps). Auth decision: `docs/headless-split-plan.md` §6.
Prior staff work: stage 2c (`josh_staff` copy, winback sign-in check), stage 2b (`company.sales_rep`).

## Global Constraints

- Additive and default off (spec rule 4). Off = today's behaviour exactly.
- **This repo only.** josh changes are listed under "josh follow-ups" for the josh repo; nothing here needs them to
  be safe (with the flag off nothing is sent; with it on and josh not ready, josh answers 4xx on an unknown type and
  the delivery dead-letters — the runbook turns the subscription on only after the josh side is deployed).
- Never touch the commerce service account in josh (`commerce-platform@system.josh.internal`) — disabling it cuts
  commerce off josh.
- Stage 5 is not touched. Light tests (`--runInBand`, single specs).
- Branch: commerce `feat/stage6-staff-admin` (from master `a1730cd`). Migration `1795400000000` (G5 1795150…, S5
  1795200/1795300…, G9 1795300/1795310… are taken on sibling branches).

## Out of scope (from the design / earlier decisions — documented, not built)

- Company SSO for staff (`headless-split-plan.md` "SSO ของบริษัทเป็นขั้นต่อไป").
- Moving the sales app (winback) sign-in off josh JWTs — it still verifies josh tokens against `josh_staff`.
- Retiring josh `admin-access` self-registration (plan lists it as "เลิกใช้ → SSO"); until SSO, josh keeps the queue
  and commerce keeps approving it through the relay (already works).
- Staff passwords for josh accounts (self-service in josh, like customers).
- Per-permission RBAC — josh has none either (roles only).

## File map

| Repo | File | Change |
|---|---|---|
| commerce | `shared-kernel/presentation/auth.decorators.ts` | roles `merchandising`, `cs` (Task 1) |
| commerce | `connector/josh/josh-admin-call.controller.ts(+spec)` | areas list roles, not `marketing: boolean` (Task 1) |
| commerce | `commerce/product-{prices,contents,categories,masters,images}/*.controller.ts` | `@StaffRoles('merchandising')` (Task 1) |
| commerce | `migrations/1795400000000-JoshStaffAccess.ts` | new table (Task 2) |
| commerce | `core/auth/josh-staff/{josh-staff-access.service.ts(+db.spec,+spec), josh-staff-access.controller.ts, staff-access-snapshot.event.ts}` | new (Task 2) |
| commerce | `segments/ownership.controller.ts(+spec)` | `staff` (Task 2) |
| commerce | `connector/josh/events/josh-events.service.ts` | `staff.deleted` also drops `josh_staff_access` row (Task 2) |
| commerce-admin | `pages/StaffAccounts.tsx`, `pages/JoshStaff.tsx`, `lib/api.ts`, `app.tsx`, `JoshBackofficeActions.tsx` | roles; josh staff page (Task 3) |
| docs | `event-contract.md`, `.env.example`, `runbooks/stage6-staff-cutover.md`, `STATUS.md` | (Task 4) |

---

### Task 1: MER and CS roles in commerce

- [x] `StaffRole = 'admin' | 'marketing' | 'merchandising' | 'cs'`; `STAFF_ROLES` follows. Guard unchanged
  (default admin-only; `@StaffRoles` adds).
- [x] `@StaffRoles('merchandising')` on the stage-4 product controllers commerce owns: `product-prices`,
  `product-contents`, `product-category` + `brands`, `product-masters`, `product-images`.
- [x] admin-call `AREAS`: `marketing: boolean` → `roles: StaffRole[]`. Keep every existing marketing/admin answer
  identical; add `merchandising` to the product / category / brand / cuisine / supplier / upload areas and `cs` to
  orders / shipments / cs-admin / credit notes / backs. PII (`/users`, `pii/reveal`, `company/`, `branch/`), KYC,
  admin-access, payment testing stay admin only. Controller-level `@StaffRoles('marketing', 'merchandising', 'cs')`.
- [x] Spec: existing admin-call spec still passes; new cases — `cs` can call `/orders`, not `/product/1`;
  `merchandising` can call `/product/1`, not `/orders`; `marketing` unchanged on both.
- [x] Commit `feat(auth): merchandising and cs staff roles; MER on commerce's product pages, CS on josh orders (stage 6)`

### Task 2: josh staff access written by commerce

- [x] Migration `1795400000000-JoshStaffAccess`: `josh_staff_access (id uuid PK, role varchar(50) NOT NULL,
  email varchar(255), is_active boolean NOT NULL, min_token_version int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar(255))`.
- [x] `StaffAccessSnapshot` event: type `staff.access`, aggregate = josh user id, `{ snapshot: true }`, data
  `{ id, email, role, isActive, minTokenVersion, version }` — `version` = `updated_at` ISO (josh `applyIfNewer`).
- [x] `JoshStaffAccessService`:
  - `list()` — `josh_staff` (internal only) left join `josh_staff_access`: `{ id, email, name, role, isActive,
    lastAppLoginAt, pending }` where `pending` = commerce row newer than what josh echoed back.
  - `set(id, { role?, isActive?, revokeSessions? }, actor)` — 409 unless `COMMERCE_OWNS_STAFF=true`; 404 unless the
    id is an internal josh staff member; 400 on the service account, on a role not in josh's internal list
    (`JOSH_INTERNAL_ROLES` = josh `ASSIGNABLE_ADMIN_ROLES`), or on `platform_admin` (open question Q3); upsert row
    (start from the `josh_staff` copy), audit `josh_staff.update`, publish in the same transaction.
- [x] `JoshStaffAccessController` `GET /api/admin/josh-staff`, `PATCH /api/admin/josh-staff/:id` (admin only).
- [x] `GET /api/ownership` → `staff: ownsStaff()`.
- [x] `staff.deleted` from josh also deletes the `josh_staff_access` row.
- [x] Specs: unit (flag off → 409, service account refused, unknown role refused) + opt-in `.db.spec` (upsert,
  event in outbox, pending flag). Commit.

### Task 3: commerce-admin

- [x] `StaffAccounts` role select lists the four roles (label MER / CS).
- [x] New page `ตั้งค่า › บัญชี josh (staff)` `/settings/josh-staff`: list from `GET /admin/josh-staff`; when
  `ownership.staff` → role select, active toggle, "ออกจากระบบทุกเครื่อง"; otherwise read-only with a note.
- [x] `JoshBackofficeActions` `ADMIN_ROLES` → shared constant. Commit.

### Task 4: docs, verification

- [x] `event-contract.md` (commerce → josh `staff.access`), `.env.example` (`COMMERCE_OWNS_STAFF`), runbook
  `docs/runbooks/stage6-staff-cutover.md`, `STATUS.md`.
- [x] Typecheck both apps; touched specs `--runInBand`. Commit.

## josh follow-ups (josh repo — not done here)

1. `isCommerceOwningStaff()` (`COMMERCE_OWNS_STAFF`, default off) in `app/erp/commerce-ownership.flag.ts`.
2. Receiver handler `staff.access` → `CommerceStaffService.apply({ id, role, isActive, minTokenVersion, version })`:
   409 unless owned; transaction: `applyIfNewer('staff.access', id, version)`; 422 if the user is unknown or a
   customer role; refuse the service account; `UPDATE users SET role, is_active, token_version = GREATEST(token_version, minTokenVersion)`; clear the internal-role cache.
3. With the flag on: `admin-access` approve/reject → `CommerceOwned` (relay passes, josh's own UI 403), so the only
   writer of role-at-approval is commerce. `register` stays open (Q2).
4. Docs: `docs/commerce-erp-receiver.md` handler row.

## Open questions (owner)

- **Q1** Role → page mapping for MER and CS (Task 1) is derived from page names; confirm before cutover.
- **Q2** Keep josh `/admin-access/register` (public self-registration) until SSO, or close it with the flag?
- **Q3** May commerce grant `platform_admin` to a josh account? Built: refused (only the josh DB / migration can).
- **Q4** Should commerce staff and josh staff be linked (same email = same person)? Not built — the two lists are
  shown separately; offboarding means disabling both.
- **Q5** Sales app (winback) sign-in still uses josh JWTs — move it to commerce accounts (needs `sale`/`sales`/
  `manager` roles in commerce) as a later stage?

## As built (2026-10-07)

- **Scope as planned**, plus two things found on the way:
  - `GET /api/ownership` was admin-only (no `@StaffRoles`), so a non-admin's hosted josh page fell back to josh's write
    route — already wrong for marketing, fatal for MER. Now open to every staff role (booleans only).
  - MER needs the josh catalog reads (`/reports/products*`, used by the product page) — added; order / customer reports
    stay admin.
  - The sales app sign-in that commerce runs (`winback/shared/admin-write.guard.ts`) also reads `josh_staff_access`
    when `COMMERCE_OWNS_STAFF` is on, so a disable / sign-out / role change from commerce bites at once (stricter only).
  - MCP sign-in stays `admin` / `marketing` (its tool set gives every non-admin the marketing tools).
- Sign-out travels as `minTokenVersion` (josh raises `token_version` to at least that) instead of a timestamp — idempotent,
  no extra state in josh.
- Role → area mapping for MER / CS is from page names (Q1).

**Verification:** touched specs `--runInBand` — auth, mcp, connector/josh, customers, segments, winback, product-*,
architecture: 97 suites / 898 tests passed (23 opt-in skipped). Opt-in `josh-staff-access.service.db.spec.ts` on a migrated
scratch DB (`commerce_s6_test`, migration `1795400000000` applied): 2 passed; the guard's owned SQL checked on the same DB.
Typecheck commerce-platform + commerce-admin clean. Full suite not run (other agents share the machine). josh side not
built (follow-ups above).
