# Stage 6 — staff / admin ownership · STATUS

Worktree `/workspace/commerce-s6` · branch `feat/stage6-staff-admin` (from master `a1730cd`) · not pushed, no PR.
Plan: `docs/superpowers/plans/2026-10-08-stage6-staff-admin.md` · runbook: `docs/runbooks/stage6-staff-cutover.md`

## What Stage 6 means here (derived from the design, not invented)

Design §1 ownership table: "พนักงาน (admin, MER, CS, marketing) → commerce, อีกฝั่ง –". Sign-in was already decided on
2026-10-06 (`docs/headless-split-plan.md` §6): commerce staff use commerce accounts, josh trusts commerce as a system.
What was still missing:
1. commerce only knew `admin` / `marketing`, so MER and CS had to be over-privileged admins or stay in josh.
2. josh staff accounts that must still exist (sales app login, CS chat, josh-only CMS pages) had no writer outside josh
   (josh itself has no staff-management module, only the admin-access approval queue).

## Done (commits on this branch)

| Commit | What |
|---|---|
| `3c86f7c` | plan |
| `48b9d3c` | roles `merchandising` (MER) and `cs`; MER on prices / contents / categories / brands / masters / images / product + supplier actions / product areas of the josh relay; CS on orders / shipments / CS desk / credit notes of the relay; PII, KYC, staff access, payment testing stay admin; MCP stays admin / marketing |
| `ff69a5d` | `josh_staff_access` (migration `1795400000000`), `JoshStaffAccessService` + `GET/PATCH /api/admin/josh-staff` (admin), `staff.access` snapshot event, `COMMERCE_OWNS_STAFF` (default off → 409), `GET /api/ownership` → `staff`, `staff.deleted` drops the access row |
| `4e0ed5a` | sales app sign-in (commerce's `AdminWriteGuard`) honours commerce's decision at once when owned — stricter only |
| `05d208c` | commerce-admin: ตั้งค่า › บัญชี josh page (read-only until owned; role / on-off / sign out everywhere; "รอ josh" chip), MER / CS in บัญชี staff |
| `903c63f` | docs: `event-contract.md` (`staff.access` + josh handler row marked "not in josh yet"), `.env.example`, runbook, prod-data note |
| `bb92993` | fix: `/api/ownership` readable by every staff role (it was admin-only → non-admin pages fell back to josh writes; already affected marketing); MER reads `/reports/products*` |
| (last) | plan "As built", this file |

## Remaining

- **josh repo follow-up implemented and pair-ready (2026-10-07):** `/workspace/webjosh-s6`, branch
  `feat/stage6-staff-admin`, local commits `f0d02a09` (flag + versioned `staff.access` consumer), `6e1d121f`
  (approve/reject relay-aware guards), `06409019` (docs + STATUS). Josh: 9 suites / 107 tests and backend typecheck
  passed; default OFF, not pushed or deployed. Verify/cutover details: `/workspace/webjosh-s6/STATUS.md`.
- Ops: runbook part 1 (MER / CS accounts; no flag) can go any time after deploy; part 2 waits for both branches to
  deploy and the live end-to-end cutover checks. Plan/runbook/event-contract still have the earlier "not in josh yet" wording.
- Not run: full commerce suite (shared machine), commerce-admin in a browser, end-to-end with josh.

## How to verify

```bash
cd /workspace/commerce-s6   # node_modules is a symlink to commerce-g5's (as commerce-s5 does)
P=apps/commerce-platform/src
NODE_OPTIONS=--max-old-space-size=2048 npx jest -c apps/commerce-platform/jest.config.cts --runInBand \
  $P/modules/core/auth $P/mcp $P/modules/integration/connector/josh $P/modules/integration/customers \
  $P/modules/integration/segments $P/modules/integration/winback $P/modules/commerce/product-* $P/modules/architecture.spec.ts
# → 97 suites / 898 tests passed, 23 opt-in skipped (2026-10-07)
npx tsc -p apps/commerce-platform/tsconfig.app.json --noEmit && npx tsc -p apps/commerce-admin/tsconfig.app.json --noEmit

# opt-in DB spec (scratch DB; dropped after this run — recreate):
createdb commerce_s6_test
COMMERCE_DATABASE_URL='postgres://box@/commerce_s6_test?host=/var/run/postgresql' npm run -s migration:run
STAFF_TEST_DATABASE_URL='postgres://box@/commerce_s6_test?host=/var/run/postgresql' \
  npx jest -c apps/commerce-platform/jest.config.cts --runInBand josh-staff-access.service.db
dropdb commerce_s6_test
```

Key specs: `josh-admin-call.controller.spec.ts` (role areas), `josh-staff-access.service.spec.ts` / `.db.spec.ts`,
`admin-write.guard.spec.ts` (owned query), `ownership.controller.spec.ts`, `josh-events.service.spec.ts` (`staff.deleted`).

## Open questions (owner)

- **Q1** MER / CS → page mapping was derived from page names (MER: products, prices, categories, brands, suppliers,
  images, ERP product queue; CS: orders, shipments, CS desk, credit notes / backs). Not given to CS: customer list /
  PII, companies / branches, KYC, credit applications, commerce's own order / customer reports. Confirm with team leads.
- **Q2** Keep josh `/admin-access/register` (public self-registration) open until SSO, or close it when owned?
- **Q3** May commerce grant `platform_admin` to a josh account? Built: refused (josh / DB only).
- **Q4** Link commerce accounts and josh accounts by email (one offboarding action)? Not built — two lists today.
- **Q5** Move the sales app (winback) sign-in off josh JWTs to commerce accounts (needs `sale` / `sales` / `manager`
  roles in commerce) — a later stage, with company SSO?
- **Q6** Should `merchandising` / `cs` get MCP (AI connector) access with a cut-down tool set? Today: no.

## Final summary

Stage 6 coding on the commerce side is **done and ready to hand off toward Stage 7**. Everything is additive. The
MER / CS roles reach nothing until an admin gives someone that role. Josh-staff writes stay off (409) until
`COMMERCE_OWNS_STAFF=true`, and the only migration adds an empty table. Cutover part 2 is blocked on deploying the josh-side
follow-up (implemented on webjosh-s6; see Remaining). Stage 7 should not remove anything staff-related. The josh
`admin-access` relay path and `josh_staff` are still in use.
