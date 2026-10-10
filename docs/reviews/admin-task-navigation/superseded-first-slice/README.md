# Superseded first-slice validation record

**Historical evidence only.** The application changes below were archived and undone after the
user's Stitch exclusion. Their tests and screenshots do not describe the current branch. The original
browser runner and added source files are preserved in `new-source-files.tar.gz`; reproduction requires
restoring that superseded slice after an appropriate scope decision. See the current parent-directory report.

Verified on 2026-10-09 in `/workspace/commerce-platform`, branch
`redesign/admin-task-navigation`, based on `69b13b2d188d4f7fb1d9bfbe5136fa693fc0bbf9`.
Expected `e4346b7687c196ba4a1a8ca276e74448b90c3317` differs; no reset was performed.
The initial worktree was clean. Changes remain local and uncommitted.

## Implemented

- Canonical feature mapping removes 15 overlapping/global action menu entries (119 → 104), preserves
  old URLs and original role restrictions, and highlights aliases under the canonical feature.
- Saved-record views stay reachable from their feature. Live coupon, supplier, credit and access actions
  remain intact. Internal document creation/deletion retains its independent entry under Settings.
- Customer service has task URLs for order creation, samples, admin-only account merging and individual
  sample decisions. Legacy samples URLs preserve query/hash when redirected. Sample filters use URL
  history. Review notes recover per staff session, and desktop tables become request cards on phones.
- Sample operations retain pending approval/rejection/fulfillment and approved fulfillment capabilities.
  Failed HTTP or explicit business responses cannot produce success. Status badges count records from
  the current successful API result, with visible scope; sidebar menu counts have been removed.
- Shared reads reject stale responses and writes reject same-tick duplicates. Accessible table/form/detail
  skeletons respect reduced motion. Failed reads expose retry. Session/password checks show skeletons,
  block content on read failure and retry instead of returning a blank screen or assuming success.
- The product-master queue avoids false initial empty/zero states, guards approval/rejection together,
  uses actual returned counts, preserves failed selections and blocks stale writes after failed refresh.

## Passed checks

| Check | Result |
| --- | --- |
| Admin Vitest suite, 1 worker, file parallelism disabled | 14 files, 202 tests passed |
| Backend contract/business-rule Jest tests, `--runInBand` | 3 suites, 24 tests passed |
| Admin and Portal TypeScript checks | Both passed |
| Admin and Portal Vite production builds | Both passed; existing large-chunk warnings remain |
| Playwright with Chromium 153, one browser/job | 23 scenarios passed, zero page errors |
| Git diff whitespace check | Passed |

The backend suites were `josh-admin-call.controller.spec.ts`, `staff-auth.guard.spec.ts` and
`master-fields.spec.ts`. They check relay permissions and preserved product-master field rules.
Component tests additionally cover out-of-order reads, synchronous failures, retry, same-tick duplicate
writes, unmount during a mutation, sample transitions, persisted-response success, failed notes,
empty/malformed data, invalid actions, missing requests, merge validation/confirmation and queue
ownership/refresh failures.

[Machine-readable browser results](results.json) list all eight roles in Thai and English, canonical
menus, keyboard navigation, query/deep-link/reload/Back/Forward behavior, startup check failure/retry,
sample failure/retry and duplicate submissions, interrupted notes, reduced motion, expired sessions,
phone navigation, order quote/checkout payloads and queue outcomes.

All browser APIs are intercepted fixtures. Screenshots are genuine captures of the built application
using those fixtures; they do not demonstrate external service or database persistence.

## Screenshots

- [Desktop sample requests, English](samples-en.png)
- [Confirmed sample decision, English](sample-success-en.png)
- [Phone sample cards with visible actions, Thai](samples-phone-th.png)
- [Product queue after confirmed approval, English](queue-success-en.png)

## Reproduce

Run heavy jobs sequentially from the repository root:

```sh
./node_modules/.bin/tsc -p apps/commerce-admin/tsconfig.app.json --noEmit
./node_modules/.bin/tsc -p apps/commerce-portal/tsconfig.app.json --noEmit
./node_modules/.bin/vitest run --config apps/commerce-admin/vite.config.mts --maxWorkers=1 --no-file-parallelism
./node_modules/.bin/jest -c apps/commerce-platform/jest.config.cts --runInBand --runTestsByPath apps/commerce-platform/src/modules/integration/connector/josh/josh-admin-call.controller.spec.ts apps/commerce-platform/src/modules/core/auth/presentation/staff-auth.guard.spec.ts apps/commerce-platform/src/modules/commerce/product-masters/master-fields.spec.ts
./node_modules/.bin/vite build --config apps/commerce-admin/vite.config.mts
./node_modules/.bin/vite build --config apps/commerce-portal/vite.config.mts
./node_modules/.bin/vite preview --config apps/commerce-admin/vite.config.mts --host 127.0.0.1 --port 4403 --strictPort
# In another terminal, using an installed Chromium or an explicit compatible binary:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/tmp/chromium node apps/commerce-admin/e2e/task-navigation.mjs
```

The browser runner only accepts a localhost URL, generates fixture display tokens, intercepts all API
requests and performs no external writes. The environment's existing Chromium package was used to
materialize `/tmp/chromium`; no environment credential file was sourced.

## Not verified / next work

1. External Josh/ERP persistence and database-backed queue integration were not run. No isolated,
   migrated database or task-specific operational credentials were supplied. Do not point the existing
   opt-in database test at production; use a dedicated scratch database for persistence verification.
2. Complete route-based receive/count/adjust/transfer, resource-create, staff-create and integration-create
   workflows, then reduce the remaining 104 entries through feature hubs only after mapping unique scopes.
3. Add draft/reconciliation handling for interrupted orders and merge forms. The existing unsaved guard
   protects links and reload but does not block browser Back; only sample notes recover in this slice.
   Duplicate guards do not establish backend idempotency across a reload or a lost network response.
4. Apply the reusable state/mutation patterns to remaining legacy live actions and editors, and verify
   their original business rules with task-specific local integration fixtures. These live actions were
   preserved and made discoverable; they were not all exercised against services.
5. Run broader accessibility checks, including screen readers, and regression checks for unaffected
   Portal workflows. This work verifies keyboard navigation, status/alert semantics, reduced motion,
   mobile layout and compilation of shared UI in both apps, not a full accessibility certification.
